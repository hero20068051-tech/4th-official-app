import type { ClassifiedPair, GroupValidation, RuleSet } from './rulesets/types'
import type {
  MatchState,
  Player,
  PlayerRuntimeState,
  ReplayIssue,
  ReplayResult,
  SubstitutionEvent,
  SubstitutionPair,
  SubstitutionPhase,
  TeamCounters,
  TeamId,
  TeamSubstitutionGroup,
} from './types'

// The substitution engine is rule-set independent: it replays the event log,
// keeps who is on the pitch / bench / has appeared, and checks what is true of
// every tournament (right team, OUT is on the pitch, IN is on the bench, no
// player used twice). Everything that differs between tournaments — what a
// re-entry is, every cap, how counters move — is asked of the RuleSet.

// The Saitama women's league values, kept exported under their old names.
export {
  MAX_REENTRY_PLAYERS,
  MAX_SECOND_HALF_OPPORTUNITIES,
  MAX_USED_SUBSTITUTES,
  fpUnlockConditionMet,
  isFpSubstitute,
} from './rulesets/saitamaWomen'

export function createInitialMatchState(roster: Player[]): MatchState {
  const players: Record<string, PlayerRuntimeState> = {}
  for (const player of roster) {
    players[player.id] = {
      location: player.isStarter ? 'pitch' : 'bench',
      hasAppeared: player.isStarter,
      reentryCount: 0,
    }
  }

  const emptyCounters = (): TeamCounters => ({
    usedSubstituteIds: [],
    secondHalfOpportunitiesUsed: 0,
    reentryPlayerIds: [],
  })

  return {
    players,
    teamCounters: { HOME: emptyCounters(), AWAY: emptyCounters() },
  }
}

function validateTeamGroup(
  state: MatchState,
  rosterById: Map<string, Player>,
  roster: Player[],
  phase: SubstitutionEvent['phase'],
  group: TeamSubstitutionGroup,
  rules: RuleSet,
): GroupValidation {
  const errors: string[] = []
  const usedPlayerIds = new Set<string>()

  const describe = (playerId: string) => {
    const player = rosterById.get(playerId)
    return player ? `${player.number}番` : playerId
  }

  // Structural checks that hold under every rule set.
  for (const pair of group.pairs) {
    const outPlayer = rosterById.get(pair.outPlayerId)
    const inPlayer = rosterById.get(pair.inPlayerId)

    if (!outPlayer || outPlayer.teamId !== group.teamId) {
      errors.push(`${describe(pair.outPlayerId)}はこのチームの選手ではありません`)
      continue
    }
    if (!inPlayer || inPlayer.teamId !== group.teamId) {
      errors.push(`${describe(pair.inPlayerId)}はこのチームの選手ではありません`)
      continue
    }
    if (pair.outPlayerId === pair.inPlayerId) {
      errors.push('同じ選手は選べません')
      continue
    }
    if (usedPlayerIds.has(pair.outPlayerId) || usedPlayerIds.has(pair.inPlayerId)) {
      errors.push('同じ選手を2つの交代に入れることはできません')
      continue
    }
    usedPlayerIds.add(pair.outPlayerId)
    usedPlayerIds.add(pair.inPlayerId)

    const outRuntime = state.players[outPlayer.id]
    const inRuntime = state.players[inPlayer.id]
    if (outRuntime.location !== 'pitch') {
      errors.push(`${describe(outPlayer.id)}は今ピッチにいません`)
    }
    if (inRuntime.location !== 'bench') {
      errors.push(`${describe(inPlayer.id)}はベンチにいません`)
    }
  }

  if (errors.length > 0) {
    return { errors, classifiedPairs: [] }
  }

  // Everything tournament-specific.
  return rules.evaluateGroup({ state, roster, phase, group, describe })
}

