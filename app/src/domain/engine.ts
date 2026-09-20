import type { ReentryPolicy } from './reentryPolicy'
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

export const MAX_USED_SUBSTITUTES = 9
export const MAX_SECOND_HALF_OPPORTUNITIES = 3
export const MAX_REENTRY_PLAYERS = 3

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

interface ClassifiedPair {
  pair: SubstitutionPair
  classification: 'NORMAL' | 'REENTRY'
}

interface GroupValidation {
  errors: string[]
  classifiedPairs: ClassifiedPair[]
}

export function isFpSubstitute(player: Player): boolean {
  return !player.isStarter && !player.isRegisteredGK
}

// "Bench-registered outfield substitutes who have never appeared" must be
// empty before any player from that team may re-enter (02_CONFIRMED_RULES.md
// section E/F). GK-registered players never count as blockers here.
export function fpUnlockConditionMet(
  roster: Player[],
  teamId: TeamId,
  hasAppeared: (playerId: string) => boolean,
): boolean {
  return roster
    .filter((p) => p.teamId === teamId && isFpSubstitute(p))
    .every((p) => hasAppeared(p.id))
}

function validateTeamGroup(
  state: MatchState,
  rosterById: Map<string, Player>,
  roster: Player[],
  phase: SubstitutionEvent['phase'],
  group: TeamSubstitutionGroup,
  reentryPolicy: ReentryPolicy,
): GroupValidation {
  const errors: string[] = []
  const usedPlayerIds = new Set<string>()

  const describe = (playerId: string) => {
    const player = rosterById.get(playerId)
    return player ? `${player.number}番` : playerId
  }

  // Pass 1: structural checks that don't depend on group-wide evaluation.
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

  // Pass 2: classify NORMAL vs REENTRY. Evaluate the group as a whole so that
  // a first-time appearance earlier in the group can unlock a re-entry later
  // in the same group, regardless of input order (PENDING-independent rule,
  // see SPEC/Phase1_Spec_v0.2.md section 11.5).
  const prospectiveAppeared = new Set<string>()
  for (const [id, runtime] of Object.entries(state.players)) {
    if (runtime.hasAppeared) prospectiveAppeared.add(id)
  }
  for (const pair of group.pairs) {
    if (!state.players[pair.inPlayerId].hasAppeared) {
      prospectiveAppeared.add(pair.inPlayerId)
    }
  }
  const hasAppearedProspectively = (playerId: string) => prospectiveAppeared.has(playerId)

  const classifiedPairs: ClassifiedPair[] = []
  let prospectiveReentryCount = state.teamCounters[group.teamId].reentryPlayerIds.length

  for (const pair of group.pairs) {
    const inPlayer = rosterById.get(pair.inPlayerId)!
    const inRuntime = state.players[pair.inPlayerId]

    if (!inRuntime.hasAppeared) {
      classifiedPairs.push({ pair, classification: 'NORMAL' })
      continue
    }

    // Re-entry candidate.
    if (phase === 'FIRST_HALF') {
      errors.push(`まだ${describe(inPlayer.id)}は入れません`)
      continue
    }

    if (!fpUnlockConditionMet(roster, group.teamId, hasAppearedProspectively)) {
      const waiting = roster
        .filter((p) => p.teamId === group.teamId && isFpSubstitute(p) && !hasAppearedProspectively(p.id))
        .map((p) => p.number)
        .sort((a, b) => a - b)
      errors.push(`まだ${describe(inPlayer.id)}は入れません`)
      errors.push(`まだ出場していない選手がいます：${waiting.join('、')}番`)
      continue
    }

    const repeatDecision = reentryPolicy.checkRepeatReentry(inPlayer, inRuntime)
    if (!repeatDecision.allowed) {
      errors.push(repeatDecision.message ?? `${describe(inPlayer.id)}は再出場できません`)
      continue
    }

    const alreadyCountedTeam = state.teamCounters[group.teamId].reentryPlayerIds.includes(pair.inPlayerId)
    const wouldExceedCap = !alreadyCountedTeam && prospectiveReentryCount + 1 > MAX_REENTRY_PLAYERS
    if (wouldExceedCap) {
      errors.push('再交代できる選手はハーフタイム以降3名までです')
      continue
    }
    if (!alreadyCountedTeam) prospectiveReentryCount += 1

    classifiedPairs.push({ pair, classification: 'REENTRY' })
  }

  if (errors.length > 0) {
    return { errors, classifiedPairs: [] }
  }

  // Second-half opportunity cap: the whole group counts as at most one
  // opportunity, checked once the group is otherwise legal.
  if (phase === 'SECOND_HALF' && group.pairs.length > 0) {
    const used = state.teamCounters[group.teamId].secondHalfOpportunitiesUsed
    if (used >= MAX_SECOND_HALF_OPPORTUNITIES) {
      errors.push('後半の交代は終了です')
      return { errors, classifiedPairs: [] }
    }
  }

  // 9-substitute cap: count distinct first-time entries this group would add.
  const newSubstituteIds = classifiedPairs
    .filter((cp) => cp.classification === 'NORMAL')
    .map((cp) => cp.pair.inPlayerId)
    .filter((id) => !state.teamCounters[group.teamId].usedSubstituteIds.includes(id))
  const projectedUsedCount = state.teamCounters[group.teamId].usedSubstituteIds.length + newSubstituteIds.length
  if (projectedUsedCount > MAX_USED_SUBSTITUTES) {
    errors.push('使用できる交代要員は9名までです')
    return { errors, classifiedPairs: [] }
  }

  return { errors: [], classifiedPairs }
}

