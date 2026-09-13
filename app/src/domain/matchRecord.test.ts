import { describe, expect, it } from 'vitest'
import { createInitialClockState } from './clock'
import { buildTimeline, countPlayerYellows, deriveScore, playerYellowOrdinal } from './matchRecord'
import type { CardEvent, GoalEvent, SubstitutionEvent } from './types'

function goal(partial: Partial<GoalEvent>): GoalEvent {
  return {
    id: partial.id ?? `g${Math.random()}`,
    phase: partial.phase ?? 'FIRST_HALF',
    elapsedMs: partial.elapsedMs ?? 0,
    teamId: partial.teamId ?? 'HOME',
    scorerNumber: partial.scorerNumber ?? null,
    ownGoal: partial.ownGoal ?? false,
    ownGoalByNumber: partial.ownGoalByNumber ?? null,
  }
}

function card(partial: Partial<CardEvent>): CardEvent {
  return {
    id: partial.id ?? `c${Math.random()}`,
    phase: partial.phase ?? 'FIRST_HALF',
    elapsedMs: partial.elapsedMs ?? 0,
    teamId: partial.teamId ?? 'HOME',
    card: partial.card ?? 'YELLOW',
    targetType: partial.targetType ?? 'PLAYER',
    playerNumber: partial.playerNumber ?? null,
    officialRole: partial.officialRole ?? null,
    officialName: partial.officialName ?? '',
  }
}

describe('deriveScore', () => {
  it('counts goals per team, including own goals credited to the beneficiary', () => {
    const goals = [
      goal({ teamId: 'HOME', scorerNumber: 10 }),
      goal({ teamId: 'AWAY', scorerNumber: 7 }),
      goal({ teamId: 'HOME', scorerNumber: null }), // 得点者未確認 still counts
      goal({ teamId: 'HOME', ownGoal: true, ownGoalByNumber: 4 }), // OG by AWAY #4, counts for HOME
    ]
    expect(deriveScore(goals)).toEqual({ HOME: 3, AWAY: 1 })
  })

  it('is 0-0 with no goals', () => {
    expect(deriveScore([])).toEqual({ HOME: 0, AWAY: 0 })
  })
})

describe('player yellow ordinals', () => {
  it('countPlayerYellows counts only that player, that team, yellow cards', () => {
    const cards = [
      card({ teamId: 'HOME', playerNumber: 6, card: 'YELLOW' }),
      card({ teamId: 'HOME', playerNumber: 6, card: 'RED' }),
      card({ teamId: 'AWAY', playerNumber: 6, card: 'YELLOW' }),
      card({ teamId: 'HOME', playerNumber: 8, card: 'YELLOW' }),
    ]
    expect(countPlayerYellows(cards, 'HOME', 6)).toBe(1)
  })

  it('playerYellowOrdinal numbers a player’s yellows in timeline order', () => {
    const first = card({ id: 'y1', teamId: 'HOME', playerNumber: 6, card: 'YELLOW', phase: 'FIRST_HALF', elapsedMs: 21 * 60_000 })
    const second = card({ id: 'y2', teamId: 'HOME', playerNumber: 6, card: 'YELLOW', phase: 'SECOND_HALF', elapsedMs: 5 * 60_000 })
    const cards = [second, first]
    expect(playerYellowOrdinal(cards, 'y1')).toBe(1)
    expect(playerYellowOrdinal(cards, 'y2')).toBe(2)
  })

  it('renumbers automatically when an earlier yellow is removed', () => {
    const second = card({ id: 'y2', teamId: 'HOME', playerNumber: 6, card: 'YELLOW', elapsedMs: 2000 })
    expect(playerYellowOrdinal([second], 'y2')).toBe(1)
  })

  it('returns null for a red card or an official card', () => {
    const red = card({ id: 'r1', card: 'RED', playerNumber: 3 })
    const official = card({ id: 'o1', card: 'YELLOW', targetType: 'OFFICIAL', officialRole: 'MANAGER' })
    expect(playerYellowOrdinal([red], 'r1')).toBeNull()
    expect(playerYellowOrdinal([official], 'o1')).toBeNull()
  })
})

