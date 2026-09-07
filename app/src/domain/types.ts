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
