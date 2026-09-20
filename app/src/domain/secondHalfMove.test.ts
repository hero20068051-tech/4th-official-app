// Phase 2.3: substitutions recorded under half-time that were really made in
// the second half. The operator says which pairs, and whether they were one
// occasion or several; the app recomputes everything from the log.
import { describe, expect, it } from 'vitest'
import { MAX_SECOND_HALF_OPPORTUNITIES } from './engine'
import { buildTimeline } from './matchRecord'
import {
  addDraftPair,
  addPlayers,
  canMoveSubstitutionToHalfTime,
  canMoveSubstitutionToSecondHalf,
  confirmDraft,
  createInitialAppState,
  endFirstHalfPhase,
  getDerivedMatchState,
  moveSubstitutionPairsToSecondHalf,
  moveSubstitutionToHalfTime,
  previewMoveSubstitutionPairsToSecondHalf,
  setDraftPair,
  setRegisteredGK,
  setStarter,
  startFirstHalfPhase,
  startSecondHalfPhase,
  type AppState,
  type SecondHalfMove,
} from './matchStore'

const REGISTERED = [1, 2, 3, 4, 5, 6, 11, 23, 28, 34, 38, 41, 43, 48, 50, 52, 56, 58]
const STARTERS = [1, 2, 3, 4, 5, 6, 23, 28, 41, 56, 58]
const id = (n: number) => `HOME:${n}`
const nums = (ids: string[]) => ids.map((x) => Number(x.split(':')[1])).sort((a, b) => a - b)
const SECOND_HALF_START = 2_400_000
const T = (m: number, s: number) => (m * 60 + s) * 1000

function kickoff(): AppState {
  let s = createInitialAppState()
  s = addPlayers(s, 'HOME', REGISTERED.join(',')).state
  for (const n of STARTERS) s = setStarter(s, id(n), true).state
  s = setRegisteredGK(s, id(1), true)
  return startFirstHalfPhase(s, 0)
}

function confirmPairs(s: AppState, pairs: [number, number][], at: number): AppState {
  for (let i = 0; i < pairs.length; i++) {
    if (i > 0) s = addDraftPair(s, 'HOME')
    s = setDraftPair(s, 'HOME', i, 'out', id(pairs[i][0]))
    s = setDraftPair(s, 'HOME', i, 'in', id(pairs[i][1]))
  }
  const r = confirmDraft(s, 'HOME', at)
  expect(r.errors).toEqual([])
  return r.state
}

const HT_FIVE: [number, number][] = [[23, 52], [34, 11], [48, 50], [43, 41], [38, 58]]

// The real match: first half, then all five pairs recorded under half-time
// (as one substitution), second half already started.
function fiveRecordedAtHalfTime(): AppState {
  let s = kickoff()
  s = confirmPairs(s, [[56, 34]], 300_000)
  s = confirmPairs(s, [[58, 38], [28, 48], [41, 43]], 900_000)
  s = endFirstHalfPhase(s, 1_800_000)
  s = confirmPairs(s, HT_FIVE, 1_810_000)
  return startSecondHalfPhase(s, SECOND_HALF_START)
}

function summarize(s: AppState) {
  const d = getDerivedMatchState(s)
  const p = d.state.players
  const c = d.state.teamCounters.HOME
  return {
    pitch: nums(Object.keys(p).filter((k) => k.startsWith('HOME:') && p[k].location === 'pitch')),
    bench: nums(Object.keys(p).filter((k) => k.startsWith('HOME:') && p[k].location === 'bench')),
    secondHalfUsed: c.secondHalfOpportunitiesUsed,
    reentry: nums(c.reentryPlayerIds),
    usedSubs: nums(c.usedSubstituteIds),
    needsReview: d.needsReview,
  }
}

const ALL_HT_RESULT = {
  pitch: [1, 2, 3, 4, 5, 6, 11, 41, 50, 52, 58],
  bench: [23, 28, 34, 38, 43, 48, 56],
  reentry: [41, 58],
  usedSubs: [11, 34, 38, 43, 48, 50, 52],
  needsReview: [],
}

