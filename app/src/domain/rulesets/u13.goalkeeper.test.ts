import { beforeEach, describe, expect, it } from 'vitest'
import { describeUnavailability } from '../engine'
import {
  addDraftPair,
  addPlayers,
  confirmDraft,
  createInitialAppState,
  deleteSubstitutionEvent,
  endFirstHalfPhase,
  getDerivedMatchState,
  setDraftPair,
  setPlayerCategory,
  setRegisteredGK,
  setRuleSet,
  setStarter,
  startFirstHalfPhase,
  startSecondHalfPhase,
  type AppState,
} from '../matchStore'
import type { PlayerCategory } from '../types'
import { saitamaWomenRules } from './saitamaWomen'
import { u13DevelopmentRules } from './u13Development'

// U13 goalkeepers: registration is for DISPLAY only. A goalkeeper is judged
// exactly like any other player of the same category.

beforeEach(() => {
  const data = new Map<string, string>()
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  }
})

const E: PlayerCategory = 'ELEMENTARY'
const J1: PlayerCategory = 'JUNIOR_HIGH_1'
const J2: PlayerCategory = 'JUNIOR_HIGH_2'
const id = (n: number) => `HOME:${n}`
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const ELEM = range(1, 14)
const JH1 = range(21, 28)
const JH2 = range(31, 35)
const DEFAULT_STARTERS = [1, 2, 3, 4, 5, 6, 21, 22, 31, 32, 33]

function ok(r: { state: AppState; errors: string[] }): AppState {
  expect(r.errors).toEqual([])
  return r.state
}

function preMatch(gks: number[] = []): AppState {
  let s = ok(setRuleSet(createInitialAppState(), 'u13-development'))
  s = addPlayers(s, 'HOME', [...ELEM, ...JH1, ...JH2].join(',')).state
  s = addPlayers(s, 'AWAY', range(1, 12).join(',')).state
  for (const [numbers, category] of [[ELEM, E], [JH1, J1], [JH2, J2]] as [number[], PlayerCategory][]) {
    s = ok(setPlayerCategory(s, numbers.map(id), category))
  }
  s = ok(setPlayerCategory(s, range(1, 12).map((n) => `AWAY:${n}`), E))
  for (const n of DEFAULT_STARTERS) s = setStarter(s, id(n), true).state
  for (const n of range(1, 11)) s = setStarter(s, `AWAY:${n}`, true).state
  for (const n of gks) s = setRegisteredGK(s, id(n), true)
  return s
}
const started = (gks: number[] = []) => startFirstHalfPhase(preMatch(gks), 0)

function sub(s: AppState, pairs: [number, number][], at = 1000) {
  for (let i = 0; i < pairs.length; i++) {
    if (i > 0) s = addDraftPair(s, 'HOME')
    s = setDraftPair(s, 'HOME', i, 'out', id(pairs[i][0]))
    s = setDraftPair(s, 'HOME', i, 'in', id(pairs[i][1]))
  }
  return confirmDraft(s, 'HOME', at)
}
const toSecondHalf = (s: AppState) => startSecondHalfPhase(endFirstHalfPhase(s, 1_800_000), 2_400_000)
const derived = (s: AppState) => getDerivedMatchState(s).state
const loc = (s: AppState, n: number) => derived(s).players[id(n)].location

describe('U13 goalkeepers: registration and display', () => {
  it('goalkeepers can be registered (several allowed) and the flag is kept', () => {
    let s = preMatch()
    s = setRegisteredGK(s, id(1), true)
    s = setRegisteredGK(s, id(7), true)
    s = setRegisteredGK(s, id(31), true)
    expect(s.roster.filter((p) => p.isRegisteredGK).map((p) => p.number).sort((a, b) => a - b)).toEqual([1, 7, 31])
    s = setRegisteredGK(s, id(7), false)
    expect(s.roster.filter((p) => p.isRegisteredGK).map((p) => p.number).sort((a, b) => a - b)).toEqual([1, 31])
    // registering a goalkeeper never changes the category
    expect(s.roster.find((p) => p.id === id(31))!.category).toBe(J2)
  })

  it('the rule set declares GK as display-only; the other league still lets it affect the rules', () => {
    expect(u13DevelopmentRules.goalkeeperRegistration).toBe('DISPLAY_ONLY')
    expect(saitamaWomenRules.goalkeeperRegistration).toBe('AFFECTS_RULES')
  })

  it('the chip tag shows category and GK together; field players only show the category', () => {
    const s = preMatch([1, 21, 31])
    const tag = (n: number) => u13DevelopmentRules.playerTag(s.roster.find((p) => p.id === id(n))!)
    expect(tag(1)).toBe('小・GK')
    expect(tag(7)).toBe('小')
    expect(tag(21)).toBe('中1・GK')
    expect(tag(22)).toBe('中1')
    expect(tag(31)).toBe('中2・GK')
    expect(tag(32)).toBe('中2')
  })

  it('a goalkeeper without a category yet is still visible (as ?・GK)', () => {
    let s = ok(setRuleSet(createInitialAppState(), 'u13-development'))
    s = addPlayers(s, 'HOME', '1').state
    s = setRegisteredGK(s, id(1), true)
    expect(u13DevelopmentRules.playerTag(s.roster[0])).toBe('?・GK')
  })

  it('the Saitama screens are unchanged: no tag on the chips, GK or not', () => {
    const s = setRegisteredGK(addPlayers(createInitialAppState(), 'HOME', '1,2').state, id(1), true)
    expect(saitamaWomenRules.playerTag(s.roster[0])).toBeNull()
    expect(saitamaWomenRules.playerTag(s.roster[1])).toBeNull()
  })

  it('a goalkeeper flag survives the match start and every later phase', () => {
    let s = started([1, 31])
    s = toSecondHalf(s)
    expect(s.roster.filter((p) => p.isRegisteredGK).map((p) => p.number)).toEqual([1, 31])
  })
})

