// Regression for a real match (18 registered players): half-time substitutions
// that use up the last unused substitutes and then re-enter earlier starters
// in the same half-time. See PROJECT_RULES/02_CONFIRMED_RULES.md section B/E/F.
import { describe, expect, it } from 'vitest'
import { describeUnavailability, MAX_SECOND_HALF_OPPORTUNITIES } from './engine'
import { buildTimeline } from './matchRecord'
import {
  addDraftPair,
  addPlayers,
  canMoveSubstitutionToHalfTime,
  confirmDraft,
  createInitialAppState,
  endFirstHalfPhase,
  eventsInReplayOrder,
  getDerivedMatchState,
  moveSubstitutionToHalfTime,
  previewMoveSubstitutionToHalfTime,
  setDraftPair,
  setRegisteredGK,
  setStarter,
  startFirstHalfPhase,
  startSecondHalfPhase,
  type AppState,
} from './matchStore'
import { pendingConfirmationReentryPolicy } from './reentryPolicy'
import type { SubstitutionPair } from './types'

const REGISTERED = [1, 2, 3, 4, 5, 6, 11, 23, 28, 34, 38, 41, 43, 48, 50, 52, 56, 58]
const STARTERS = [1, 2, 3, 4, 5, 6, 23, 28, 41, 56, 58]
const SUBS = [11, 34, 38, 43, 48, 50, 52]
const id = (n: number) => `HOME:${n}`
const nums = (ids: string[]) => ids.map((x) => Number(x.split(':')[1])).sort((a, b) => a - b)

const FIRST_HALF_END = 1_800_000
const SECOND_HALF_START = 2_400_000

// A. 18 registered, the 11 real starters, #1 registered as GK.
function kickoff(): AppState {
  let s = createInitialAppState()
  s = addPlayers(s, 'HOME', REGISTERED.join(',')).state
  for (const n of STARTERS) s = setStarter(s, id(n), true).state
  s = setRegisteredGK(s, id(1), true)
  return startFirstHalfPhase(s, 0)
}

function confirmPairs(s: AppState, pairs: [number, number][], at: number): { state: AppState; errors: string[] } {
  for (let i = 0; i < pairs.length; i++) {
    if (i > 0) s = addDraftPair(s, 'HOME')
    s = setDraftPair(s, 'HOME', i, 'out', id(pairs[i][0]))
    s = setDraftPair(s, 'HOME', i, 'in', id(pairs[i][1]))
  }
  return confirmDraft(s, 'HOME', at)
}

function ok(r: { state: AppState; errors: string[] }): AppState {
  expect(r.errors).toEqual([])
  return r.state
}

// B, C, D: first half, then half-time.
function atHalfTime(): AppState {
  let s = kickoff()
  s = ok(confirmPairs(s, [[56, 34]], 300_000)) // B
  s = ok(confirmPairs(s, [[58, 38], [28, 48], [41, 43]], 900_000)) // C
  return endFirstHalfPhase(s, FIRST_HALF_END) // D
}

const HT_FIRST_THREE: [number, number][] = [[23, 52], [34, 11], [48, 50]]
const HT_REENTRIES: [number, number][] = [[43, 41], [38, 58]]

function summarize(s: AppState) {
  const d = getDerivedMatchState(s)
  const players = d.state.players
  const c = d.state.teamCounters.HOME
  return {
    pitch: nums(Object.keys(players).filter((k) => k.startsWith('HOME:') && players[k].location === 'pitch')),
    bench: nums(Object.keys(players).filter((k) => k.startsWith('HOME:') && players[k].location === 'bench')),
    secondHalfUsed: c.secondHalfOpportunitiesUsed,
    reentry: nums(c.reentryPlayerIds),
    usedSubs: nums(c.usedSubstituteIds),
    needsReview: d.needsReview,
  }
}

const EXPECTED_AFTER_FIVE_HT_PAIRS = {
  pitch: [1, 2, 3, 4, 5, 6, 11, 41, 50, 52, 58],
  bench: [23, 28, 34, 38, 43, 48, 56],
  secondHalfUsed: 0,
  reentry: [41, 58],
  usedSubs: [11, 34, 38, 43, 48, 50, 52],
  needsReview: [],
}

