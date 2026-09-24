import type { ReentryPolicy } from '../reentryPolicy'
import type { MatchState, Player, PlayerRuntimeState, SubstitutionPair, TeamCounters, TeamId } from '../types'
import { standardStartEligibility } from './startEligibility'
import type { ClassifiedPair, GroupEvaluationContext, GroupValidation, RuleSet } from './types'

// 第34回埼玉県女子リーグ大会 (PROJECT_RULES/02_CONFIRMED_RULES.md). This is the
// rule set the app was built and field-tested with; the rules below were
// moved here from engine.ts / matchSetup.ts unchanged.

export const MAX_USED_SUBSTITUTES = 9
export const MAX_SECOND_HALF_OPPORTUNITIES = 3
export const MAX_REENTRY_PLAYERS = 3
export const MAX_SQUAD_SIZE = 20
export const MAX_STARTERS = 11

/**
 * Whether the same player may re-enter more than once in a match is
 * PENDING per PROJECT_RULES/04_PENDING.md — it is under confirmation with
 * the tournament organizer and must not be guessed at (allowed or
 * disallowed) by this codebase.
 *
 * This isolates that single unresolved question so the rest of the
 * substitution engine never encodes an opinion about it. Once an answer is
 * confirmed, only this policy (and its tests) should need to change.
 *
 * Current behavior: a player's *second* re-entry attempt is blocked with a
 * message explaining the rule is not yet confirmed, rather than silently
 * allowed or silently denied as a permanent ruling.
 */
const repeatReentryPolicy: ReentryPolicy = {
  checkRepeatReentry(player, runtime) {
    if (runtime.reentryCount >= 1) {
      return {
        allowed: false,
        message: `${player.number}番はすでに一度再出場しています。2回目以降の再出場は大会ルール未確定のため、現時点では行えません。`,
      }
    }
    return { allowed: true }
  },
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

function evaluateGroup(ctx: GroupEvaluationContext): GroupValidation {
  const { state, roster, phase, group, describe } = ctx
  const rosterById = new Map(roster.map((p) => [p.id, p]))
  const errors: string[] = []

  // Classify NORMAL vs REENTRY. Evaluate the group as a whole so that
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

    const repeatDecision = repeatReentryPolicy.checkRepeatReentry(inPlayer, inRuntime)
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

function applyCounters(
  counters: TeamCounters,
  args: {
    phase: 'FIRST_HALF' | 'HALF_TIME' | 'SECOND_HALF'
    group: { pairs: SubstitutionPair[] }
    classifiedPairs: ClassifiedPair[]
  },
): TeamCounters {
  const next: TeamCounters = {
    usedSubstituteIds: [...counters.usedSubstituteIds],
    secondHalfOpportunitiesUsed: counters.secondHalfOpportunitiesUsed,
    reentryPlayerIds: [...counters.reentryPlayerIds],
  }

  for (const { pair, classification } of args.classifiedPairs) {
    if (classification === 'NORMAL' && !next.usedSubstituteIds.includes(pair.inPlayerId)) {
      next.usedSubstituteIds.push(pair.inPlayerId)
    }
    if (classification === 'REENTRY' && !next.reentryPlayerIds.includes(pair.inPlayerId)) {
      next.reentryPlayerIds.push(pair.inPlayerId)
    }
  }

  if (args.phase === 'SECOND_HALF' && args.group.pairs.length > 0) {
    next.secondHalfOpportunitiesUsed += 1
  }

  return next
}

function describeUnavailability(args: {
  state: MatchState
  roster: Player[]
  teamId: TeamId
  phase: 'FIRST_HALF' | 'HALF_TIME' | 'SECOND_HALF'
  playerId: string
  otherPairsInGroup: SubstitutionPair[]
}): string | null {
  const { state, roster, teamId, phase, playerId, otherPairsInGroup } = args
  const runtime: PlayerRuntimeState | undefined = state.players[playerId]
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

  const repeatDecision = repeatReentryPolicy.checkRepeatReentry(player, runtime)
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

export const saitamaWomenRules: RuleSet = {
  id: 'saitama-women',
  name: '埼玉県女子リーグ',
  defaultHalfLengthMinutes: 30,
  maxSquadSize: MAX_SQUAD_SIZE,
  maxStarters: MAX_STARTERS,
  evaluateStartEligibility: standardStartEligibility,
  evaluateGroup,
  applyCounters,
  describeUnavailability,
  secondHalfOpportunityLimit: MAX_SECOND_HALF_OPPORTUNITIES,
  reentryPlayerLimit: MAX_REENTRY_PLAYERS,
}