export function validateSubstitutionEvent(
  state: MatchState,
  roster: Player[],
  event: Pick<SubstitutionEvent, 'phase' | 'teamGroups'>,
  reentryPolicy: ReentryPolicy,
): { errors: string[] } {
  const rosterById = new Map(roster.map((p) => [p.id, p]))
  const allErrors: string[] = []
  for (const group of event.teamGroups) {
    const { errors } = validateTeamGroup(state, rosterById, roster, event.phase, group, reentryPolicy)
    allErrors.push(...errors)
  }
  return { errors: allErrors }
}

function applyTeamGroup(state: MatchState, phase: SubstitutionEvent['phase'], group: TeamSubstitutionGroup, classifiedPairs: ClassifiedPair[]): MatchState {
  const players = { ...state.players }
  const counters: TeamCounters = {
    usedSubstituteIds: [...state.teamCounters[group.teamId].usedSubstituteIds],
    secondHalfOpportunitiesUsed: state.teamCounters[group.teamId].secondHalfOpportunitiesUsed,
    reentryPlayerIds: [...state.teamCounters[group.teamId].reentryPlayerIds],
  }

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

    if (classification === 'NORMAL' && !counters.usedSubstituteIds.includes(pair.inPlayerId)) {
      counters.usedSubstituteIds.push(pair.inPlayerId)
    }
    if (classification === 'REENTRY' && !counters.reentryPlayerIds.includes(pair.inPlayerId)) {
      counters.reentryPlayerIds.push(pair.inPlayerId)
    }
  }

  if (phase === 'SECOND_HALF' && group.pairs.length > 0) {
    counters.secondHalfOpportunitiesUsed += 1
  }

  return {
    players,
    teamCounters: { ...state.teamCounters, [group.teamId]: counters },
  }
}

export function applySubstitutionEvent(
  state: MatchState,
  roster: Player[],
  event: SubstitutionEvent,
  reentryPolicy: ReentryPolicy,
): { state: MatchState; errors: string[] } {
  const rosterById = new Map(roster.map((p) => [p.id, p]))
  const groupResults = event.teamGroups.map((group) => ({
    group,
    validation: validateTeamGroup(state, rosterById, roster, event.phase, group, reentryPolicy),
  }))

  const errors = groupResults.flatMap((r) => r.validation.errors)
  if (errors.length > 0) {
    return { state, errors }
  }

  let nextState = state
  for (const { group, validation } of groupResults) {
    nextState = applyTeamGroup(nextState, event.phase, group, validation.classifiedPairs)
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
  reentryPolicy: ReentryPolicy,
): ReplayResult {
  let state = createInitialMatchState(roster)
  const needsReview: ReplayIssue[] = []

  for (const event of events) {
    const result = applySubstitutionEvent(state, roster, event, reentryPolicy)
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
 * or returns null if they currently could be (as either a normal entry or a
 * re-entry). Used only to give the operator a plain-language reason in the
 * UI (SPEC/Phase1_Spec_v0.2.md section 16: shown on demand, not by default);
 * the authoritative legality check is still validateSubstitutionEvent /
 * applySubstitutionEvent at confirm time, which evaluates the whole group.
 *
 * `otherPairsInGroup` are the *other complete pairs of the substitution the
 * operator is still assembling* (not yet confirmed). Confirm-time validation
 * treats a group as a whole — a first-time appearance in the group unlocks a
 * re-entry in the same group (validateTeamGroup, Pass 2) — so this on-screen
 * check must look at the same prospective picture. Without it, an operator
 * filling in "the last three unused subs, then two re-entries" during
 * half-time saw every bench chip blocked on the re-entry pairs even though
 * the group as a whole was legal.
 */
export function describeUnavailability(
  state: MatchState,
  roster: Player[],
  teamId: TeamId,
  phase: SubstitutionPhase,
  playerId: string,
  reentryPolicy: ReentryPolicy,
  otherPairsInGroup: SubstitutionPair[] = [],
): string | null {
  const runtime = state.players[playerId]
  const player = roster.find((p) => p.id === playerId)
  if (!runtime || !player) return null
  if (!runtime.hasAppeared) return null

  if (phase === 'FIRST_HALF') {
    return `まだ${player.number}番は入れません`
  }

  const appearingInGroup = new Set(
    otherPairsInGroup.map((p) => p.inPlayerId).filter((id) => state.players[id] && !state.players[id].hasAppeared),
  )
  const hasAppearedProspectively = (id: string) => state.players[id].hasAppeared || appearingInGroup.has(id)

  if (!fpUnlockConditionMet(roster, teamId, hasAppearedProspectively)) {
    const waiting = roster
      .filter((p) => p.teamId === teamId && isFpSubstitute(p) && !hasAppearedProspectively(p.id))
      .map((p) => p.number)
      .sort((a, b) => a - b)
    return `まだ出場していない選手がいます：${waiting.join('、')}番`
  }

  const repeatDecision = reentryPolicy.checkRepeatReentry(player, runtime)
  if (!repeatDecision.allowed) {
    return repeatDecision.message ?? `${player.number}番は再出場できません`
  }

  // Re-entrants already counted, plus those this group would add.
  const reentryIds = new Set(state.teamCounters[teamId].reentryPlayerIds)
  for (const p of otherPairsInGroup) {
    if (state.players[p.inPlayerId]?.hasAppeared) reentryIds.add(p.inPlayerId)
  }
  if (!reentryIds.has(playerId) && reentryIds.size >= MAX_REENTRY_PLAYERS) {
    return '再交代できる選手はハーフタイム以降3名までです'
  }

  return null
}
