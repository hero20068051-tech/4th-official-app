import type {
  MatchState,
  Player,
  PlayerCategory,
  SubstitutionPair,
  SubstitutionPhase,
  TeamCounters,
  TeamId,
  TeamSubstitutionGroup,
} from '../types'
import type { RuleSetId } from './ids'

export type StartEligibility =
  | { level: 'OK' }
  | { level: 'WARN'; message: string }
  | { level: 'BLOCK'; message: string }

export interface ClassifiedPair {
  pair: SubstitutionPair
  classification: 'NORMAL' | 'REENTRY'
}

export interface GroupValidation {
  errors: string[]
  classifiedPairs: ClassifiedPair[]
}

// What a rule set is shown when it judges one team's substitution group
// (after the engine has already checked the rule-independent basics: right
// team, the OUT player is on the pitch, the IN player is on the bench, no
// player used twice).
export interface GroupEvaluationContext {
  state: MatchState
  roster: Player[]
  phase: SubstitutionPhase
  group: TeamSubstitutionGroup
  describe: (playerId: string) => string
}

export interface PlayerCategoryOption {
  id: PlayerCategory
  label: string // "小学生"
  shortLabel: string // small tag on a number chip
}

export interface CounterViewArgs {
  counters: TeamCounters
  phase: 'PRE_MATCH' | 'FIRST_HALF' | 'HALF_TIME' | 'SECOND_HALF' | 'FULL_TIME'
  roster: Player[]
  teamId: TeamId
}

// A tournament's rules. The app core (clock, goals, cards, timeline, saving,
// archive, sharing, the event-log replay) never mentions a tournament by name;
// it asks the rule set selected for the match.
export interface RuleSet {
  readonly id: RuleSetId
  readonly name: string

  // --- setting up a match
  readonly defaultHalfLengthMinutes: number
  // null = no limit is defined
  readonly maxSquadSize: number | null
  readonly maxStarters: number
  evaluateStartEligibility(starterCount: number): StartEligibility
  // Whether the roster screen offers "GK registration" (only rules that use it).
  readonly usesGoalkeeperRegistration: boolean
  // null = this tournament does not distinguish player categories
  readonly playerCategories: readonly PlayerCategoryOption[] | null
  // Problems with who is registered (blocks the change). Empty = fine.
  checkRegistration(roster: Player[], teamId: TeamId): string[]
  // Problems that stop a team from kicking off with this line-up. Empty = fine.
  checkStartingLineup(roster: Player[], teamId: TeamId): string[]

  // --- substitutions
  // The rules after the rule-independent basics: who counts as a re-entry,
  // whether it is allowed, and every cap. Judges the whole group at once.
  evaluateGroup(ctx: GroupEvaluationContext): GroupValidation
  // Does this (legal) group use up one of the limited second-half substitution opportunities?
  groupCountsAsSecondHalfOpportunity(group: TeamSubstitutionGroup, roster: Player[]): boolean
  // How the team's counters change when a legal group is applied.
  applyCounters(
    counters: TeamCounters,
    args: { phase: SubstitutionPhase; group: TeamSubstitutionGroup; classifiedPairs: ClassifiedPair[]; roster: Player[] },
  ): TeamCounters
  // Why a bench player cannot come on right now (null = could). `otherPairsInGroup`
  // are the other complete pairs of the substitution still being assembled.
  describeUnavailability(args: {
    state: MatchState
    roster: Player[]
    teamId: TeamId
    phase: SubstitutionPhase
    playerId: string
    otherPairsInGroup: SubstitutionPair[]
    // The OUT player already chosen for the pair being built, if any.
    pairOutPlayerId?: string
  }): string | null

  // --- what the screens show about the limits (null = no such limit)
  readonly secondHalfOpportunityLimit: number | null
  readonly reentryPlayerLimit: number | null
  // The line under the substitution panel's title (null = nothing to show).
  panelSummary(view: CounterViewArgs): string | null
  // Standing notices about exhausted limits.
  panelNotices(view: CounterViewArgs): string[]
  // Whether the whole substitution panel is closed (nothing can be entered).
  isPanelLocked(view: CounterViewArgs): boolean
  // Short remaining-opportunities badge on the team card (null = none).
  secondHalfBadge(view: CounterViewArgs): string | null
}