const htEventId = (s: AppState) => s.substitutionEvents.find((e) => e.phase === 'HALF_TIME')!.id
const pairsOf = (e: { teamGroups: { pairs: { outPlayerId: string; inPlayerId: string }[] }[] }) =>
  e.teamGroups[0].pairs.map((p) => `${nums([p.outPlayerId])[0]}>${nums([p.inPlayerId])[0]}`)
function move(s: AppState, moves: SecondHalfMove[]): AppState {
  const r = moveSubstitutionPairsToSecondHalf(s, htEventId(s), moves)
  expect(r.errors).toEqual([])
  return r.state
}
const pairKey = (pairs: [number, number][]) => pairs.map(([o, n]) => `${o}>${n}`).sort()

describe('case A: two of five half-time pairs moved to 2:15 as ONE occasion', () => {
  const start = fiveRecordedAtHalfTime()
  const after = move(start, [{ pairIndexes: [3, 4], elapsedMs: T(2, 15) }])

  it('splits the record: half-time keeps three pairs, the second half gets the two', () => {
    const ht = after.substitutionEvents.filter((e) => e.phase === 'HALF_TIME')
    const sh = after.substitutionEvents.filter((e) => e.phase === 'SECOND_HALF')
    expect(ht.map(pairsOf)).toEqual([['23>52', '34>11', '48>50']])
    expect(sh.map(pairsOf)).toEqual([['43>41', '38>58']])
    expect(sh[0].elapsedMs).toBe(T(2, 15))
  })

  it('costs exactly one second-half opportunity (two left) and recomputes everything', () => {
    const sum = summarize(after)
    expect(sum.secondHalfUsed).toBe(1)
    expect(MAX_SECOND_HALF_OPPORTUNITIES - sum.secondHalfUsed).toBe(2)
    expect({ ...sum, secondHalfUsed: 0 }).toEqual({ ...ALL_HT_RESULT, secondHalfUsed: 0 })
    expect(sum.reentry).toEqual([41, 58]) // still two re-entrants under the existing rule
  })

  it('previews the same outcome before applying', () => {
    const p = previewMoveSubstitutionPairsToSecondHalf(start, htEventId(start), [{ pairIndexes: [3, 4], elapsedMs: T(2, 15) }])
    expect(p).toEqual({ errors: [], newlyNeedingReview: 0, secondHalfRemaining: 2 })
  })

  it('timeline: three at half-time, then the second-half marker, then the pair at 後半 02:15', () => {
    const entries = buildTimeline({
      substitutionEvents: after.substitutionEvents,
      goalEvents: after.goalEvents,
      cardEvents: after.cardEvents,
      clock: after.clock,
      hydrationCompletionElapsedMsByHalf: after.hydrationCompletionElapsedMsByHalf,
    })
    const order = entries.filter((e) => e.kind === 'SUB_SINGLE' || e.key === 'marker:second-start')
    expect(order.map((e) => (e.kind === 'SUB_SINGLE' ? `${e.phase}:${e.elapsedMs}` : 'second-start'))).toEqual([
      'FIRST_HALF:300000',
      'FIRST_HALF:900000',
      'HALF_TIME:1800000',
      'second-start',
      `SECOND_HALF:${T(2, 15)}`,
    ])
  })

  it('survives a save / reload', () => {
    const reloaded = JSON.parse(JSON.stringify(after)) as AppState
    expect(summarize(reloaded)).toEqual(summarize(after))
  })

  it('nothing is lost: the five pairs are still exactly the five pairs', () => {
    const all = after.substitutionEvents.filter((e) => e.phase !== 'FIRST_HALF').flatMap(pairsOf).sort()
    expect(all).toEqual(pairKey(HT_FIVE))
  })
})