describe('buildTimeline', () => {
  function sub(partial: Partial<SubstitutionEvent>): SubstitutionEvent {
    return {
      id: partial.id ?? `s${Math.random()}`,
      phase: partial.phase ?? 'FIRST_HALF',
      elapsedMs: partial.elapsedMs ?? 0,
      teamGroups: partial.teamGroups ?? [{ teamId: 'HOME', pairs: [{ outPlayerId: 'HOME:10', inPlayerId: 'HOME:15' }] }],
      stoppageGroupId: partial.stoppageGroupId ?? null,
    }
  }

  const noHydration = { firstHalf: null, secondHalf: null }

  it('orders goals, cards and subs by (phase, elapsed) on one timeline', () => {
    const entries = buildTimeline({
      substitutionEvents: [sub({ id: 's1', phase: 'FIRST_HALF', elapsedMs: 18 * 60_000 })],
      goalEvents: [
        goal({ id: 'g1', phase: 'FIRST_HALF', elapsedMs: 5 * 60_000 }),
        goal({ id: 'g2', phase: 'SECOND_HALF', elapsedMs: 3 * 60_000 }),
      ],
      cardEvents: [card({ id: 'c1', phase: 'FIRST_HALF', elapsedMs: 11 * 60_000, teamId: 'AWAY' })],
      clock: createInitialClockState(),
      hydrationCompletionElapsedMsByHalf: noHydration,
    })
    expect(entries.map((e) => e.key)).toEqual(['g1', 'c1', 's1', 'g2'])
  })

  it('re-sorts automatically when a goal event is edited to a new time (no separate re-order step needed)', () => {
    const build = (g1ElapsedMs: number, g1Phase: 'FIRST_HALF' | 'SECOND_HALF') =>
      buildTimeline({
        substitutionEvents: [],
        goalEvents: [
          goal({ id: 'g1', phase: g1Phase, elapsedMs: g1ElapsedMs }),
          goal({ id: 'g2', phase: 'FIRST_HALF', elapsedMs: 10 * 60_000 }),
        ],
        cardEvents: [],
        clock: createInitialClockState(),
        hydrationCompletionElapsedMsByHalf: noHydration,
      })

    // Before correction: g1 (13:10) comes after g2 (10:00).
    expect(build(13 * 60_000 + 10_000, 'FIRST_HALF').map((e) => e.key)).toEqual(['g2', 'g1'])
    // After correcting g1 to 05:00, it now comes first — simply because the
    // stored elapsedMs changed; buildTimeline needs no extra "re-sort" call.
    expect(build(5 * 60_000, 'FIRST_HALF').map((e) => e.key)).toEqual(['g1', 'g2'])
    // Moving g1 to the second half moves it to the very end.
    expect(build(1 * 60_000, 'SECOND_HALF').map((e) => e.key)).toEqual(['g2', 'g1'])
  })

  it('places phase markers at their boundaries', () => {
    const clock = {
      ...createInitialClockState(),
      firstHalfStartedAt: 0,
      firstHalfEndedAt: 1_800_000,
      secondHalfStartedAt: 1_800_000,
    }
    const entries = buildTimeline({
      substitutionEvents: [],
      goalEvents: [
        goal({ id: 'g-first', phase: 'FIRST_HALF', elapsedMs: 10 * 60_000 }),
        goal({ id: 'g-second', phase: 'SECOND_HALF', elapsedMs: 2 * 60_000 }),
      ],
      cardEvents: [card({ id: 'c-ht', phase: 'HALF_TIME', elapsedMs: 1_800_000 })],
      clock,
      hydrationCompletionElapsedMsByHalf: noHydration,
    })
    expect(entries.map((e) => e.key)).toEqual([
      'marker:first-start',
      'g-first',
      'marker:first-end',
      'c-ht',
      'marker:second-start',
      'g-second',
    ])
  })

  it('keeps a same-stoppage substitution pair as one grouped entry', () => {
    const entries = buildTimeline({
      substitutionEvents: [
        sub({ id: 's1', phase: 'SECOND_HALF', elapsedMs: 10 * 60_000, teamGroups: [{ teamId: 'HOME', pairs: [] }], stoppageGroupId: 'grp' }),
        sub({ id: 's2', phase: 'SECOND_HALF', elapsedMs: 10 * 60_000 + 4000, teamGroups: [{ teamId: 'AWAY', pairs: [] }], stoppageGroupId: 'grp' }),
      ],
      goalEvents: [],
      cardEvents: [],
      clock: createInitialClockState(),
      hydrationCompletionElapsedMsByHalf: noHydration,
    })
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('SUB_GROUP')
  })

  it('shows a hydration marker at the recorded time', () => {
    const entries = buildTimeline({
      substitutionEvents: [],
      goalEvents: [],
      cardEvents: [],
      clock: createInitialClockState(),
      hydrationCompletionElapsedMsByHalf: { firstHalf: 15 * 60_000, secondHalf: null },
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'HYDRATION', half: 'firstHalf', elapsedMs: 15 * 60_000 })
  })
})