describe('root cause: bench candidates during an unconfirmed half-time draft', () => {
  it('after B-D the unused substitutes are exactly 11, 50, 52', () => {
    const s = atHalfTime()
    const players = getDerivedMatchState(s).state.players
    const unused = SUBS.filter((n) => !players[id(n)].hasAppeared)
    expect(unused).toEqual([11, 50, 52])
  })

  it('a re-entry chip was blocked by a group the confirm-time check would accept (old view)', () => {
    const s = atHalfTime()
    const matchState = getDerivedMatchState(s).state
    // Without knowing the rest of the draft, 41 looks locked behind 11/50/52...
    const blocked = describeUnavailability(matchState, s.roster, 'HOME', 'HALF_TIME', id(41), pendingConfirmationReentryPolicy)
    expect(blocked).toBe('まだ出場していない選手がいます：11、50、52番')
    // ...although the very same group is legal when confirmed as one substitution.
    const oneGroup = confirmPairs(s, [...HT_FIRST_THREE, ...HT_REENTRIES], 1_810_000)
    expect(oneGroup.errors).toEqual([])
  })

  it('F: with the other draft pairs taken into account, 41 and 58 are selectable', () => {
    const s = atHalfTime()
    const matchState = getDerivedMatchState(s).state
    const draftPairs: SubstitutionPair[] = HT_FIRST_THREE.map(([o, n]) => ({ outPlayerId: id(o), inPlayerId: id(n) }))
    for (const n of [41, 58]) {
      expect(
        describeUnavailability(matchState, s.roster, 'HOME', 'HALF_TIME', id(n), pendingConfirmationReentryPolicy, draftPairs),
      ).toBeNull()
    }
  })

  it('does not unlock re-entry while an unused substitute is still outside the draft', () => {
    const s = atHalfTime()
    const matchState = getDerivedMatchState(s).state
    const twoOfThree: SubstitutionPair[] = HT_FIRST_THREE.slice(0, 2).map(([o, n]) => ({ outPlayerId: id(o), inPlayerId: id(n) }))
    expect(
      describeUnavailability(matchState, s.roster, 'HOME', 'HALF_TIME', id(41), pendingConfirmationReentryPolicy, twoOfThree),
    ).toBe('まだ出場していない選手がいます：50番')
  })

  it('still never allows re-entry in the first half, draft or not', () => {
    const s = kickoff()
    const matchState = getDerivedMatchState(s).state
    const pairs: SubstitutionPair[] = [{ outPlayerId: id(23), inPlayerId: id(52) }]
    const first = ok(confirmPairs(s, [[56, 34]], 60_000))
    const ms = getDerivedMatchState(first).state
    expect(describeUnavailability(ms, first.roster, 'HOME', 'FIRST_HALF', id(56), pendingConfirmationReentryPolicy, pairs)).toBe(
      'まだ56番は入れません',
    )
    expect(matchState).toBeDefined()
  })

  it('counts re-entries the draft already holds toward the 3-player cap', () => {
    const s = atHalfTime()
    // Everyone has appeared once the three unused subs go in, so 28, 41, 56, 58 are re-entry candidates.
    const matchState = getDerivedMatchState(s).state
    const draft: SubstitutionPair[] = [
      ...HT_FIRST_THREE,
      [43, 41],
      [38, 58],
      [5, 28],
    ].map(([o, n]) => ({ outPlayerId: id(o), inPlayerId: id(n) }))
    // 41, 58, 28 would be the three re-entrants → a fourth (56) is capped.
    expect(
      describeUnavailability(matchState, s.roster, 'HOME', 'HALF_TIME', id(56), pendingConfirmationReentryPolicy, draft),
    ).toBe('再交代できる選手はハーフタイム以降3名までです')
    // ...but 41 (already in the draft's re-entrants) is not blocked by the cap.
    expect(
      describeUnavailability(matchState, s.roster, 'HOME', 'HALF_TIME', id(41), pendingConfirmationReentryPolicy, draft.filter((p) => p.inPlayerId !== id(41))),
    ).toBeNull()
  })
})

