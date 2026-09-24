import type { MatchState, Player, PlayerCategory, SubstitutionPair, TeamCounters, TeamId } from '../types'
import { standardStartEligibility } from './startEligibility'
import type {
  ClassifiedPair,
  CounterViewArgs,
  GroupEvaluationContext,
  GroupValidation,
  PlayerCategoryOption,
  RuleSet,
} from './types'

// U13育成リーグ. Confirmed with the operator (2026-09-24/25):
//  - 11-a-side, 60 min (30 min halves), 10 min half-time.
//  - Elementary school players (小学生): free substitution, re-entry allowed
//    from the first half, no unlocking condition, no cap on re-entry players
//    or times, and none of the limits below apply to them.
//  - Junior-high players (中1 / 中2): not free. They may NOT re-enter once they
//    have played (starter or substitute), whoever they are swapped with.
//    At most 7 junior-high players may come ON over the whole match, and at
//    most 3 second-half substitution opportunities may include a junior-high
//    player coming on (a group counts once however many come on; half-time and
//    the first half do not use these opportunities).
//  - 中2 (over-age): at most 5 registered, at most 3 on the pitch at any time
//    (judged on the pitch AFTER the whole substitution group, from kick-off).
//  - The kick-off headcount rule is the same as the other league (11 / 7-10
//    confirm / 6 or fewer no). No overall squad-size limit is defined (not
//    confirmed — deliberately left unset, not borrowed from another league).
//  - A group with a junior-high IN is judged by the IN player's category; an
//    elementary IN is free even when a junior-high player goes OFF.

export const U13_MAX_JUNIOR_HIGH_SUBSTITUTES = 7
export const U13_MAX_SECOND_HALF_JUNIOR_HIGH_OPPORTUNITIES = 3
export const U13_MAX_JUNIOR_HIGH_2_REGISTERED = 5
export const U13_MAX_JUNIOR_HIGH_2_ON_PITCH = 3

export const U13_CATEGORIES: readonly PlayerCategoryOption[] = [
  { id: 'ELEMENTARY', label: '小学生', shortLabel: '小' },
  { id: 'JUNIOR_HIGH_1', label: '中1', shortLabel: '中1' },
  { id: 'JUNIOR_HIGH_2', label: '中2', shortLabel: '中2' },
]

const isJuniorHigh = (c: PlayerCategory | undefined) => c === 'JUNIOR_HIGH_1' || c === 'JUNIOR_HIGH_2'
const JH2: PlayerCategory = 'JUNIOR_HIGH_2'

function teamPlayers(roster: Player[], teamId: TeamId): Player[] {
  return roster.filter((p) => p.teamId === teamId)
}

function checkRegistration(roster: Player[], teamId: TeamId): string[] {
  const count = teamPlayers(roster, teamId).filter((p) => p.category === JH2).length
  return count > U13_MAX_JUNIOR_HIGH_2_REGISTERED ? [`中2は${U13_MAX_JUNIOR_HIGH_2_REGISTERED}名までです`] : []
}

function checkStartingLineup(roster: Player[], teamId: TeamId): string[] {
  const players = teamPlayers(roster, teamId)
  const errors: string[] = []
  const unset = players.filter((p) => p.category === undefined).length
  if (unset > 0) errors.push(`選手区分が未設定の選手が${unset}名います`)
  const jh2Starters = players.filter((p) => p.isStarter && p.category === JH2).length
  if (jh2Starters > U13_MAX_JUNIOR_HIGH_2_ON_PITCH) {
    errors.push(`中2は先発に${U13_MAX_JUNIOR_HIGH_2_ON_PITCH}名までです（現在${jh2Starters}名）`)
  }
  return errors
}

function categoryOf(roster: Player[], id: string): PlayerCategory | undefined {
  return roster.find((p) => p.id === id)?.category
}

function groupHasJuniorHighIn(group: { pairs: SubstitutionPair[] }, roster: Player[]): boolean {
  return group.pairs.some((pair) => isJuniorHigh(categoryOf(roster, pair.inPlayerId)))
}

