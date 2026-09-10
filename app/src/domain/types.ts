export type TeamId = 'HOME' | 'AWAY'

export type MatchPhase =
  | 'PRE_MATCH'
  | 'FIRST_HALF'
  | 'HALF_TIME'
  | 'SECOND_HALF'
  | 'FULL_TIME'

// Substitutions can only occur once the match has kicked off and before full time.
export type SubstitutionPhase = Extract<
  MatchPhase,
  'FIRST_HALF' | 'HALF_TIME' | 'SECOND_HALF'
>

export interface Player {
  id: string
  teamId: TeamId
  number: number
  isStarter: boolean
  // Whether the player is registered as a goalkeeper substitute, not whether
  // they are currently playing as GK. Multiple players may be true.
  isRegisteredGK: boolean
}

export interface SubstitutionPair {
  outPlayerId: string
  inPlayerId: string
}

export interface TeamSubstitutionGroup {
  teamId: TeamId
  pairs: SubstitutionPair[]
}

export interface SubstitutionEvent {
  id: string
  phase: SubstitutionPhase
  elapsedMs: number
  teamGroups: TeamSubstitutionGroup[]
  // Informational only — links this event to the opposing team's event from
  // the same real-world play stoppage, purely for the history display. Never
  // read by the legality/counter logic in engine.ts.
  stoppageGroupId?: string | null
}

export type SubstitutionClassification = 'NORMAL' | 'REENTRY'

// A pair being built by the operator before confirmation. Either side may be
// filled first (SPEC/Phase1_Spec_v0.2.md section 8); it never affects match
// state until confirmed into a SubstitutionEvent.
export interface DraftPair {
  outPlayerId?: string
  inPlayerId?: string
}

export interface TeamDraft {
  teamId: TeamId
  pairs: DraftPair[]
}

export type PlayerLocation = 'pitch' | 'bench'

export interface PlayerRuntimeState {
  location: PlayerLocation
  hasAppeared: boolean
  reentryCount: number
}

export interface TeamCounters {
  // Distinct bench players who have ever come on (cap: 9).
  usedSubstituteIds: string[]
  // Substitution opportunities consumed after second-half kickoff (cap: 3).
  secondHalfOpportunitiesUsed: number
  // Distinct players who have re-entered at least once since half-time (cap: 3).
  reentryPlayerIds: string[]
}

export interface MatchState {
  players: Record<string, PlayerRuntimeState>
  teamCounters: Record<TeamId, TeamCounters>
}

// An event that could not be legally replayed after an earlier edit/cancel
// must be flagged for human review, never silently dropped or re-legalized.
export interface ReplayIssue {
  eventId: string
  messages: string[]
}

export interface ReplayResult {
  state: MatchState
  needsReview: ReplayIssue[]
}

// --- Phase 2 v0.1: goals and cards ---
// These live in their own arrays alongside substitutionEvents and are NEVER
// read by engine.ts / replayMatch. A red card has no effect on substitution
// legality or the 9 / 3 / 3 counters in v0.1 — detailed send-off player
// state is a FUTURE item (PROJECT_RULES/05_FUTURE_IDEAS.md).

export type CardKind = 'YELLOW' | 'RED'

export type TeamOfficialRole = 'MANAGER' | 'COACH' | 'STAFF' | 'OTHER'

// Phases in which a goal or card can be recorded — never PRE_MATCH, since the
// match screen is not shown then.
export type RecordablePhase = 'FIRST_HALF' | 'HALF_TIME' | 'SECOND_HALF' | 'FULL_TIME'

// A goal. The score is ALWAYS derived by counting these per team
// (matchRecord.deriveScore) — never stored — so editing or deleting a goal
// keeps the score correct automatically.
export interface GoalEvent {
  id: string
  phase: RecordablePhase
  elapsedMs: number
  // The team the goal counts FOR. For an own goal this is the team that
  // benefits (the opponent of the player who put it in).
  teamId: TeamId
  scorerNumber: number | null // null = 得点者未確認
  ownGoal: boolean
  ownGoalByNumber: number | null // the opposing player who put it in; null = 背番号不明
}

// A caution or send-off, for a player (by number) or a team official.
export interface CardEvent {
  id: string
  phase: RecordablePhase
  elapsedMs: number
  teamId: TeamId
  card: CardKind
  targetType: 'PLAYER' | 'OFFICIAL'
  playerNumber: number | null // set when targetType === 'PLAYER'
  officialRole: TeamOfficialRole | null // set when targetType === 'OFFICIAL'
  officialName: string // optional free text; '' when not entered
}
