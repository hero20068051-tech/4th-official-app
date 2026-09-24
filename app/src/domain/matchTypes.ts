export type HydrationMode = 'NONE' | 'RUNNING_CLOCK' | 'STOP_CLOCK'

import type { RuleSetId } from './rulesets/ids'

export interface MatchSettings {
  // Which tournament's rules this match is played under. Absent on matches
  // saved before rule sets existed; those read as the default (Saitama women's league).
  rulesetId?: RuleSetId
  homeTeamName: string
  awayTeamName: string
  halfLengthMinutes: number
  hydrationMode: HydrationMode
  hydrationMemo: string
}

export type HalfKey = 'firstHalf' | 'secondHalf'

// Whether hydration has been marked done for that half — independent of the
// clock (RUNNING_CLOCK mode never pauses it) and tracked per half so the
// second half starts with its own fresh reminder.
export type HydrationCompletionState = Record<HalfKey, boolean>

export interface ClockState {
  firstHalfStartedAt: number | null
  firstHalfEndedAt: number | null
  secondHalfStartedAt: number | null
  secondHalfEndedAt: number | null
  pausedAccumulatedMsByHalf: Record<HalfKey, number>
  activePauseStartedAt: number | null
}
