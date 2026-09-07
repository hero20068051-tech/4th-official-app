import { describe, expect, it } from 'vitest'
import {
  MAX_REASONABLE_ELAPSED_MS,
  computeElapsedMs,
  correctHalfStartedAt,
  createInitialClockState,
  endHydrationPause,
  parseElapsedInput,
  startFirstHalf,
  startHydrationPause,
  startSecondHalf,
  startedAtForElapsed,
} from './clock'

describe('computeElapsedMs', () => {
  it('derives elapsed time from the stored start timestamp, not a counter', () => {
    let clock = createInitialClockState()
    const start = 1_000_000
    clock = startFirstHalf(clock, start)
    expect(computeElapsedMs(clock, 'FIRST_HALF', start + 90_000)).toBe(90_000)
  })

  it('survives being recomputed later (reload / background) from the same timestamps', () => {
    let clock = createInitialClockState()
    const start = 1_000_000
    clock = startFirstHalf(clock, start)
    // Simulate a reload: a fresh call, much later, with the same stored clock.
    expect(computeElapsedMs(clock, 'FIRST_HALF', start + 600_000)).toBe(600_000)
  })

  it('returns 0 before kickoff', () => {
    const clock = createInitialClockState()
    expect(computeElapsedMs(clock, 'FIRST_HALF', 5_000)).toBe(0)
  })

  it('tracks the second half independently of the first half', () => {
    let clock = createInitialClockState()
    clock = startFirstHalf(clock, 0)
    clock = startSecondHalf(clock, 100_000)
    expect(computeElapsedMs(clock, 'SECOND_HALF', 130_000)).toBe(30_000)
  })
})

describe('hydration stop-clock pause/resume', () => {
  it('excludes paused time from elapsed once resumed', () => {
    let clock = createInitialClockState()
    clock = startFirstHalf(clock, 0)
    clock = startHydrationPause(clock, 10_000)
    clock = endHydrationPause(clock, 15_000, 'firstHalf')
    // 20s elapsed, 5s of which was paused -> 15s of match time.
    expect(computeElapsedMs(clock, 'FIRST_HALF', 20_000)).toBe(15_000)
  })

  it('excludes the ongoing pause even before it is resumed', () => {
    let clock = createInitialClockState()
    clock = startFirstHalf(clock, 0)
    clock = startHydrationPause(clock, 10_000)
    // Still paused at t=25_000: elapsed should freeze at 10s.
    expect(computeElapsedMs(clock, 'FIRST_HALF', 25_000)).toBe(10_000)
  })

  it('a normal substitution does not pause the clock (no-op unless paused explicitly)', () => {
    let clock = createInitialClockState()
    clock = startFirstHalf(clock, 0)
    expect(computeElapsedMs(clock, 'FIRST_HALF', 30_000)).toBe(30_000)
  })
})

describe('correctHalfStartedAt', () => {
  it('lets a forgotten kickoff time be corrected after the fact', () => {
    let clock = createInitialClockState()
    clock = startFirstHalf(clock, 5_000) // pressed 5s late
    clock = correctHalfStartedAt(clock, 'firstHalf', 0)
    expect(computeElapsedMs(clock, 'FIRST_HALF', 10_000)).toBe(10_000)
  })
})

describe('parseElapsedInput', () => {
  it('parses "mm:ss" as elapsed minutes and seconds, not a time of day', () => {
    const result = parseElapsedInput('2:00')
    expect(result).toEqual({ ok: true, ms: 120_000 })
  })

  it('parses "h:mm:ss"', () => {
    expect(parseElapsedInput('1:02:03')).toEqual({ ok: true, ms: (3723) * 1000 })
  })

  it('parses a bare number of minutes', () => {
    expect(parseElapsedInput('5')).toEqual({ ok: true, ms: 300_000 })
  })

  it('rejects empty input', () => {
    const result = parseElapsedInput('  ')
    expect(result.ok).toBe(false)
  })

  it('rejects malformed input instead of guessing', () => {
    expect(parseElapsedInput('abc').ok).toBe(false)
    expect(parseElapsedInput('2:99').ok).toBe(false)
    expect(parseElapsedInput('99:00:00:00').ok).toBe(false)
  })

  it('rejects an implausibly long elapsed time instead of silently accepting it', () => {
    // The reported bug: "00:02:00" typed meaning "2 minutes" but read as a
    // time-of-day used to produce elapsed times over 1000 minutes.
    const result = parseElapsedInput('1244:00')
    expect(result.ok).toBe(false)
  })

  it('accepts exactly the maximum reasonable elapsed time', () => {
    const minutes = MAX_REASONABLE_ELAPSED_MS / 60_000
    expect(parseElapsedInput(`${minutes}:00`)).toEqual({ ok: true, ms: MAX_REASONABLE_ELAPSED_MS })
  })
})

describe('startedAtForElapsed', () => {
  it('computes a start timestamp that reproduces the requested elapsed time', () => {
    const now = 1_000_000
    const startedAt = startedAtForElapsed(now, 120_000)
    expect(now - startedAt).toBe(120_000)
  })
})