function evaluateGroup(ctx: GroupEvaluationContext): GroupValidation {
  const { state, roster, phase, group, describe } = ctx
  const errors: string[] = []
  const classifiedPairs: ClassifiedPair[] = []
  const newJuniorHighIds = new Set<string>()

  for (const pair of group.pairs) {
    const inRuntime = state.players[pair.inPlayerId]
    const category = categoryOf(roster, pair.inPlayerId)
    if (category === undefined) {
      errors.push(`${describe(pair.inPlayerId)}は選手区分が未設定です`)
      continue
    }
    if (isJuniorHigh(category)) {
      // No re-entry for junior-high players: once on the pitch (as starter or
      // substitute), never again after going off.
      if (inRuntime.hasAppeared) {
        errors.push(`${describe(pair.inPlayerId)}は中学生のため再出場できません`)
        continue
      }
      newJuniorHighIds.add(pair.inPlayerId)
      classifiedPairs.push({ pair, classification: 'NORMAL' })
    } else {
      // Elementary: free substitution and free re-entry, no conditions.
      classifiedPairs.push({ pair, classification: inRuntime.hasAppeared ? 'REENTRY' : 'NORMAL' })
    }
  }
  if (errors.length > 0) return { errors, classifiedPairs: [] }

  // 中2 on the pitch, judged on the final picture of the whole group.
  const jh2In = group.pairs.filter((p) => categoryOf(roster, p.inPlayerId) === JH2).length
  if (jh2In > 0) {
    const jh2Off = group.pairs.filter((p) => categoryOf(roster, p.outPlayerId) === JH2).length
    const jh2Now = teamPlayers(roster, group.teamId).filter(
      (p) => p.category === JH2 && state.players[p.id].location === 'pitch',
    ).length
    const after = jh2Now - jh2Off + jh2In
    if (after > U13_MAX_JUNIOR_HIGH_2_ON_PITCH) {
      errors.push(
        `中2は同時にピッチに${U13_MAX_JUNIOR_HIGH_2_ON_PITCH}名までです（この交代で${after}名になります）`,
      )
      return { errors, classifiedPairs: [] }
    }
  }

  if (newJuniorHighIds.size > 0) {
    const counters = state.teamCounters[group.teamId]
    if (phase === 'SECOND_HALF' && counters.secondHalfOpportunitiesUsed >= U13_MAX_SECOND_HALF_JUNIOR_HIGH_OPPORTUNITIES) {
      errors.push(`後半の中学生の交代は${U13_MAX_SECOND_HALF_JUNIOR_HIGH_OPPORTUNITIES}回までです`)
      return { errors, classifiedPairs: [] }
    }
    const projected = new Set([...counters.usedSubstituteIds, ...newJuniorHighIds]).size
    if (projected > U13_MAX_JUNIOR_HIGH_SUBSTITUTES) {
      errors.push(`中学生の交代は${U13_MAX_JUNIOR_HIGH_SUBSTITUTES}名までです`)
      return { errors, classifiedPairs: [] }
    }
  }

  return { errors: [], classifiedPairs }
}

