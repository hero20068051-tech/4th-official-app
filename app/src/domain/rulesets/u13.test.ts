import { beforeEach, describe, expect, it } from 'vitest'
import { describeUnavailability } from '../engine'
import { archiveFinishedMatch, loadArchive, toArchivedMatch } from '../matchArchive'
import { deriveScore } from '../matchRecord'
import {
  addDraftPair,
  addPlayers,
  canMoveSubstitutionToHalfTime,
  checkMatchStart,
  confirmDraft,
  correctStarters,
  createInitialAppState,
  deleteSubstitutionEvent,
  endFirstHalfPhase,
  endMatchPhase,
  getDerivedMatchState,
  moveSubstitutionPairsToSecondHalf,
  moveSubstitutionToHalfTime,
  opportunitiesUsedByMoves,
  recordCard,
  recordGoal,
  setDraftPair,
  setPlayerCategory,
  setRegisteredGK,
  setRuleSet,
  setStarter,
  setUnsetPlayersCategory,
  startFirstHalfPhase,
  startSecondHalfPhase,
  updateSubstitutionEventPairs,
  type AppState,
} from '../matchStore'
import { loadMatchState, saveMatchState } from '../persistence'
import { archivedNeedsReview, buildShareSummary } from '../shareSummary'
import type { PlayerCategory } from '../types'
import { getRuleSet, ruleSetOf } from './index'
import { saitamaWomenRules } from './saitamaWomen'
import { u13DevelopmentRules } from './u13Development'

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null }
  setItem(k: string, v: string) { this.data.set(k, String(v)) }
  removeItem(k: string) { this.data.delete(k) }
}
beforeEach(() => {
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()
})

const E: PlayerCategory = 'ELEMENTARY'
const J1: PlayerCategory = 'JUNIOR_HIGH_1'
const J2: PlayerCategory = 'JUNIOR_HIGH_2'
const id = (n: number) => `HOME:${n}`
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

// 27 registered (U13 has no overall squad limit): 小学生 1-14, 中1 21-28, 中2 31-35.
// Default starters (11): 小学生 1-6, 中1 21,22, 中2 31,32,33. Bench: 小学生 7-14, 中1 23-28, 中2 34,35.
const ELEM = range(1, 14)
const JH1 = range(21, 28)
const JH2 = range(31, 35)
const DEFAULT_STARTERS = [1, 2, 3, 4, 5, 6, 21, 22, 31, 32, 33]

function categorize(s: AppState, teamId: 'HOME' | 'AWAY', byCategory: [number[], PlayerCategory][]): AppState {
  for (const [numbers, category] of byCategory) {
    const r = setPlayerCategory(s, numbers.map((n) => `${teamId}:${n}`), category)
    expect(r.errors).toEqual([])
    s = r.state
  }
  return s
}

function preMatch(starters: number[] = DEFAULT_STARTERS): AppState {
  let s = createInitialAppState()
  const chosen = setRuleSet(s, 'u13-development')
  expect(chosen.errors).toEqual([])
  s = chosen.state
  s = addPlayers(s, 'HOME', [...ELEM, ...JH1, ...JH2].join(',')).state
  s = addPlayers(s, 'AWAY', range(1, 12).join(',')).state
  s = categorize(s, 'HOME', [[ELEM, E], [JH1, J1], [JH2, J2]])
  s = categorize(s, 'AWAY', [[range(1, 12), E]])
  for (const n of starters) s = setStarter(s, id(n), true).state
  for (const n of range(1, 11)) s = setStarter(s, `AWAY:${n}`, true).state
  return s
}
const started = (starters?: number[]) => startFirstHalfPhase(preMatch(starters), 0)