export function validateSubstitutionEvent(
  state: MatchState,
  roster: Player[],
  event: Pick<SubstitutionEvent, 'phase' | 'teamGroups'>,
  rules: RuleSet,
): { errors: string[] } {
  const rosterById = new Map(roster.map((p) => [p.id, p]))
  const allErrors: string[] = []
  for (const group of event.teamGroups) {
    const { errors } = validateTeamGroup(state, rosterById, roster, event.phase, group, rules)
    allErrors.push(...errors)
  }
  return { errors: allErrors }
}

function applyTeamGroup(
  state: MatchState,
  roster: Player[],
  phase: SubstitutionEvent['phase'],
  group: TeamSubstitutionGroup,
  classifiedPairs: ClassifiedPair[],
  rules: RuleSet,
): MatchState {
  const players = { ...state.players }

  for (const { pair, classification } of classifiedPairs) {
    players[pair.outPlayerId] = {
      ...players[pair.outPlayerId],
      location: 'bench',
    }
    const inRuntime = players[pair.inPlayerId]
    players[pair.inPlayerId] = {
      ...inRuntime,
      location: 'pitch',
      hasAppeared: true,
      reentryCount: classification === 'REENTRY' ? inRuntime.reentryCount + 1 : inRuntime.reentryCount,
    }
  }

  const counters: TeamCounters = rules.applyCounters(state.teamCounters[group.teamId], {
    phase,
    group,
    classifiedPairs,
    roster,
  })

  return {
    players,
    teamCounters: { ...state.teamCounters, [group.teamId]: counters },
  }
}

export function applySubstitutionEvent(
  state: MatchState,
  roster: Player[],
  event: SubstitutionEvent,
  rules: RuleSet,
): { state: MatchState; errors: string[] } {
  const rosterById = new Map(roster.map((p) => [p.id, p]))
  const groupResults = event.teamGroups.map((group) => ({
    group,
    validation: validateTeamGroup(state, rosterById, roster, event.phase, group, rules),
  }))

  const errors = groupResults.flatMap((r) => r.validation.errors)
  if (errors.length > 0) {
    return { state, errors }
  }

  let nextState = state
  for (const { group, validation } of groupResults) {
    nextState = applyTeamGroup(nextState, roster, event.phase, group, validation.classifiedPairs, rules)
  }
  return { state: nextState, errors: [] }
}

/**
 * Replays the full ordered event log from the initial roster. Events that
 * are no longer legal (e.g. because an earlier event was edited or
 * cancelled) are skipped rather than applied, and flagged in `needsReview`
 * rather than being silently dropped or silently re-legalized
 * (SPEC/Phase1_Spec_v0.2.md section 14.2).
 */
export function replayMatch(
  roster: Player[],
  events: SubstitutionEvent[],
  rules: RuleSet,
): ReplayResult {
  let state = createInitialMatchState(roster)
  const needsReview: ReplayIssue[] = []

  for (const event of events) {
    const result = applySubstitutionEvent(state, roster, event, rules)
    if (result.errors.length > 0) {
      needsReview.push({ eventId: event.id, messages: result.errors })
      continue
    }
    state = result.state
  }

  return { state, needsReview }
}

/**
 * Explains, for a single bench player, why they cannot yet be brought on —
 * or returns null if they currently could be. Used only to give the operator
 * a plain-language reason in the UI (SPEC/Phase1_Spec_v0.2.md section 16:
 * shown on demand, not by default); the authoritative legality check is still
 * validateSubstitutionEvent / applySubstitutionEvent at confirm time, which
 * evaluates the whole group.
 *
 * `otherPairsInGroup` are the *other complete pairs of the substitution the
 * operator is still assembling* (not yet confirmed). Confirm-time validation
 * treats a group as a whole, so this on-screen check must look at the same
 * prospective picture (see the rule set's own explanation).
 */
export function describeUnavailability(
  state: MatchState,
  roster: Player[],
  teamId: TeamId,
  phase: SubstitutionPhase,
  playerId: string,
  rules: RuleSet,
  otherPairsInGroup: SubstitutionPair[] = [],
  pairOutPlayerId?: string,
): string | null {
  return rules.describeUnavailability({ state, roster, teamId, phase, playerId, otherPairsInGroup, pairOutPlayerId })
}
