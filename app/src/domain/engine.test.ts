import { describe, expect, it } from 'vitest'
import {
  MAX_USED_SUBSTITUTES,
  applySubstitutionEvent,
  createInitialMatchState,
  replayMatch,
} from './engine'
import { pendingConfirmationReentryPolicy } from './reentryPolicy'
import type { Player, SubstitutionEvent } from './types'

function player(id: string, teamId: 'HOME' | 'AWAY', number: number, opts: Partial<Player> = {}): Player {
  return {
    id,
    teamId,
    number,
    isStarter: false,
    isRegisteredGK: false,
    ...opts,
  }
}

// HOME: 1 (GK starter), 2-11 FP starters, 12 (GK sub), 15-20 FP subs.
// AWAY: mirrors HOME with different ids so team independence can be checked.
function baseRoster(): Player[] {
  const home: Player[] = [
    player('H1', 'HOME', 1, { isStarter: true, isRegisteredGK: true }),
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => player(`H${n}`, 'HOME', n, { isStarter: true })),
    player('H12', 'HOME', 12, { isRegisteredGK: true }),
    ...[15, 16, 17, 18, 19, 20].map((n) => player(`H${n}`, 'HOME', n)),
  ]
  const away: Player[] = [
    player('A1', 'AWAY', 1, { isStarter: true, isRegisteredGK: true }),
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => player(`A${n}`, 'AWAY', n, { isStarter: true })),
    player('A12', 'AWAY', 12, { isRegisteredGK: true }),
    ...[15, 16, 17, 18, 19, 20].map((n) => player(`A${n}`, 'AWAY', n)),
  ]
  return [...home, ...away]
}

const policy = pendingConfirmationReentryPolicy

describe('T01 first-half normal substitution', () => {
  it('succeeds and does not touch second-half count', () => {
    const roster = baseRoster()
    const state = createInitialMatchState(roster)
    const event: SubstitutionEvent = {
      id: 'e1',
      phase: 'FIRST_HALF',
      elapsedMs: 0,
      teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'H10', inPlayerId: 'H15' }] }],
    }
    const { state: next, errors } = applySubstitutionEvent(state, roster, event, policy)
    expect(errors).toEqual([])
    expect(next.players['H15'].location).toBe('pitch')
    expect(next.players['H15'].hasAppeared).toBe(true)
    expect(next.players['H10'].location).toBe('bench')
    expect(next.teamCounters.HOME.secondHalfOpportunitiesUsed).toBe(0)
  })
})

describe('T02 first-half multi-pair group', () => {
  it('records as one event and does not consume second-half count', () => {
    const roster = baseRoster()
    const state = createInitialMatchState(roster)
    const event: SubstitutionEvent = {
      id: 'e1',
      phase: 'FIRST_HALF',
      elapsedMs: 0,
      teamGroups: [
        {
          teamId: 'HOME',
          pairs: [
            { outPlayerId: 'H8', inPlayerId: 'H16' },
            { outPlayerId: 'H10', inPlayerId: 'H17' },
          ],
        },
      ],
    }
    const { state: next, errors } = applySubstitutionEvent(state, roster, event, policy)
    expect(errors).toEqual([])
    expect(next.teamCounters.HOME.secondHalfOpportunitiesUsed).toBe(0)
  })
})

describe('T03 re-entry blocked while an FP substitute has not appeared', () => {
  it('rejects with the unavailable + waiting-player messages', () => {
    const roster = baseRoster()
    let state = createInitialMatchState(roster)
    // 10 exits, 15 enters (normal). 17 remains an unused FP substitute.
    const first = applySubstitutionEvent(
      state,
      roster,
      { id: 'e1', phase: 'FIRST_HALF', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'H10', inPlayerId: 'H15' }] }] },
      policy,
    )
    state = first.state

    const attempt = applySubstitutionEvent(
      state,
      roster,
      { id: 'e2', phase: 'HALF_TIME', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'H15', inPlayerId: 'H10' }] }] },
      policy,
    )
    expect(attempt.errors).toContain('まだ10番は入れません')
    expect(attempt.errors.some((m) => m.includes('まだ出場していない選手がいます'))).toBe(true)
  })
})