describe('case B: the same two pairs as SEPARATE occasions', () => {
  it('costs two opportunities (one left), each at its own time', () => {
    const after = move(fiveRecordedAtHalfTime(), [
      { pairIndexes: [3], elapsedMs: T(2, 15) },
      { pairIndexes: [4], elapsedMs: T(6, 40) },
    ])
    const sh = after.substitutionEvents.filter((e) => e.phase === 'SECOND_HALF')
    expect(sh.map((e) => [pairsOf(e), e.elapsedMs])).toEqual([
      [['43>41'], T(2, 15)],
      [['38>58'], T(6, 40)],
    ])
    const sum = summarize(after)
    expect(MAX_SECOND_HALF_OPPORTUNITIES - sum.secondHalfUsed).toBe(1)
    expect(sum.reentry).toEqual([41, 58])
    expect(sum.needsReview).toEqual([])
  })

  it('places them chronologically even if given out of order', () => {
    const after = move(fiveRecordedAtHalfTime(), [
      { pairIndexes: [4], elapsedMs: T(6, 40) },
      { pairIndexes: [3], elapsedMs: T(2, 15) },
    ])
    expect(after.substitutionEvents.filter((e) => e.phase === 'SECOND_HALF').map(pairsOf)).toEqual([['43>41'], ['38>58']])
  })
})

describe('case C: only one of the five pairs moved', () => {
  it('moves just 38 -> 58 to the second half; one opportunity used', () => {
    const after = move(fiveRecordedAtHalfTime(), [{ pairIndexes: [4], elapsedMs: T(2, 15) }])
    expect(after.substitutionEvents.filter((e) => e.phase === 'HALF_TIME').map(pairsOf)).toEqual([
      ['23>52', '34>11', '48>50', '43>41'],
    ])
    expect(after.substitutionEvents.filter((e) => e.phase === 'SECOND_HALF').map(pairsOf)).toEqual([['38>58']])
    const sum = summarize(after)
    expect(sum.secondHalfUsed).toBe(1)
    expect({ ...sum, secondHalfUsed: 0 }).toEqual({ ...ALL_HT_RESULT, secondHalfUsed: 0 })
  })
})

describe('case D: and back again with 「ハーフタイムの交代だった」', () => {
  it('restores the opportunities and recomputes pitch/bench/re-entry/timeline', () => {
    const moved = move(fiveRecordedAtHalfTime(), [{ pairIndexes: [3, 4], elapsedMs: T(2, 15) }])
    const sh = moved.substitutionEvents.find((e) => e.phase === 'SECOND_HALF')!
    expect(canMoveSubstitutionToHalfTime(moved, sh.id)).toBe(true)
    const back = moveSubstitutionToHalfTime(moved, sh.id)
    expect(back.substitutionEvents.some((e) => e.phase === 'SECOND_HALF')).toBe(false)
    expect(MAX_SECOND_HALF_OPPORTUNITIES - summarize(back).secondHalfUsed).toBe(3)
    expect(summarize(back)).toEqual({ ...ALL_HT_RESULT, secondHalfUsed: 0 })
    expect(back.substitutionEvents.filter((e) => e.phase === 'HALF_TIME').flatMap(pairsOf).sort()).toEqual(pairKey(HT_FIVE))
  })
})