function sub(s: AppState, pairs: [number, number][], at = 1000) {
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
const toSecondHalf = (s: AppState) => startSecondHalfPhase(endFirstHalfPhase(s, 1_800_000), 2_400_000)
const counters = (s: AppState) => getDerivedMatchState(s).state.teamCounters.HOME
const loc = (s: AppState, n: number) => getDerivedMatchState(s).state.players[id(n)].location

describe('U13 setup: rules, categories, registration', () => {
  it('the rule set is chosen per match; U13 has no overall squad limit (27 registered is fine)', () => {
    const s = preMatch()
    expect(ruleSetOf(s.settings)).toBe(u13DevelopmentRules)
    expect(u13DevelopmentRules.maxSquadSize).toBeNull()
    expect(s.roster.filter((p) => p.teamId === 'HOME')).toHaveLength(27)
  })

  it('registered 中2 are limited to 5: the 6th is refused and nothing changes', () => {
    let s = preMatch()
    s = ok(addPlayers(s, 'HOME', '36'))
    const r = setPlayerCategory(s, [id(36)], J2)
    expect(r.errors).toEqual(['中2は5名までです'])
    expect(r.state).toBe(s)
    // a different category for the same player is fine
    expect(setPlayerCategory(s, [id(36)], J1).errors).toEqual([])
  })

  it('a 中2 can be changed to another category to make room, then another becomes 中2', () => {
    let s = preMatch()
    s = ok(addPlayers(s, 'HOME', '36'))
    s = ok(setPlayerCategory(s, [id(35)], J1))
    s = ok(setPlayerCategory(s, [id(36)], J2))
    expect(s.roster.filter((p) => p.teamId === 'HOME' && p.category === J2)).toHaveLength(5)
  })

  it('players start with NO category; the match cannot start until every player has one', () => {
    let s = createInitialAppState()
    s = ok(setRuleSet(s, 'u13-development'))
    s = addPlayers(s, 'HOME', '1,2,3,4,5,6,7,8,9,10,11,12').state
    s = addPlayers(s, 'AWAY', '1,2,3,4,5,6,7').state
    expect(s.roster.every((p) => p.category === undefined)).toBe(true)
    for (const p of s.roster.filter((p) => p.number <= 11)) s = setStarter(s, p.id, true).state
    const problems = checkMatchStart(s)
    expect(problems.map((p) => p.teamId)).toEqual(['HOME', 'AWAY'])
    expect(problems[0].messages).toEqual(['選手区分が未設定の選手が12名います'])
    expect(startFirstHalfPhase(s, 0)).toBe(s) // refused, nothing starts
  })

  it('"make the rest 小学生" is an explicit bulk action and then the match can start', () => {
    let s = createInitialAppState()
    s = ok(setRuleSet(s, 'u13-development'))
    s = addPlayers(s, 'HOME', '1,2,3,4,5,6,7,8,9,10,11,12').state
    s = addPlayers(s, 'AWAY', '1,2,3,4,5,6,7,8,9,10,11').state
    for (const p of s.roster.filter((p) => p.number <= 11)) s = setStarter(s, p.id, true).state
    s = ok(setPlayerCategory(s, [id(11), id(12)], J1))
    s = ok(setUnsetPlayersCategory(s, 'HOME', E))
    s = ok(setUnsetPlayersCategory(s, 'AWAY', E))
    const count = (c: PlayerCategory) => s.roster.filter((p) => p.teamId === 'HOME' && p.category === c).length
    expect([count(E), count(J1), count(J2)]).toEqual([10, 2, 0])
    expect(checkMatchStart(s)).toEqual([])
    expect(startFirstHalfPhase(s, 0).phase).toBe('FIRST_HALF')
  })

  it('kick-off headcount is the same as the other league (helper still says 11 / 7-10 / 6-)', () => {
    expect(u13DevelopmentRules.evaluateStartEligibility(11).level).toBe('OK')
    expect(u13DevelopmentRules.evaluateStartEligibility(10).level).toBe('WARN')
    expect(u13DevelopmentRules.evaluateStartEligibility(7).level).toBe('WARN')
    expect(u13DevelopmentRules.evaluateStartEligibility(6).level).toBe('BLOCK')
  })

  it('4 中2 in the starting eleven cannot kick off; 3 can', () => {
    const four = preMatch([1, 2, 3, 4, 5, 6, 21, 31, 32, 33, 34])
    expect(checkMatchStart(four)[0].messages).toEqual(['中2は先発に3名までです（現在4名）'])
    expect(startFirstHalfPhase(four, 0)).toBe(four)
    expect(startFirstHalfPhase(preMatch(), 0).phase).toBe('FIRST_HALF')
  })

  it('correcting the starters after kick-off cannot put a 4th 中2 on the pitch', () => {
    const s = started()
    const r = correctStarters(s, 'HOME', [1, 2, 3, 4, 5, 6, 21, 31, 32, 33, 34].map(id))
    expect(r.errors).toEqual(['中2は先発に3名までです（現在4名）'])
    expect(correctStarters(s, 'HOME', [1, 2, 3, 4, 5, 6, 7, 21, 31, 32, 33].map(id)).errors).toEqual([])
  })

  it('the rule set can only be changed before kick-off, and never by discarding registered players', () => {
    const s = started()
    expect(setRuleSet(s, 'saitama-women').errors).toEqual(['試合開始後は大会ルールを変更できません'])
    // 27 registered cannot become a Saitama match (20 limit) — refused, nothing removed
    const pre = preMatch()
    const back = setRuleSet(pre, 'saitama-women')
    expect(back.errors[0]).toContain('20名を超えている')
    expect(back.state).toBe(pre)
  })

  it('categories are not offered under the Saitama rules', () => {
    let s = createInitialAppState()
    s = addPlayers(s, 'HOME', '1,2,3').state
    expect(setPlayerCategory(s, [id(1)], J1).errors).toEqual(['この大会ルールでは選手区分は使いません'])
  })
})

describe('U13: elementary players (free substitution, free re-entry)', () => {
  it('小学生 OUT -> can come back IN, even in the first half, with no other condition', () => {
    let s = started()
    s = ok(sub(s, [[1, 7]])) // 7 is a never-used 小学生 sub; many others still unused
    const back = sub(s, [[7, 1]], 2000) // 1 goes straight back on
    expect(back.errors).toEqual([])
    expect(loc(back.state, 1)).toBe('pitch')
    expect(loc(back.state, 7)).toBe('bench')
  })

  it('there is no cap on the number of re-entering elementary players, no 9-substitute cap, and GK flags mean nothing', () => {
    let s = started()
    for (const n of [1, 2, 3, 4, 5, 6]) s = ok(setRegisteredGK(s, id(n), true) && sub(s, [[n, n + 6]], n * 1000))
    for (const n of [1, 2, 3, 4, 5, 6]) s = ok(sub(s, [[n + 6, n]], 10_000 + n)) // six players re-enter (Saitama allows 3)
    for (const [k, inn] of [13, 14, 7, 8].entries()) s = ok(sub(s, [[k + 1, inn]], 20_000 + k)) // more substitutes, never blocked
    expect(counters(s).reentryPlayerIds.length).toBeGreaterThanOrEqual(6)
    expect(getDerivedMatchState(s).needsReview).toEqual([])
    // and none of it used a second-half opportunity
    expect(counters(s).secondHalfOpportunitiesUsed).toBe(0)
  })

  it('the same player may re-enter repeatedly (no per-player limit is set)', () => {
    let s = started()
    s = ok(sub(s, [[1, 7]], 1))
    s = ok(sub(s, [[7, 1]], 2))
    s = ok(sub(s, [[1, 7]], 3))
    s = ok(sub(s, [[7, 1]], 4))
    expect(loc(s, 1)).toBe('pitch')
  })

  it('the chip explanation never blocks an elementary bench player', () => {
    const s = started()
    const m = getDerivedMatchState(s).state
    for (const n of ELEM.filter((n) => n > 6)) {
      expect(describeUnavailability(m, s.roster, 'HOME', 'FIRST_HALF', id(n), u13DevelopmentRules)).toBeNull()
    }
  })
})

describe('U13: junior-high players (no re-entry, 7 players, 3 second-half opportunities)', () => {
  it('中学生 OUT -> cannot come back IN, whoever they are swapped with (starter or substitute)', () => {
    let s = started()
    s = ok(sub(s, [[21, 7]])) // 中1 starter goes off, replaced by a 小学生
    const r = sub(s, [[7, 21]], 2000)
    expect(r.errors).toEqual(['21番は中学生のため再出場できません'])
    expect(r.state.substitutionEvents).toHaveLength(1)

    s = ok(sub(s, [[1, 23]], 3000)) // a 中1 substitute comes on...
    s = ok(sub(s, [[23, 8]], 4000)) // ...goes off...
    expect(sub(s, [[2, 23]], 5000).errors).toEqual(['23番は中学生のため再出場できません'])
    // the explanation shown on the chip says the same
    expect(describeUnavailability(getDerivedMatchState(s).state, s.roster, 'HOME', 'SECOND_HALF', id(23), u13DevelopmentRules)).toBe(
      '中学生は一度交代すると再出場できません',
    )
    // another junior-high player who has not played can still come on
    expect(sub(s, [[2, 24]], 6000).errors).toEqual([])
  })

  it('a mixed team: junior-high and elementary players follow their own rules at the same time', () => {
    let s = started()
    s = ok(sub(s, [[1, 7]], 1000)) // 小学生 swap
    s = ok(sub(s, [[7, 1]], 2000)) // 小学生 re-entry: fine
    s = ok(sub(s, [[21, 23]], 3000)) // 中1 swap
    expect(sub(s, [[23, 21]], 4000).errors.length).toBeGreaterThan(0) // 中1 re-entry: not allowed
    expect(sub(s, [[2, 8]], 4000).errors).toEqual([]) // 小学生 still free
  })

  it('the 7-player limit counts junior-high players who come ON, over the whole match (first half, half-time and second half together)', () => {
    let s = started()
    // first half: 2 (中1 23, 24), half-time: 2 (中1 25, 26), second half: 3 (27, 28 and 中2 34)
    s = ok(sub(s, [[1, 23], [2, 24]], 1000))
    s = endFirstHalfPhase(s, 1_800_000)
    s = ok(sub(s, [[3, 25], [4, 26]], 1_800_500))
    s = startSecondHalfPhase(s, 2_400_000)
    s = ok(sub(s, [[5, 27], [6, 28]], 2_500_000))
    s = ok(sub(s, [[31, 34]], 2_600_000)) // 中2 out, 中2 in: 3 on the pitch stays 3
    expect(counters(s).usedSubstituteIds).toHaveLength(7)
    // the 8th junior-high player to come on is refused
    const eighth = sub(s, [[32, 35]], 2_700_000)
    expect(eighth.errors).toEqual(['中学生の交代は7名までです'])
    // an elementary player still can (even in place of a junior-high player)
    expect(sub(s, [[21, 9]], 2_800_000).errors).toEqual([])
    // and the chip says why
    expect(describeUnavailability(getDerivedMatchState(s).state, s.roster, 'HOME', 'SECOND_HALF', id(35), u13DevelopmentRules)).toBe(
      '中学生の交代は7名までです',
    )
  })

  it('second-half opportunities: a group with any junior-high IN counts once, however many come on', () => {
    let s = toSecondHalf(started())
    s = ok(sub(s, [[1, 23], [2, 24], [3, 25]], 2_500_000))
    expect(counters(s).secondHalfOpportunitiesUsed).toBe(1)
  })

  it('after 3 second-half opportunities, a 4th group with a junior-high IN is refused; elementary-only groups are still free', () => {
    let s = toSecondHalf(started())
    s = ok(sub(s, [[1, 23]], 2_500_000))
    s = ok(sub(s, [[2, 24]], 2_600_000))
    s = ok(sub(s, [[3, 25]], 2_700_000))
    expect(counters(s).secondHalfOpportunitiesUsed).toBe(3)

    expect(sub(s, [[4, 26]], 2_800_000).errors).toEqual(['後半の中学生の交代は3回までです'])
    // a mixed group (小学生 swap + 中学生 IN) is refused as a whole
    const mixed = sub(s, [[5, 8], [6, 26]], 2_800_000)
    expect(mixed.errors).toEqual(['後半の中学生の交代は3回までです'])
    expect(mixed.state.substitutionEvents).toHaveLength(3)
    // elementary-only substitutions and re-entries do not use an opportunity and are still allowed
    s = ok(sub(s, [[5, 8]], 2_900_000))
    s = ok(sub(s, [[8, 5]], 3_000_000))
    expect(counters(s).secondHalfOpportunitiesUsed).toBe(3)
    expect(describeUnavailability(getDerivedMatchState(s).state, s.roster, 'HOME', 'SECOND_HALF', id(26), u13DevelopmentRules)).toBe(
      '後半の中学生の交代は3回までです',
    )
  })

  it('a mixed group with a junior-high IN is ONE opportunity even with small-school swaps in it', () => {
    let s = toSecondHalf(started())
    s = ok(sub(s, [[1, 7], [2, 8], [21, 23]], 2_500_000))
    expect(counters(s).secondHalfOpportunitiesUsed).toBe(1)
  })

  it('half-time and first-half junior-high substitutions do not use second-half opportunities', () => {
    let s = started()
    s = ok(sub(s, [[1, 23]], 1000)) // first half
    s = endFirstHalfPhase(s, 1_800_000)
    s = ok(sub(s, [[2, 24], [3, 25]], 1_800_500)) // half-time
    s = startSecondHalfPhase(s, 2_400_000)
    expect(counters(s).secondHalfOpportunitiesUsed).toBe(0)
    for (const [out, inn, t] of [[4, 26, 2_500_000], [5, 27, 2_600_000], [6, 28, 2_700_000]] as const) s = ok(sub(s, [[out, inn]], t))
    expect(counters(s).secondHalfOpportunitiesUsed).toBe(3)
  })

  it('a junior-high player replacing an elementary player is a junior-high substitution; an elementary player replacing a junior-high player is free', () => {
    let s = toSecondHalf(started())
    s = ok(sub(s, [[21, 7]], 2_500_000)) // 小学生 IN for 中1 OUT: free
    expect(counters(s).secondHalfOpportunitiesUsed).toBe(0)
    expect(counters(s).usedSubstituteIds).toEqual([])
    s = ok(sub(s, [[1, 23]], 2_600_000)) // 中1 IN for 小学生 OUT: counts
    expect(counters(s).secondHalfOpportunitiesUsed).toBe(1)
    expect(counters(s).usedSubstituteIds).toEqual([id(23)])
  })
})

describe('U13: 中2 on the pitch (max 3), judged on the whole group', () => {
  it('a 4th 中2 cannot come on while 3 are on the pitch (whoever goes off)', () => {
    const s = started()
    const r = sub(s, [[1, 34]])
    expect(r.errors).toEqual(['中2は同時にピッチに3名までです（この交代で4名になります）'])
    expect(r.state.substitutionEvents).toHaveLength(0)
  })

  it('once a 中2 goes off, another 中2 may come on', () => {
    let s = started()
    s = ok(sub(s, [[31, 7]], 1000)) // 3 -> 2 on the pitch
    expect(sub(s, [[1, 34]], 2000).errors).toEqual([]) // back to 3
  })

  it('one 中2 OUT and one 中2 IN in the same substitution is valid (3 stays 3)', () => {
    const s = started()
    expect(sub(s, [[31, 34]]).errors).toEqual([])
  })

  it('the final picture of the whole group is what counts, not the order of the pairs', () => {
    const s = started()
    // 2 OUT, 2 IN: 3 -> 3, valid in either order
    expect(sub(s, [[31, 34], [32, 35]]).errors).toEqual([])
    expect(sub(s, [[32, 35], [31, 34]]).errors).toEqual([])
    // 1 OUT, 2 IN: 3 -> 4, refused in either order
    const expected = ['中2は同時にピッチに3名までです（この交代で4名になります）']
    expect(sub(s, [[31, 34], [1, 35]]).errors).toEqual(expected)
    expect(sub(s, [[1, 35], [31, 34]]).errors).toEqual(expected)
  })

  it('the chip explanation is decided once the OUT player of the pair is known', () => {
    const s = started()
    const m = getDerivedMatchState(s).state
    const why = (out?: number) =>
      describeUnavailability(m, s.roster, 'HOME', 'FIRST_HALF', id(34), u13DevelopmentRules, [], out ? id(out) : undefined)
    expect(why(undefined)).toBeNull() // OUT not chosen yet: either order of choosing stays possible
    expect(why(1)).toBe('中2がすでにピッチに3名います')
    expect(why(31)).toBeNull()
  })
})

describe('U13: history edits, cancellation and recalculation', () => {
  it('cancelling a substitution recalculates counters and who is on the pitch', () => {
    let s = toSecondHalf(started())
    s = ok(sub(s, [[1, 23]], 2_500_000))
    s = ok(sub(s, [[2, 24]], 2_600_000))
    expect(counters(s).secondHalfOpportunitiesUsed).toBe(2)
    s = deleteSubstitutionEvent(s, s.substitutionEvents[0].id)
    expect(counters(s).secondHalfOpportunitiesUsed).toBe(1)
    expect(counters(s).usedSubstituteIds).toEqual([id(24)])
    expect(loc(s, 1)).toBe('pitch')
    expect(loc(s, 23)).toBe('bench')
  })

  it('cancelling an earlier substitution never deletes a later one; it is flagged for review', () => {
    let s = started()
    s = ok(sub(s, [[1, 23]], 1000))
    s = ok(sub(s, [[23, 7]], 2000)) // depends on 23 being on the pitch
    const before = s.substitutionEvents.length
    s = deleteSubstitutionEvent(s, s.substitutionEvents[0].id)
    expect(s.substitutionEvents).toHaveLength(before - 1)
    expect(getDerivedMatchState(s).needsReview.map((r) => r.eventId)).toEqual([s.substitutionEvents[0].id])
  })

  it('an edit that would make a junior-high player re-enter is flagged for review, not silently accepted', () => {
    let s = started()
    s = ok(sub(s, [[21, 7]], 1000))
    s = ok(sub(s, [[1, 8]], 2000))
    // edit the second substitution into "7 -> 21": a 中1 coming back
    s = updateSubstitutionEventPairs(s, s.substitutionEvents[1].id, [{ outPlayerId: id(7), inPlayerId: id(21) }])
    const review = getDerivedMatchState(s).needsReview
    expect(review).toHaveLength(1)
    expect(review[0].messages).toEqual(['21番は中学生のため再出場できません'])
    expect(s.substitutionEvents).toHaveLength(2)
  })

  it('half-time <-> second half corrections use the U13 counting (junior-high groups only)', () => {
    let s = endFirstHalfPhase(started(), 1_800_000)
    s = ok(sub(s, [[1, 23], [2, 7]], 1_800_500)) // one half-time group: a 中1 IN and a 小学生 swap
    s = startSecondHalfPhase(s, 2_400_000)
    expect(counters(s).secondHalfOpportunitiesUsed).toBe(0)
    const ev = s.substitutionEvents[0].id
    expect(opportunitiesUsedByMoves(s, ev, [{ pairIndexes: [0, 1], elapsedMs: 135_000 }])).toBe(1)
    expect(opportunitiesUsedByMoves(s, ev, [{ pairIndexes: [1], elapsedMs: 135_000 }])).toBe(0) // small-school swap alone: free
    // move only the small-school swap to the second half: no opportunity used
    let moved = moveSubstitutionPairsToSecondHalf(s, ev, [{ pairIndexes: [1], elapsedMs: 135_000 }]).state
    expect(counters(moved).secondHalfOpportunitiesUsed).toBe(0)
    // move the junior-high pair: one used
    moved = moveSubstitutionPairsToSecondHalf(s, ev, [{ pairIndexes: [0], elapsedMs: 135_000 }]).state
    expect(counters(moved).secondHalfOpportunitiesUsed).toBe(1)
    const sh = moved.substitutionEvents.find((e) => e.phase === 'SECOND_HALF')!
    expect(canMoveSubstitutionToHalfTime(moved, sh.id)).toBe(true)
    const back = moveSubstitutionToHalfTime(moved, sh.id)
    expect(counters(back).secondHalfOpportunitiesUsed).toBe(0)
  })
})

describe('U13: saving, restart, finishing, archive', () => {
  it('a U13 match (rule set + categories + history) survives save / reload / app restart', () => {
    let s = toSecondHalf(started())
    s = ok(sub(s, [[1, 23], [21, 7]], 2_500_000))
    saveMatchState(s)
    const restored = loadMatchState()!
    expect(restored.settings.rulesetId).toBe('u13-development')
    expect(restored.roster.filter((p) => p.category === J2).map((p) => p.number).sort()).toEqual(JH2)
    expect(getDerivedMatchState(restored)).toEqual(getDerivedMatchState(s))
    // and it keeps judging by U13 rules after the reload: 中1 21 went off, so cannot come back
    expect(sub(restored, [[7, 21]], 2_700_000).errors).toEqual(['21番は中学生のため再出場できません'])
  })

  it('finishing archives it with its rule set; reopening it re-checks with U13 rules and shows goals/cards', () => {
    let s = toSecondHalf(started())
    s = ok(sub(s, [[1, 7]], 2_500_000))
    s = ok(sub(s, [[7, 1]], 2_600_000)) // elementary first-half-style re-entry, legal in U13
    s = recordGoal(s, { teamId: 'HOME', scorerNumber: 10, ownGoal: false, ownGoalByNumber: null }, 'SECOND_HALF', 60_000)
    s = recordCard(s, { teamId: 'AWAY', card: 'YELLOW', targetType: 'PLAYER', playerNumber: 4, officialRole: null, officialName: '' }, 'SECOND_HALF', 90_000)
    s = endMatchPhase(s, 4_200_000)
    expect(archiveFinishedMatch(s)).toBe(true)
    const [entry] = loadArchive()
    expect(entry.match.settings.rulesetId).toBe('u13-development')
    expect(entry.match.roster.some((p) => p.category === J2)).toBe(true)
    expect(archivedNeedsReview(entry)).toEqual([])
    const share = buildShareSummary(entry)
    expect(share).toMatchObject({ homeScore: 1, awayScore: 0 })
    expect(share.cards).toHaveLength(1)
    expect(deriveScore(entry.match.goalEvents)).toEqual({ HOME: 1, AWAY: 0 })
  })

  it('archived U13 records are judged by U13 (an elementary re-entry that another league forbids is not "needs review")', () => {
    let s = started()
    s = ok(sub(s, [[1, 7]], 1000))
    s = ok(sub(s, [[7, 1]], 2000))
    s = endMatchPhase(toSecondHalf(s), 4_200_000)
    const entry = toArchivedMatch(s, 1)
    expect(archivedNeedsReview(entry)).toEqual([])
    // the very same record read under the Saitama women's rules would need review (re-entry in the first half)
    const asSaitama = { ...entry, match: { ...entry.match, settings: { ...entry.match.settings, rulesetId: 'saitama-women' as const } } }
    expect(archivedNeedsReview(asSaitama).length).toBeGreaterThan(0)
  })
})

describe('the two rule sets do not contaminate each other', () => {
  const HISTORY: { at: number; pairs: [number, number][] }[] = [
    { at: 1000, pairs: [[1, 7]] },
    { at: 2000, pairs: [[7, 1]] }, // first-half re-entry: Saitama refuses, U13 allows
    { at: 3000, pairs: [[21, 23], [22, 24]] },
  ]

  function play(rulesetId: 'saitama-women' | 'u13-development', withCategories: boolean): { errors: string[][]; derived: ReturnType<typeof getDerivedMatchState> } {
    let s = createInitialAppState()
    s = ok(setRuleSet(s, rulesetId))
    s = addPlayers(s, 'HOME', [...ELEM, ...JH1, ...JH2].join(',')).state
    s = addPlayers(s, 'AWAY', range(1, 11).join(',')).state
    if (rulesetId === 'u13-development' || withCategories) {
      // categories are attached directly for the "Saitama match carrying categories" case
      const cat = (n: number): PlayerCategory => (n >= 31 ? J2 : n >= 21 ? J1 : E)
      s = { ...s, roster: s.roster.map((p) => ({ ...p, category: cat(p.number) })) }
    }
    for (const n of DEFAULT_STARTERS) s = setStarter(s, id(n), true).state
    for (const n of range(1, 11)) s = setStarter(s, `AWAY:${n}`, true).state
    s = startFirstHalfPhase(s, 0)
    const errors: string[][] = []
    for (const h of HISTORY) {
      const r = sub(s, h.pairs, h.at)
      errors.push(r.errors)
      s = r.state
    }
    return { errors, derived: getDerivedMatchState(s) }
  }

  it('player categories present on a Saitama match are ignored completely (same result as without them)', () => {
    const plain = play('saitama-women', false)
    const withCats = play('saitama-women', true)
    expect(withCats.errors).toEqual(plain.errors)
    expect(withCats.derived).toEqual(plain.derived)
    expect(plain.errors[1].length).toBeGreaterThan(0) // Saitama forbids first-half re-entry
  })

  it('the Saitama rules (first-half re-entry ban, unlock condition, 3-player cap, 9 cap, GK, 3 second-half occasions) are NOT applied to U13', () => {
    const u13 = play('u13-development', true)
    expect(u13.errors[1]).toEqual([]) // first-half re-entry is fine
    expect(u13.errors[0]).toEqual([])
    // junior-high 21,22 came off in the third substitution and 23,24 replaced them: no unlock/opportunity rules interfere
    expect(u13.derived.needsReview).toEqual([])
  })

  it('the U13 junior-high rules are not applied to a Saitama match', () => {
    // In Saitama a starter may go off and come back at half-time once every substitute has played;
    // U13 forbids that for junior-high players. Under Saitama rules 21 (a "junior-high" number here) is unrestricted.
    let s = createInitialAppState()
    s = addPlayers(s, 'HOME', '1,2,3,4,5,6,7,8,9,10,11,12').state
    s = addPlayers(s, 'AWAY', range(1, 11).join(',')).state
    s = { ...s, roster: s.roster.map((p) => ({ ...p, category: p.number > 6 ? J1 : E })) }
    for (const n of range(1, 11)) s = setStarter(s, id(n), true).state
    for (const n of range(1, 11)) s = setStarter(s, `AWAY:${n}`, true).state
    s = startFirstHalfPhase(s, 0)
    s = ok(sub(s, [[7, 12]], 1000)) // "junior-high" 7 off, 12 on (the only substitute has now appeared)
    s = endFirstHalfPhase(s, 1_800_000)
    s = ok(sub(s, [[12, 7]], 1_800_500)) // 7 (a "junior-high" player) re-enters at half-time: fine under Saitama
    expect(loc(s, 7)).toBe('pitch')
  })

  it('goals and cards are the same for both rule sets', () => {
    for (const id2 of ['saitama-women', 'u13-development'] as const) {
      let s = ok(setRuleSet(createInitialAppState(), id2))
      s = recordGoal(s, { teamId: 'HOME', scorerNumber: 9, ownGoal: false, ownGoalByNumber: null }, 'FIRST_HALF', 1000)
      expect(deriveScore(s.goalEvents)).toEqual({ HOME: 1, AWAY: 0 })
    }
  })

  it('each rule set reports its own limits to the screens', () => {
    expect(saitamaWomenRules.secondHalfBadge({ counters: { usedSubstituteIds: [], secondHalfOpportunitiesUsed: 1, reentryPlayerIds: [] }, phase: 'SECOND_HALF', roster: [], teamId: 'HOME' })).toBe('後半の交代 あと2回')
    expect(u13DevelopmentRules.secondHalfBadge({ counters: { usedSubstituteIds: [], secondHalfOpportunitiesUsed: 1, reentryPlayerIds: [] }, phase: 'SECOND_HALF', roster: [], teamId: 'HOME' })).toBe('中学生の後半交代 あと2回')
    expect(getRuleSet('u13-development').name).toBe('U13育成リーグ')
    expect(u13DevelopmentRules.usesGoalkeeperRegistration).toBe(false)
    expect(saitamaWomenRules.usesGoalkeeperRegistration).toBe(true)
  })
})