describe('T04 unused GK substitute does not block FP re-entry', () => {
  it('allows re-entry once all FP substitutes have appeared, ignoring GK sub 12', () => {
    const roster = baseRoster()
    let state = createInitialMatchState(roster)
    // Bring on all 6 FP subs (15-20) for the 6 outfield starters 2-7, so all FP subs have appeared.
    // (2-7, 8-11 stay on pitch; 12 GK sub stays unused.)
    const outNumbers = [2, 3, 4, 5, 6, 7]
    const inNumbers = [15, 16, 17, 18, 19, 20]
    for (let i = 0; i < outNumbers.length; i++) {
      const result = applySubstitutionEvent(
        state,
        roster,
        {
          id: `e${i}`,
          phase: 'FIRST_HALF',
          elapsedMs: 0,
          teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: `H${outNumbers[i]}`, inPlayerId: `H${inNumbers[i]}` }] }],
        },
        policy,
      )
      expect(result.errors).toEqual([])
      state = result.state
    }

    // 10 has not appeared yet; instead check that a previously-exited player (2, now on bench) can re-enter at HT.
    const reentry = applySubstitutionEvent(
      state,
      roster,
      { id: 'reentry', phase: 'HALF_TIME', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'H15', inPlayerId: 'H2' }] }] },
      policy,
    )
    expect(reentry.errors).toEqual([])
    expect(reentry.state.players['H2'].reentryCount).toBe(1)
  })
})

describe('T05 condition met mid-first-half still blocks re-entry before half-time', () => {
  it('rejects re-entry attempted in FIRST_HALF even if unlock condition is satisfied', () => {
    const roster = baseRoster()
    let state = createInitialMatchState(roster)
    const outNumbers = [2, 3, 4, 5, 6, 7]
    const inNumbers = [15, 16, 17, 18, 19, 20]
    for (let i = 0; i < outNumbers.length; i++) {
      const result = applySubstitutionEvent(
        state,
        roster,
        {
          id: `e${i}`,
          phase: 'FIRST_HALF',
          elapsedMs: 0,
          teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: `H${outNumbers[i]}`, inPlayerId: `H${inNumbers[i]}` }] }],
        },
        policy,
      )
      state = result.state
    }

    const attempt = applySubstitutionEvent(
      state,
      roster,
      { id: 'attempt', phase: 'FIRST_HALF', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'H15', inPlayerId: 'H2' }] }] },
      policy,
    )
    expect(attempt.errors).toContain('まだ2番は入れません')
  })
})

describe('T07 HT group where last unappeared FP sub and a re-entry succeed together', () => {
  it('evaluates the whole group at once regardless of pair order', () => {
    const roster = baseRoster()
    let state = createInitialMatchState(roster)
    // Get 5 of 6 FP subs on, leaving H20 (mapped to "17" in the scenario) as the only unappeared FP sub.
    const outNumbers = [2, 3, 4, 5, 6]
    const inNumbers = [15, 16, 17, 18, 19]
    for (let i = 0; i < outNumbers.length; i++) {
      const result = applySubstitutionEvent(
        state,
        roster,
        {
          id: `pre${i}`,
          phase: 'FIRST_HALF',
          elapsedMs: 0,
          teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: `H${outNumbers[i]}`, inPlayerId: `H${inNumbers[i]}` }] }],
        },
        policy,
      )
      state = result.state
    }
    // Now H7 is still on pitch, H20 is the last unappeared FP sub, H2 is a bench player who already appeared.
    const groupA: SubstitutionEvent = {
      id: 'ht-a',
      phase: 'HALF_TIME',
      elapsedMs: 0,
      teamGroups: [
        {
          teamId: 'HOME',
          pairs: [
            { outPlayerId: 'H7', inPlayerId: 'H20' }, // last unappeared FP sub enters
            { outPlayerId: 'H15', inPlayerId: 'H2' }, // re-entry, unlocked by the pair above
          ],
        },
      ],
    }
    const resultA = applySubstitutionEvent(state, roster, groupA, policy)
    expect(resultA.errors).toEqual([])

    // Same pairs, reversed order, must produce the same outcome (T32).
    const groupB: SubstitutionEvent = {
      ...groupA,
      id: 'ht-b',
      teamGroups: [{ teamId: 'HOME', pairs: [...groupA.teamGroups[0].pairs].reverse() }],
    }
    const resultB = applySubstitutionEvent(state, roster, groupB, policy)
    expect(resultB.errors).toEqual([])
  })
})