describe('U13 goalkeepers are judged like any other player of their category', () => {
  it('小学生 GK: may go off and come back (re-entry) like any 小学生', () => {
    let s = started([1])
    s = ok(sub(s, [[1, 7]], 1000))
    expect(loc(s, 1)).toBe('bench')
    s = ok(sub(s, [[7, 1]], 2000))
    expect(loc(s, 1)).toBe('pitch')
  })

  it('中1 GK: once off, may not come back', () => {
    let s = started([21])
    s = ok(sub(s, [[21, 23]], 1000))
    const back = sub(s, [[23, 21]], 2000)
    expect(back.errors).toEqual(['21番は中学生のため再出場できません'])
    expect(
      describeUnavailability(derived(s), s.roster, 'HOME', 'FIRST_HALF', id(21), u13DevelopmentRules),
    ).toBe('中学生は一度交代すると再出場できません')
  })

  it('中1 GK coming on counts as a junior-high substitute (7 players) and as a second-half opportunity', () => {
    let s = toSecondHalf(started([23]))
    s = ok(sub(s, [[1, 23]], 2_500_000))
    expect(derived(s).teamCounters.HOME.usedSubstituteIds).toEqual([id(23)])
    expect(derived(s).teamCounters.HOME.secondHalfOpportunitiesUsed).toBe(1)
  })

  it('中2 GK on the pitch counts towards the 3 中2 on the pitch', () => {
    // 31 is a goalkeeper and a starter; 32, 33 too => 3 on the pitch, a 4th cannot come on
    const s = started([31])
    const r = sub(s, [[1, 34]], 1000)
    expect(r.errors).toEqual(['中2は同時にピッチに3名までです（この交代で4名になります）'])
    // ... but swapping the 中2 goalkeeper for another 中2 keeps it at 3
    expect(sub(s, [[31, 34]], 1000).errors).toEqual([])
  })

  it('a goalkeeper registered as 中2 is counted in the 中2 registration limit like anyone else', () => {
    let s = preMatch([31])
    s = ok(addPlayers(s, 'HOME', '36'))
    expect(setPlayerCategory(s, [id(36)], J2).errors).toEqual(['中2は5名までです'])
  })

  // The strongest check: random substitution histories judged with and without
  // goalkeeper flags give exactly the same answers, step by step.
  it('registering goalkeepers changes NO judgement: same errors, same state, same blocked chips', () => {
    let seed = 20260927
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    const everyone = [...ELEM, ...JH1, ...JH2]
    let steps = 0
    for (let run = 0; run < 40; run++) {
      const gks = everyone.filter(() => rand() < 0.25)
      // half of the runs are played in the second half, half in the first
      const secondHalf = rand() < 0.5
      let plain = secondHalf ? toSecondHalf(started()) : started()
      let withGk = secondHalf ? toSecondHalf(started(gks)) : started(gks)
      for (let i = 0; i < 25; i++) {
        const players = Object.entries(derived(plain).players).filter(([pid]) => pid.startsWith('HOME:'))
        const numbersAt = (location: string) =>
          players.filter(([, p]) => p.location === location).map(([pid]) => Number(pid.split(':')[1]))
        const pitch = numbersAt('pitch')
        const bench = numbersAt('bench')
        if (pitch.length === 0 || bench.length === 0) break
        const pairs: [number, number][] = []
        const usedOut = new Set<number>()
        const usedIn = new Set<number>()
        for (let k = 0, n = 1 + Math.floor(rand() * 3); k < n; k++) {
          const o = pitch[Math.floor(rand() * pitch.length)]
          const inn = bench[Math.floor(rand() * bench.length)]
          if (usedOut.has(o) || usedIn.has(inn)) continue
          usedOut.add(o)
          usedIn.add(inn)
          pairs.push([o, inn])
        }
        if (pairs.length === 0) continue
        const at = 1000 + i * 1000
        const a = sub(plain, pairs, at)
        const b = sub(withGk, pairs, at)
        expect(b.errors).toEqual(a.errors)
        expect(derived(b.state)).toEqual(derived(a.state))
        for (const n of bench) {
          const phase = plain.phase as 'FIRST_HALF' | 'SECOND_HALF'
          expect(describeUnavailability(derived(withGk), withGk.roster, 'HOME', phase, id(n), u13DevelopmentRules)).toBe(
            describeUnavailability(derived(plain), plain.roster, 'HOME', phase, id(n), u13DevelopmentRules),
          )
        }
        plain = a.state
        withGk = b.state
        steps++
      }
    }
    expect(steps).toBeGreaterThan(300)
  })
})

