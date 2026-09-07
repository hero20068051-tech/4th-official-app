import type { ClockState, HalfKey } from './matchTypes'
import type { MatchPhase } from './types'

export function createInitialClockState(): ClockState {
  return {
    firstHalfStartedAt: null,
    firstHalfEndedAt: null,
    secondHalfStartedAt: null,
    secondHalfEndedAt: null,
    pausedAccumulatedMsByHalf: { firstHalf: 0, secondHalf: 0 },
    activePauseStartedAt: null,
  }
}

export function startFirstHalf(clock: ClockState, now: number): ClockState {
  if (clock.firstHalfStartedAt !== null) return clock
  return { ...clock, firstHalfStartedAt: now }
}

export function endFirstHalf(clock: ClockState, now: number): ClockState {
  return { ...clock, firstHalfEndedAt: now }
}

export function startSecondHalf(clock: ClockState, now: number): ClockState {
  if (clock.secondHalfStartedAt !== null) return clock
  return { ...clock, secondHalfStartedAt: now }
}

export function endSecondHalf(clock: ClockState, now: number): ClockState {
  return { ...clock, secondHalfEndedAt: now }
}

// Lets the operator fix the recorded kickoff/second-half-start time when the
// start button was pressed late (SPEC/Phase1_Spec_v0.2.md 6.4). Kept out of
// the main flow by the UI, not by this function.
export function correctHalfStartedAt(clock: ClockState, half: HalfKey, correctedAt: number): ClockState {
  return half === 'firstHalf'
    ? { ...clock, firstHalfStartedAt: correctedAt }
    : { ...clock, secondHalfStartedAt: correctedAt }
}

// Only meaningful when hydrationMode is STOP_CLOCK; the caller is
// responsible for only invoking these during that mode (03_PHASE1_SCOPE.md
// section 6 / SPEC section 6.3 — routine substitutions never pause the clock).
export function startHydrationPause(clock: ClockState, now: number): ClockState {
  if (clock.activePauseStartedAt !== null) return clock
  return { ...clock, activePauseStartedAt: now }
}

export function endHydrationPause(clock: ClockState, now: number, currentHalf: HalfKey): ClockState {
  if (clock.activePauseStartedAt === null) return clock
  const pausedMs = Math.max(0, now - clock.activePauseStartedAt)
  return {
    ...clock,
    activePauseStartedAt: null,
    pausedAccumulatedMsByHalf: {
      ...clock.pausedAccumulatedMsByHalf,
      [currentHalf]: clock.pausedAccumulatedMsByHalf[currentHalf] + pausedMs,
    },
  }
}

function halfKeyForPhase(phase: MatchPhase): HalfKey | null {
  if (phase === 'FIRST_HALF') return 'firstHalf'
  if (phase === 'SECOND_HALF') return 'secondHalf'
  return null
}

// Always derives elapsed time from stored timestamps rather than an
// incrementing counter, so it survives screen lock, backgrounding, and page
// reloads (SPEC/Phase1_Spec_v0.2.md 6.1).
export function computeElapsedMs(clock: ClockState, phase: MatchPhase, now: number): number {
  const halfKey = halfKeyForPhase(phase)
  if (!halfKey) {
    if (phase === 'HALF_TIME') return clock.firstHalfEndedAt !== null && clock.firstHalfStartedAt !== null
      ? clock.firstHalfEndedAt - clock.firstHalfStartedAt - clock.pausedAccumulatedMsByHalf.firstHalf
      : 0
    if (phase === 'FULL_TIME') {
      return clock.secondHalfEndedAt !== null && clock.secondHalfStartedAt !== null
        ? clock.secondHalfEndedAt - clock.secondHalfStartedAt - clock.pausedAccumulatedMsByHalf.secondHalf
        : 0
    }
    return 0
  }

  const startedAt = halfKey === 'firstHalf' ? clock.firstHalfStartedAt : clock.secondHalfStartedAt
  if (startedAt === null) return 0

  const rawElapsed = now - startedAt
  const pausedSoFar =
    clock.pausedAccumulatedMsByHalf[halfKey] +
    (clock.activePauseStartedAt !== null ? Math.max(0, now - clock.activePauseStartedAt) : 0)

  return Math.max(0, rawElapsed - pausedSoFar)
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

// Above this, an elapsed time for a single half is treated as clearly wrong
// rather than a real (if unusual) match — used both to reject an obviously
// mistaken manual correction and to flag a resumed match whose stored
// timestamps imply the device sat untouched for an implausible stretch.
export const MAX_REASONABLE_ELAPSED_MS = 180 * 60 * 1000

export type ParsedElapsedResult = { ok: true; ms: number } | { ok: false; error: string }

// Parses an operator-entered "how much time has actually passed" value,
// e.g. "2:00" (2 minutes) or "1:02:00" (1 hour 2 minutes), never a
// time-of-day — that ambiguity is what let a "00:02:00" entry meant as "2
// minutes" be read as a clock time and jump the match clock by ~20 hours.
export function parseElapsedInput(input: string): ParsedElapsedResult {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return { ok: false, error: '経過時間を入力してください' }
  }

  const parts = trimmed.split(':').map((p) => p.trim())
  if (parts.length < 1 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) {
    return { ok: false, error: '「分:秒」の形式で入力してください（例: 2:00）' }
  }

  const numbers = parts.map(Number)
  // Only "h:mm:ss" caps minutes at 59 (the hours place absorbs the rest);
  // a bare "mm:ss" is read as a total minute count, so "180:00" is valid.
  const [hours, minutes, seconds] =
    numbers.length === 3
      ? numbers
      : numbers.length === 2
        ? [0, numbers[0], numbers[1]]
        : [0, numbers[0], 0]

  if (seconds >= 60 || (numbers.length === 3 && minutes >= 60)) {
    return { ok: false, error: '「分:秒」の形式で入力してください（例: 2:00）' }
  }

  const ms = ((hours * 60 + minutes) * 60 + seconds) * 1000
  if (ms > MAX_REASONABLE_ELAPSED_MS) {
    return { ok: false, error: `経過時間として長すぎます（上限${MAX_REASONABLE_ELAPSED_MS / 60000}分）` }
  }

  return { ok: true, ms }
}

// The timestamp to store as the half's start so that, from `now`, computing
// elapsed time yields exactly `elapsedMs`.
export function startedAtForElapsed(now: number, elapsedMs: number): number {
  return now - elapsedMs
}