describe('T08/T09 second-half opportunity counting', () => {
  it('consumes exactly one opportunity per group regardless of pair count', () => {
    const roster = baseRoster()
    let state = createInitialMatchState(roster)
    const single = applySubstitutionEvent(
      state,
      roster,
      { id: 'sh1', phase: 'SECOND_HALF', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'H10', inPlayerId: 'H15' }] }] },
      policy,
    )
    expect(single.errors).toEqual([])
    expect(single.state.teamCounters.HOME.secondHalfOpportunitiesUsed).toBe(1)
    expect(single.state.teamCounters.AWAY.secondHalfOpportunitiesUsed).toBe(0)
    state = single.state

    const triple = applySubstitutionEvent(
      state,
      roster,
      {
        id: 'sh2',
        phase: 'SECOND_HALF',
        elapsedMs: 0,
        teamGroups: [
          {
            teamId: 'HOME',
            pairs: [
              { outPlayerId: 'H7', inPlayerId: 'H16' },
              { outPlayerId: 'H8', inPlayerId: 'H17' },
              { outPlayerId: 'H9', inPlayerId: 'H18' },
            ],
          },
        ],
      },
      policy,
    )
    expect(triple.errors).toEqual([])
    expect(triple.state.teamCounters.HOME.secondHalfOpportunitiesUsed).toBe(2)
  })
})

describe('T10 second-half opportunities exhausted', () => {
  it('blocks a 4th group with the exhaustion message', () => {
    const roster = baseRoster()
    let state = createInitialMatchState(roster)
    const subs: [string, string][] = [
      ['H10', 'H15'],
      ['H9', 'H16'],
      ['H8', 'H17'],
    ]
    for (const [outId, inId] of subs) {
      const result = applySubstitutionEvent(
        state,
        roster,
        { id: `u-${outId}`, phase: 'SECOND_HALF', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: outId, inPlayerId: inId }] }] },
        policy,
      )
      state = result.state
    }
    expect(state.teamCounters.HOME.secondHalfOpportunitiesUsed).toBe(3)

    const blocked = applySubstitutionEvent(
      state,
      roster,
      { id: 'blocked', phase: 'SECOND_HALF', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'H7', inPlayerId: 'H18' }] }] },
      policy,
    )
    expect(blocked.errors).toContain('後半の交代は終了です')
  })
})

describe('T11 HOME and AWAY substitute independently in the same stoppage', () => {
  it('consumes one opportunity per team without cross-team interference', () => {
    const roster = baseRoster()
    const state = createInitialMatchState(roster)
    const event: SubstitutionEvent = {
      id: 'both',
      phase: 'SECOND_HALF',
      elapsedMs: 0,
      teamGroups: [
        { teamId: 'HOME', pairs: [{ outPlayerId: 'H10', inPlayerId: 'H15' }] },
        { teamId: 'AWAY', pairs: [{ outPlayerId: 'A10', inPlayerId: 'A15' }] },
      ],
    }
    const { state: next, errors } = applySubstitutionEvent(state, roster, event, policy)
    expect(errors).toEqual([])
    expect(next.teamCounters.HOME.secondHalfOpportunitiesUsed).toBe(1)
    expect(next.teamCounters.AWAY.secondHalfOpportunitiesUsed).toBe(1)
    expect(next.players['A10'].location).toBe('bench')
    expect(next.players['H10'].location).toBe('bench')
  })
})