describe('U13 panel line: junior-high count and remaining second-half opportunities', () => {
  const view = (s: AppState) => ({
    counters: derived(s).teamCounters.HOME,
    phase: s.phase as 'FIRST_HALF' | 'HALF_TIME' | 'SECOND_HALF',
    roster: s.roster.filter((p) => p.teamId === 'HOME'),
    teamId: 'HOME' as const,
  })
  const line = (s: AppState) => u13DevelopmentRules.panelSummary(view(s))

  it('first half and half-time: only the count, no second-half remainder', () => {
    let s = started()
    s = ok(sub(s, [[1, 23], [2, 24], [3, 25], [4, 26]], 1000))
    expect(line(s)).toBe('中学生の交代 4/7名')
    s = endFirstHalfPhase(s, 1_800_000)
    expect(line(s)).toBe('中学生の交代 4/7名')
  })

  it('second half: count and remainder on one line, counting down 3 → 2 → 1 → 0', () => {
    let s = started()
    s = ok(sub(s, [[1, 23], [2, 24], [3, 25], [4, 26]], 1000))
    s = toSecondHalf(s)
    expect(line(s)).toBe('中学生の交代 4/7名｜後半 あと3回')
    s = ok(sub(s, [[5, 27]], 2_500_000))
    expect(line(s)).toBe('中学生の交代 5/7名｜後半 あと2回')
    s = ok(sub(s, [[6, 28]], 2_600_000))
    expect(line(s)).toBe('中学生の交代 6/7名｜後半 あと1回')
    s = ok(sub(s, [[21, 7]], 2_700_000)) // elementary IN (for a 中1): unchanged
    expect(line(s)).toBe('中学生の交代 6/7名｜後半 あと1回')
  })

  it('exactly 3 uses → あと0回 (never negative)', () => {
    let s = toSecondHalf(started())
    s = ok(sub(s, [[1, 23]], 2_500_000))
    s = ok(sub(s, [[2, 24]], 2_600_000))
    s = ok(sub(s, [[3, 25]], 2_700_000))
    expect(line(s)).toBe('中学生の交代 3/7名｜後半 あと0回')
  })

  it('elementary-only substitutions and re-entries do not reduce the remainder', () => {
    let s = toSecondHalf(started())
    s = ok(sub(s, [[1, 7], [2, 8]], 2_500_000))
    s = ok(sub(s, [[7, 1]], 2_600_000))
    expect(line(s)).toBe('中学生の交代 0/7名｜後半 あと3回')
  })

  it('a mixed group counts once; many junior-high at once count once', () => {
    let s = toSecondHalf(started())
    s = ok(sub(s, [[1, 7], [2, 23], [3, 24], [4, 25]], 2_500_000))
    expect(line(s)).toBe('中学生の交代 3/7名｜後半 あと2回')
  })

  it('half-time junior-high substitutions do not use second-half opportunities', () => {
    let s = endFirstHalfPhase(started(), 1_800_000)
    s = ok(sub(s, [[1, 23], [2, 24]], 1_800_500))
    s = startSecondHalfPhase(s, 2_400_000)
    expect(line(s)).toBe('中学生の交代 2/7名｜後半 あと3回')
  })

  it('the line is recomputed after a history delete', () => {
    let s = toSecondHalf(started())
    s = ok(sub(s, [[1, 23]], 2_500_000))
    s = ok(sub(s, [[2, 24]], 2_600_000))
    expect(line(s)).toBe('中学生の交代 2/7名｜後半 あと1回')
    s = deleteSubstitutionEvent(s, s.substitutionEvents[0].id)
    expect(line(s)).toBe('中学生の交代 1/7名｜後半 あと2回')
  })

  it('the Saitama panel line keeps its field-tested wording', () => {
    const view2 = {
      counters: { usedSubstituteIds: [], secondHalfOpportunitiesUsed: 1, reentryPlayerIds: [] },
      phase: 'SECOND_HALF' as const,
      roster: [],
      teamId: 'HOME' as const,
    }
    expect(saitamaWomenRules.panelSummary(view2)).toBe('交代 あと2回｜リエントリー 0/3名')
  })
})