describe('the real match, end to end (A-L)', () => {
  it('E-H: three pairs, then the two re-entries, all five recorded as half-time', () => {
    let s = atHalfTime()
    s = ok(confirmPairs(s, HT_FIRST_THREE, 1_810_000)) // E
    // F: the two re-entrants are now selectable from the confirmed state too.
    const matchState = getDerivedMatchState(s).state
    for (const n of [41, 58]) {
      expect(describeUnavailability(matchState, s.roster, 'HOME', 'HALF_TIME', id(n), pendingConfirmationReentryPolicy)).toBeNull()
    }
    s = ok(confirmPairs(s, HT_REENTRIES, 1_820_000)) // G
    expect(s.substitutionEvents.slice(2).every((e) => e.phase === 'HALF_TIME')).toBe(true) // H
    expect(s.substitutionEvents.slice(2).flatMap((e) => e.teamGroups[0].pairs)).toHaveLength(5)
    expect(summarize(s)).toEqual(EXPECTED_AFTER_FIVE_HT_PAIRS)
  })

  it('H: the same five pairs entered as ONE half-time substitution give the identical result', () => {
    const s = ok(confirmPairs(atHalfTime(), [...HT_FIRST_THREE, ...HT_REENTRIES], 1_810_000))
    expect(s.substitutionEvents[2].phase).toBe('HALF_TIME')
    expect(summarize(s)).toEqual(EXPECTED_AFTER_FIVE_HT_PAIRS)
  })

  it('order inside the one-group draft does not matter (re-entries listed first)', () => {
    const s = ok(confirmPairs(atHalfTime(), [...HT_REENTRIES, ...HT_FIRST_THREE], 1_810_000))
    expect(summarize(s)).toEqual(EXPECTED_AFTER_FIVE_HT_PAIRS)
  })

  it('I-L: second half starts with the right pitch/bench, 3 opportunities left, 2 re-entrants, and a normal second-half substitution works', () => {
    let s = ok(confirmPairs(atHalfTime(), [...HT_FIRST_THREE, ...HT_REENTRIES], 1_810_000))
    s = startSecondHalfPhase(s, SECOND_HALF_START)
    const before = summarize(s)
    expect(before.pitch).toEqual(EXPECTED_AFTER_FIVE_HT_PAIRS.pitch) // I
    expect(before.bench).toEqual(EXPECTED_AFTER_FIVE_HT_PAIRS.bench)
    expect(MAX_SECOND_HALF_OPPORTUNITIES - before.secondHalfUsed).toBe(3) // J
    expect(before.reentry).toEqual([41, 58]) // K

    // L: a second-half substitution (5 -> 56, 56 being a first-half starter = third re-entrant).
    s = ok(confirmPairs(s, [[5, 56]], SECOND_HALF_START + 60_000))
    const after = summarize(s)
    expect(after.secondHalfUsed).toBe(1)
    expect(after.pitch).toEqual([1, 2, 3, 4, 6, 11, 41, 50, 52, 56, 58])
    expect(after.reentry).toEqual([41, 56, 58])
    expect(after.needsReview).toEqual([])

    // The 3 re-entry cap still holds: a fourth re-entrant is refused.
    const fourth = confirmPairs(s, [[6, 28]], SECOND_HALF_START + 120_000)
    expect(fourth.errors).toContain('再交代できる選手はハーフタイム以降3名までです')
    expect(fourth.state.substitutionEvents).toHaveLength(s.substitutionEvents.length)
  })

  it('the 9-substitute and 7-starter-style caps are untouched: 7 substitutes used here, never more than the roster', () => {
    const s = ok(confirmPairs(atHalfTime(), [...HT_FIRST_THREE, ...HT_REENTRIES], 1_810_000))
    expect(summarize(s).usedSubs).toEqual(SUBS)
  })
})