describe('case E: a later event that becomes impossible is flagged, never deleted', () => {
  it('flags the second-half event that depended on the pair now moving after it', () => {
    let s = fiveRecordedAtHalfTime()
    // Z (second half 1:00): 41 (who came on at half-time) goes off again (56 re-enters, the third re-entrant).
    s = confirmPairs(s, [[41, 56]], SECOND_HALF_START + 60_000)
    const z = s.substitutionEvents.at(-1)!
    expect(summarize(s).needsReview).toEqual([])
    const before = s.substitutionEvents.length

    // 43 -> 41 turns out to be a 5:00 substitution: 41 is not on the pitch at Z's time any more.
    const preview = previewMoveSubstitutionPairsToSecondHalf(s, htEventId(s), [{ pairIndexes: [3], elapsedMs: T(5, 0) }])
    expect(preview.newlyNeedingReview).toBe(1)
    const after = move(s, [{ pairIndexes: [3], elapsedMs: T(5, 0) }])
    expect(after.substitutionEvents).toHaveLength(before + 1) // split, nothing removed
    expect(summarize(after).needsReview.map((r) => r.eventId)).toEqual([z.id])
    expect(after.substitutionEvents.some((e) => e.id === z.id)).toBe(true)
  })

  it('does not relax the 3-opportunity limit: the 4th and 5th occasions are flagged', () => {
    const start = fiveRecordedAtHalfTime()
    const moves = [0, 1, 2, 3, 4].map((i) => ({ pairIndexes: [i], elapsedMs: T(i + 1, 0) }))
    const after = move(start, moves)
    expect(after.substitutionEvents.filter((e) => e.phase === 'SECOND_HALF')).toHaveLength(5)
    const sum = summarize(after)
    expect(sum.secondHalfUsed).toBe(3)
    expect(sum.needsReview).toHaveLength(2)
    expect(sum.needsReview.flatMap((f) => f.messages)).toContain('後半の交代は終了です')
    const secondHalf = after.substitutionEvents.filter((e) => e.phase === 'SECOND_HALF')
    expect(sum.needsReview.map((f) => f.eventId)).toEqual([secondHalf[3].id, secondHalf[4].id])
    expect(previewMoveSubstitutionPairsToSecondHalf(start, htEventId(start), moves).newlyNeedingReview).toBe(2)
  })

  it('a re-entry moved ahead of the substitutions that unlock it is flagged (the rule is not bent)', () => {
    const after = move(fiveRecordedAtHalfTime(), [
      { pairIndexes: [3], elapsedMs: T(1, 0) },
      { pairIndexes: [0, 1, 2], elapsedMs: T(3, 0) },
    ])
    expect(summarize(after).needsReview.length).toBeGreaterThan(0)
    expect(after.substitutionEvents.filter((e) => e.phase !== 'FIRST_HALF').flatMap(pairsOf).sort()).toEqual(pairKey(HT_FIVE))
  })
})

describe('case F: reload keeps the corrected state', () => {
  it('JSON round trip after a split', () => {
    const moved = move(fiveRecordedAtHalfTime(), [{ pairIndexes: [3, 4], elapsedMs: T(2, 15) }])
    expect(summarize(JSON.parse(JSON.stringify(moved)))).toEqual(summarize(moved))
  })
})