function applyCounters(
  counters: TeamCounters,
  args: { phase: 'FIRST_HALF' | 'HALF_TIME' | 'SECOND_HALF'; group: { pairs: SubstitutionPair[] }; classifiedPairs: ClassifiedPair[]; roster: Player[] },
): TeamCounters {
  const next: TeamCounters = {
    // here: the distinct junior-high players who have come ON
    usedSubstituteIds: [...counters.usedSubstituteIds],
    secondHalfOpportunitiesUsed: counters.secondHalfOpportunitiesUsed,
    // informational only for U13 (no cap): elementary players who have re-entered
    reentryPlayerIds: [...counters.reentryPlayerIds],
  }
  for (const { pair, classification } of args.classifiedPairs) {
    if (classification === 'NORMAL' && isJuniorHigh(categoryOf(args.roster, pair.inPlayerId))) {
      if (!next.usedSubstituteIds.includes(pair.inPlayerId)) next.usedSubstituteIds.push(pair.inPlayerId)
    }
    if (classification === 'REENTRY' && !next.reentryPlayerIds.includes(pair.inPlayerId)) {
      next.reentryPlayerIds.push(pair.inPlayerId)
    }
  }
  if (args.phase === 'SECOND_HALF' && groupHasJuniorHighIn(args.group, args.roster)) {
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
  pairOutPlayerId?: string
}): string | null {
  const { state, roster, teamId, phase, playerId, otherPairsInGroup, pairOutPlayerId } = args
  const runtime = state.players[playerId]
  const player = roster.find((p) => p.id === playerId)
  if (!runtime || !player) return null
  if (player.category === undefined) return '選手区分が未設定です'
  if (!isJuniorHigh(player.category)) return null // elementary: free

  if (runtime.hasAppeared) return '中学生は一度交代すると再出場できません'

  const counters = state.teamCounters[teamId]
  const othersJuniorHighIn = otherPairsInGroup
    .map((p) => p.inPlayerId)
    .filter((id) => isJuniorHigh(categoryOf(roster, id)) && state.players[id] && !state.players[id].hasAppeared)

  // The group counts as one opportunity if any junior-high player comes on.
  if (phase === 'SECOND_HALF' && othersJuniorHighIn.length === 0 && counters.secondHalfOpportunitiesUsed >= U13_MAX_SECOND_HALF_JUNIOR_HIGH_OPPORTUNITIES) {
    return `後半の中学生の交代は${U13_MAX_SECOND_HALF_JUNIOR_HIGH_OPPORTUNITIES}回までです`
  }

  const used = new Set([...counters.usedSubstituteIds, ...othersJuniorHighIn])
  if (!used.has(playerId) && used.size >= U13_MAX_JUNIOR_HIGH_SUBSTITUTES) {
    return `中学生の交代は${U13_MAX_JUNIOR_HIGH_SUBSTITUTES}名までです`
  }

  // 中2: only decidable once the OUT player of this pair is known.
  if (player.category === JH2 && pairOutPlayerId) {
    const pairs: SubstitutionPair[] = [...otherPairsInGroup, { outPlayerId: pairOutPlayerId, inPlayerId: playerId }]
    const now = teamPlayers(roster, teamId).filter((p) => p.category === JH2 && state.players[p.id].location === 'pitch').length
    const off = pairs.filter((p) => categoryOf(roster, p.outPlayerId) === JH2).length
    const inn = pairs.filter((p) => categoryOf(roster, p.inPlayerId) === JH2).length
    if (now - off + inn > U13_MAX_JUNIOR_HIGH_2_ON_PITCH) {
      return `中2がすでにピッチに${U13_MAX_JUNIOR_HIGH_2_ON_PITCH}名います`
    }
  }
  return null
}

function juniorHighUsed(view: CounterViewArgs): number {
  return view.counters.usedSubstituteIds.length
}
function secondHalfRemaining(view: CounterViewArgs): number {
  return U13_MAX_SECOND_HALF_JUNIOR_HIGH_OPPORTUNITIES - view.counters.secondHalfOpportunitiesUsed
}

export const u13DevelopmentRules: RuleSet = {
  id: 'u13-development',
  name: 'U13育成リーグ',
  defaultHalfLengthMinutes: 30,
  maxSquadSize: null, // not confirmed by the tournament rules provided — left unset on purpose
  maxStarters: 11,
  evaluateStartEligibility: standardStartEligibility,
  usesGoalkeeperRegistration: false,
  playerCategories: U13_CATEGORIES,
  checkRegistration,
  checkStartingLineup,
  evaluateGroup,
  groupCountsAsSecondHalfOpportunity: groupHasJuniorHighIn,
  applyCounters,
  describeUnavailability,
  secondHalfOpportunityLimit: U13_MAX_SECOND_HALF_JUNIOR_HIGH_OPPORTUNITIES,
  reentryPlayerLimit: null,
  panelSummary(view) {
    const base = `中学生の交代 ${juniorHighUsed(view)}/${U13_MAX_JUNIOR_HIGH_SUBSTITUTES}名`
    return view.phase === 'SECOND_HALF' ? `後半の中学生の交代 あと${Math.max(0, secondHalfRemaining(view))}回｜${base}` : base
  },
  panelNotices(view) {
    const notices: string[] = []
    if (view.phase === 'SECOND_HALF' && secondHalfRemaining(view) <= 0) {
      notices.push(`後半の中学生の交代を${U13_MAX_SECOND_HALF_JUNIOR_HIGH_OPPORTUNITIES}回使っています（小学生の交代はできます）`)
    }
    if (juniorHighUsed(view) >= U13_MAX_JUNIOR_HIGH_SUBSTITUTES) {
      notices.push(`中学生の交代は${U13_MAX_JUNIOR_HIGH_SUBSTITUTES}名まで使用済みです（小学生の交代はできます）`)
    }
    return notices
  },
  // Elementary swaps stay free, so the panel is never closed as a whole.
  isPanelLocked: () => false,
  secondHalfBadge(view) {
    return view.phase === 'SECOND_HALF' ? `中学生の後半交代 あと${Math.max(0, secondHalfRemaining(view))}回` : null
  },
}