describe('fixing a half-time substitution that was recorded as second half', () => {
  // The night's chain: only the first three pairs entered at half-time, the
  // second half was started, and the two re-entries were entered as a
  // second-half substitution.
  function recordedAsSecondHalf() {
    let s = ok(confirmPairs(atHalfTime(), HT_FIRST_THREE, 1_810_000))
    s = startSecondHalfPhase(s, SECOND_HALF_START)
    s = ok(confirmPairs(s, HT_REENTRIES, SECOND_HALF_START + 30_000))
    return s
  }

  it('starts out wrong: the pair consumed a second-half opportunity', () => {
    const s = recordedAsSecondHalf()
    const sum = summarize(s)
    expect(s.substitutionEvents.at(-1)!.phase).toBe('SECOND_HALF')
    expect(sum.secondHalfUsed).toBe(1)
    expect(sum.reentry).toEqual([41, 58])
  })

  it('moving it to half-time restores the opportunity and rebuilds everything from the log', () => {
    const wrong = recordedAsSecondHalf()
    const lastId = wrong.substitutionEvents.at(-1)!.id
    expect(canMoveSubstitutionToHalfTime(wrong, lastId)).toBe(true)
    expect(previewMoveSubstitutionToHalfTime(wrong, lastId)).toEqual({ newlyNeedingReview: 0 })

    const fixed = moveSubstitutionToHalfTime(wrong, lastId)
    const moved = fixed.substitutionEvents.at(-1)!
    expect(moved.phase).toBe('HALF_TIME')
    expect(fixed.substitutionEvents).toHaveLength(wrong.substitutionEvents.length) // nothing deleted, nothing added
    expect(moved.teamGroups).toEqual(wrong.substitutionEvents.at(-1)!.teamGroups)

    expect(summarize(fixed)).toEqual(EXPECTED_AFTER_FIVE_HT_PAIRS)
    expect(MAX_SECOND_HALF_OPPORTUNITIES - summarize(fixed).secondHalfUsed).toBe(3)
  })

  it('the timeline now shows all five pairs before the second-half marker', () => {
    const wrong = recordedAsSecondHalf()
    const fixed = moveSubstitutionToHalfTime(wrong, wrong.substitutionEvents.at(-1)!.id)
    const entries = buildTimeline({
      substitutionEvents: fixed.substitutionEvents,
      goalEvents: fixed.goalEvents,
      cardEvents: fixed.cardEvents,
      clock: fixed.clock,
      hydrationCompletionElapsedMsByHalf: fixed.hydrationCompletionElapsedMsByHalf,
    })
    const keys = entries.map((e) => e.key)
    const secondStart = keys.indexOf('marker:second-start')
    const htEvents = entries.filter((e) => e.kind === 'SUB_SINGLE' && e.phase === 'HALF_TIME')
    expect(htEvents).toHaveLength(2)
    for (const e of htEvents) expect(keys.indexOf(e.key)).toBeLessThan(secondStart)
    expect(entries.filter((e) => e.kind === 'SUB_SINGLE' && e.phase === 'SECOND_HALF')).toHaveLength(0)
  })

  it('survives a save / reload (JSON round trip)', () => {
    const wrong = recordedAsSecondHalf()
    const fixed = moveSubstitutionToHalfTime(wrong, wrong.substitutionEvents.at(-1)!.id)
    const reloaded = JSON.parse(JSON.stringify(fixed)) as AppState
    expect(summarize(reloaded)).toEqual(EXPECTED_AFTER_FIVE_HT_PAIRS)
  })

  it('a later normal second-half substitution still works after the fix', () => {
    const fixed = (() => {
      const wrong = recordedAsSecondHalf()
      return moveSubstitutionToHalfTime(wrong, wrong.substitutionEvents.at(-1)!.id)
    })()
    const s = ok(confirmPairs(fixed, [[5, 56]], SECOND_HALF_START + 600_000))
    expect(summarize(s).secondHalfUsed).toBe(1)
  })

  it('gives back the opportunity when the two pairs were two separate second-half substitutions', () => {
    let s = ok(confirmPairs(atHalfTime(), HT_FIRST_THREE, 1_810_000))
    s = startSecondHalfPhase(s, SECOND_HALF_START)
    s = ok(confirmPairs(s, [[43, 41]], SECOND_HALF_START + 30_000))
    s = ok(confirmPairs(s, [[38, 58]], SECOND_HALF_START + 40_000))
    expect(summarize(s).secondHalfUsed).toBe(2)
    for (const e of s.substitutionEvents.filter((x) => x.phase === 'SECOND_HALF')) s = moveSubstitutionToHalfTime(s, e.id)
    expect(summarize(s)).toEqual(EXPECTED_AFTER_FIVE_HT_PAIRS)
  })

  it('moving only the later of two second-half events replays it first; nothing is deleted', () => {
    let s = ok(confirmPairs(atHalfTime(), HT_FIRST_THREE, 1_810_000))
    s = startSecondHalfPhase(s, SECOND_HALF_START)
    s = ok(confirmPairs(s, [[43, 41]], SECOND_HALF_START + 30_000))
    s = ok(confirmPairs(s, [[38, 58]], SECOND_HALF_START + 40_000))
    const later = s.substitutionEvents.at(-1)!
    s = moveSubstitutionToHalfTime(s, later.id)
    expect(eventsInReplayOrder(s.substitutionEvents).at(-1)!.id).not.toBe(later.id) // it now precedes the second-half event
    const sum = summarize(s)
    expect(sum.needsReview).toEqual([])
    expect(sum.secondHalfUsed).toBe(1)
    expect(sum.reentry).toEqual([41, 58])
  })

  it('if moving an event leaves a later event impossible, it is flagged for review, never deleted', () => {
    let s = ok(confirmPairs(atHalfTime(), HT_FIRST_THREE, 1_810_000))
    s = startSecondHalfPhase(s, SECOND_HALF_START)
    s = ok(confirmPairs(s, [[43, 41]], SECOND_HALF_START + 30_000)) // X: 41 comes on
    s = ok(confirmPairs(s, [[41, 43]], SECOND_HALF_START + 40_000)) // Y: needs X first
    const y = s.substitutionEvents.at(-1)!
    const before = s.substitutionEvents.length
    expect(previewMoveSubstitutionToHalfTime(s, y.id).newlyNeedingReview).toBe(1)
    const moved = moveSubstitutionToHalfTime(s, y.id)
    expect(moved.substitutionEvents).toHaveLength(before)
    expect(summarize(moved).needsReview.map((r) => r.eventId)).toEqual([y.id])
  })

  it('is only offered for a second-half substitution after half-time has happened', () => {
    const ht = ok(confirmPairs(atHalfTime(), HT_FIRST_THREE, 1_810_000))
    expect(canMoveSubstitutionToHalfTime(ht, ht.substitutionEvents.at(-1)!.id)).toBe(false) // already half-time
    expect(canMoveSubstitutionToHalfTime(ht, ht.substitutionEvents[0].id)).toBe(false) // first half
    expect(moveSubstitutionToHalfTime(ht, ht.substitutionEvents[0].id)).toBe(ht)
    expect(canMoveSubstitutionToHalfTime(ht, 'nope')).toBe(false)
  })

  it('drops a same-stoppage link that would now span two phases', () => {
    let s = ok(confirmPairs(atHalfTime(), HT_FIRST_THREE, 1_810_000))
    s = startSecondHalfPhase(s, SECOND_HALF_START)
    s = ok(confirmPairs(s, HT_REENTRIES, SECOND_HALF_START + 30_000))
    const target = s.substitutionEvents.at(-1)!
    s = { ...s, substitutionEvents: s.substitutionEvents.map((e) => (e.id === target.id ? { ...e, stoppageGroupId: 'g' } : e)) }
    // a (hypothetical) partner event in the second half sharing the group
    const partner = { ...target, id: 'partner', stoppageGroupId: 'g', teamGroups: [{ teamId: 'AWAY' as const, pairs: [] }] }
    s = { ...s, substitutionEvents: [...s.substitutionEvents, partner] }
    const moved = moveSubstitutionToHalfTime(s, target.id)
    expect(moved.substitutionEvents.filter((e) => e.stoppageGroupId === 'g')).toHaveLength(0)
  })
})

describe('replay order', () => {
  it('is a no-op for a normally recorded (chronological) log', () => {
    const s = ok(confirmPairs(atHalfTime(), [...HT_FIRST_THREE, ...HT_REENTRIES], 1_810_000))
    expect(eventsInReplayOrder(s.substitutionEvents)).toEqual(s.substitutionEvents)
  })
})