describe('inputs and limits', () => {
  it('needs the second half to have started', () => {
    let s = kickoff()
    s = confirmPairs(s, [[56, 34]], 300_000)
    s = endFirstHalfPhase(s, 1_800_000)
    s = confirmPairs(s, [[23, 52]], 1_810_000)
    expect(canMoveSubstitutionToSecondHalf(s, htEventId(s))).toBe(false)
    expect(moveSubstitutionPairsToSecondHalf(s, htEventId(s), [{ pairIndexes: [0], elapsedMs: 1000 }]).state).toBe(s)
  })

  it('is offered only for half-time events', () => {
    const s = fiveRecordedAtHalfTime()
    for (const e of s.substitutionEvents.filter((x) => x.phase === 'FIRST_HALF')) {
      expect(canMoveSubstitutionToSecondHalf(s, e.id)).toBe(false)
    }
    expect(canMoveSubstitutionToSecondHalf(s, 'nope')).toBe(false)
  })

  it('rejects empty, out-of-range, duplicate and negative-time requests without changing anything', () => {
    const s = fiveRecordedAtHalfTime()
    const e = htEventId(s)
    for (const moves of [
      [],
      [{ pairIndexes: [], elapsedMs: 1000 }],
      [{ pairIndexes: [9], elapsedMs: 1000 }],
      [{ pairIndexes: [-1], elapsedMs: 1000 }],
      [{ pairIndexes: [1], elapsedMs: 1000 }, { pairIndexes: [1], elapsedMs: 2000 }],
      [{ pairIndexes: [1, 1], elapsedMs: 1000 }],
      [{ pairIndexes: [1], elapsedMs: -5 }],
      [{ pairIndexes: [1], elapsedMs: Number.NaN }],
    ] as SecondHalfMove[][]) {
      const r = moveSubstitutionPairsToSecondHalf(s, e, moves)
      expect(r.errors.length).toBeGreaterThan(0)
      expect(r.state).toBe(s)
    }
  })

  it('moving every pair turns the whole event into a second-half event and drops a cross-phase stoppage link', () => {
    let s = fiveRecordedAtHalfTime()
    const ht = htEventId(s)
    s = {
      ...s,
      substitutionEvents: [
        ...s.substitutionEvents.map((e) => (e.id === ht ? { ...e, stoppageGroupId: 'g' } : e)),
        { id: 'away-ht', phase: 'HALF_TIME', elapsedMs: 1_800_000, teamGroups: [{ teamId: 'AWAY', pairs: [] }], stoppageGroupId: 'g' },
      ],
    }
    const after = move(s, [{ pairIndexes: [0, 1, 2, 3, 4], elapsedMs: T(2, 15) }])
    expect(after.substitutionEvents.find((e) => e.id === ht)!.phase).toBe('SECOND_HALF') // id kept
    expect(after.substitutionEvents.filter((e) => e.stoppageGroupId === 'g')).toHaveLength(0)
  })

  it('keeps the link when only some pairs leave (the half-time part is still half-time)', () => {
    let s = fiveRecordedAtHalfTime()
    const ht = htEventId(s)
    s = { ...s, substitutionEvents: s.substitutionEvents.map((e) => (e.id === ht ? { ...e, stoppageGroupId: 'g' } : e)) }
    const after = move(s, [{ pairIndexes: [4], elapsedMs: T(2, 15) }])
    expect(after.substitutionEvents.find((e) => e.id === ht)!.stoppageGroupId).toBe('g')
    expect(after.substitutionEvents.filter((e) => e.phase === 'SECOND_HALF').every((e) => !e.stoppageGroupId)).toBe(true)
  })

  it('a moved event is placed among existing second-half events by its second-half time', () => {
    const base = fiveRecordedAtHalfTime()
    const early = confirmPairs(base, [[5, 56]], SECOND_HALF_START + T(1, 0)) // existing 1:00
    const afterEarly = move(early, [{ pairIndexes: [4], elapsedMs: T(4, 0) }])
    expect(afterEarly.substitutionEvents.filter((e) => e.phase === 'SECOND_HALF').map((e) => e.elapsedMs)).toEqual([T(1, 0), T(4, 0)])

    const late = confirmPairs(base, [[5, 56]], SECOND_HALF_START + T(9, 0)) // existing 9:00
    const afterLate = move(late, [{ pairIndexes: [4], elapsedMs: T(4, 0) }])
    const sh = afterLate.substitutionEvents.filter((e) => e.phase === 'SECOND_HALF')
    expect(sh.map((e) => e.elapsedMs)).toEqual([T(4, 0), T(9, 0)])
    expect(summarize(afterLate).needsReview).toEqual([])
    expect(summarize(afterLate).secondHalfUsed).toBe(2)
  })
})

describe('the real 18-player match, end to end', () => {
  it('5 pairs at half-time -> last two to the second half as one occasion -> back to half-time', () => {
    const start = fiveRecordedAtHalfTime()
    expect(summarize(start)).toEqual({ ...ALL_HT_RESULT, secondHalfUsed: 0 })
    expect(MAX_SECOND_HALF_OPPORTUNITIES - summarize(start).secondHalfUsed).toBe(3)

    const moved = move(start, [{ pairIndexes: [3, 4], elapsedMs: T(2, 15) }])
    expect(summarize(moved).secondHalfUsed).toBe(1)

    const sh = moved.substitutionEvents.find((e) => e.phase === 'SECOND_HALF')!
    const back = moveSubstitutionToHalfTime(moved, sh.id)
    expect(summarize(back)).toEqual({ ...ALL_HT_RESULT, secondHalfUsed: 0 })
    expect(MAX_SECOND_HALF_OPPORTUNITIES - summarize(back).secondHalfUsed).toBe(3)
  })
})
