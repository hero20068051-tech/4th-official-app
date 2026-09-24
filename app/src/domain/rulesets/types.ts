import type {
  MatchState,
  Player,
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

  // --- substitutions
  // The rules after the rule-independent basics: who counts as a re-entry,
  // whether it is allowed, and every cap. Judges the whole group at once.
  evaluateGroup(ctx: GroupEvaluationContext): GroupValidation
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
  }): string | null

  // --- what the screens show about the limits (null = no such limit)
  readonly secondHalfOpportunityLimit: number | null
  readonly reentryPlayerLimit: number | null
}