describe('9-substitute cap', () => {
  it('blocks a 10th distinct substitute even with room in other counters', () => {
    // Roster with 9 already-used substitutes and one extra unused sub.
    const roster: Player[] = [
      player('H1', 'HOME', 1, { isStarter: true, isRegisteredGK: true }),
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => player(`H${n}`, 'HOME', n, { isStarter: true })),
      ...Array.from({ length: 10 }, (_, i) => player(`H${30 + i}`, 'HOME', 30 + i)),
    ]
    let state = createInitialMatchState(roster)
    for (let i = 0; i < 9; i++) {
      const outId = `H${i + 2}`
      const inId = `H${30 + i}`
      const result = applySubstitutionEvent(
        state,
        roster,
        { id: `u${i}`, phase: 'FIRST_HALF', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: outId, inPlayerId: inId }] }] },
        policy,
      )
      expect(result.errors).toEqual([])
      state = result.state
    }
    expect(state.teamCounters.HOME.usedSubstituteIds).toHaveLength(MAX_USED_SUBSTITUTES)

    const blocked = applySubstitutionEvent(
      state,
      roster,
      { id: 'over', phase: 'FIRST_HALF', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'H11', inPlayerId: 'H39' }] }] },
      policy,
    )
    expect(blocked.errors).toContain('使用できる交代要員は9名までです')
  })
})

describe('T31 second re-entry of the same player is PENDING, not decided', () => {
  it('blocks with a message explaining the rule is unconfirmed, not a permanent NG', () => {
    const roster = baseRoster()
    let state = createInitialMatchState(roster)
    // Unlock FP condition quickly with a tiny roster shortcut: mark all FP subs appeared first.
    const outNumbers = [2, 3, 4, 5, 6, 7]
    const inNumbers = [15, 16, 17, 18, 19, 20]
    for (let i = 0; i < outNumbers.length; i++) {
      const result = applySubstitutionEvent(
        state,
        roster,
        {
          id: `pre${i}`,
          phase: 'FIRST_HALF',
          elapsedMs: 0,
          teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: `H${outNumbers[i]}`, inPlayerId: `H${inNumbers[i]}` }] }],
        },
        policy,
      )
      state = result.state
    }
    // H2 exits, re-enters (1st reentry), exits again, tries to re-enter again.
    const reenter1 = applySubstitutionEvent(
      state,
      roster,
      { id: 'r1', phase: 'HALF_TIME', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'H15', inPlayerId: 'H2' }] }] },
      policy,
    )
    expect(reenter1.errors).toEqual([])
    state = reenter1.state

    const exitAgain = applySubstitutionEvent(
      state,
      roster,
      { id: 'r2', phase: 'SECOND_HALF', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'H2', inPlayerId: 'H15' }] }] },
      policy,
    )
    expect(exitAgain.errors).toEqual([])
    state = exitAgain.state

    const secondReentry = applySubstitutionEvent(
      state,
      roster,
      { id: 'r3', phase: 'SECOND_HALF', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'H15', inPlayerId: 'H2' }] }] },
      policy,
    )
    expect(secondReentry.errors).toHaveLength(1)
    expect(secondReentry.errors[0]).toContain('未確定')
  })
})

describe('replayMatch and history edits', () => {
  it('flags events that become illegal after an earlier edit instead of dropping or re-legalizing them', () => {
    const roster = baseRoster()
    const original: SubstitutionEvent[] = [
      { id: 'e1', phase: 'FIRST_HALF', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'H10', inPlayerId: 'H15' }] }] },
      { id: 'e2', phase: 'FIRST_HALF', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'H15', inPlayerId: 'H16' }] }] },
    ]
    const before = replayMatch(roster, original, policy)
    expect(before.needsReview).toEqual([])
    expect(before.state.players['H16'].location).toBe('pitch')

    // Edit e1 so it sends on 17 instead of 15. e2 (15 -> 16) is now illegal
    // because 15 was never brought onto the pitch after the edit.
    const edited: SubstitutionEvent[] = [
      { id: 'e1', phase: 'FIRST_HALF', elapsedMs: 0, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'H10', inPlayerId: 'H17' }] }] },
      original[1],
    ]
    const after = replayMatch(roster, edited, policy)
    expect(after.needsReview).toHaveLength(1)
    expect(after.needsReview[0].eventId).toBe('e2')
    // 16 should remain on the bench (e2 was not applied), not silently pitch.
    expect(after.state.players['H16'].location).toBe('bench')
  })
})
