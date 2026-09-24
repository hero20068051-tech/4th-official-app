// The Saitama women's league rule set must behave EXACTLY like the engine that
// was field-tested (frozen in ../stableOracle, copied from git tag
// stable-saitama-women-2026-09-24). This runs thousands of random match
// histories — legal and illegal substitutions, all phases, GK flags, re-entry
// attempts, cap overruns — through both and demands identical results.
import { describe, expect, it } from 'vitest'
import { describeUnavailability, replayMatch, validateSubstitutionEvent } from '../engine'
import { pendingConfirmationReentryPolicy as oraclePolicy } from '../stableOracle/reentryPolicy'
import {
  describeUnavailability as oracleDescribe,
  replayMatch as oracleReplay,
  validateSubstitutionEvent as oracleValidate,
} from '../stableOracle/engine'
import type { Player, SubstitutionEvent, SubstitutionPair, SubstitutionPhase, TeamId } from '../types'
import { saitamaWomenRules } from './saitamaWomen'

// small deterministic PRNG
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeRoster(rand: () => number): Player[] {
  const roster: Player[] = []
  for (const teamId of ['HOME', 'AWAY'] as TeamId[]) {
    const size = 12 + Math.floor(rand() * 9) // 12..20
    const numbers = new Set<number>()
    while (numbers.size < size) numbers.add(1 + Math.floor(rand() * 99))
    const list = [...numbers].sort((a, b) => a - b)
    const starterCount = 7 + Math.floor(rand() * 5) // 7..11
    const starters = new Set<number>()
    while (starters.size < Math.min(starterCount, size)) starters.add(list[Math.floor(rand() * list.length)])
    for (const n of list) {
      roster.push({
        id: `${teamId}:${n}`,
        teamId,
        number: n,
        isStarter: starters.has(n),
        isRegisteredGK: rand() < 0.15,
      })
    }
  }
  return roster
}

const PHASES: SubstitutionPhase[] = ['FIRST_HALF', 'HALF_TIME', 'SECOND_HALF']

function randomPairs(rand: () => number, roster: Player[], teamId: TeamId, pitch: string[], bench: string[]): SubstitutionPair[] {
  const teamIds = roster.filter((p) => p.teamId === teamId).map((p) => p.id)
  const pick = (from: string[]) => from[Math.floor(rand() * from.length)]
  const n = 1 + Math.floor(rand() * 4)
  const pairs: SubstitutionPair[] = []
  for (let i = 0; i < n; i++) {
    // mostly sensible pairs, sometimes anything at all (illegal ones must be rejected identically)
    const sensible = rand() < 0.8
    const out = sensible && pitch.length ? pick(pitch) : pick(teamIds)
    const inn = sensible && bench.length ? pick(bench) : pick(teamIds)
    pairs.push({ outPlayerId: out, inPlayerId: inn })
  }
  return pairs
}

const stats = { applied: 0, rejected: 0, reentries: 0, secondHalfUsed: 0, nineCap: 0, reentryCap: 0, secondHalfCap: 0, unlockBlocked: 0, comparisons: 0 }

describe('Saitama women rule set == stable engine', () => {
  it('replay results are identical over many random match histories', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const rand = rng(seed)
      const roster = makeRoster(rand)
      const events: SubstitutionEvent[] = []
      let phaseIdx = 0
      const eventCount = 4 + Math.floor(rand() * 14)
      for (let i = 0; i < eventCount; i++) {
        if (rand() < 0.25 && phaseIdx < 2) phaseIdx++
        const teamId: TeamId = rand() < 0.5 ? 'HOME' : 'AWAY'
        const before = oracleReplay(roster, events, oraclePolicy).state
        const teamPlayers = roster.filter((p) => p.teamId === teamId)
        const pitch = teamPlayers.filter((p) => before.players[p.id].location === 'pitch').map((p) => p.id)
        const bench = teamPlayers.filter((p) => before.players[p.id].location === 'bench').map((p) => p.id)
        const pairs = randomPairs(rand, roster, teamId, pitch, bench)
        const phase = PHASES[phaseIdx]
        const event: SubstitutionEvent = { id: `e${i}`, phase, elapsedMs: i * 1000, teamGroups: [{ teamId, pairs }], stoppageGroupId: null }

        // 1) validation of this candidate event agrees, message for message
        const a = validateSubstitutionEvent(before, roster, event, saitamaWomenRules)
        const b = oracleValidate(before, roster, event, oraclePolicy)
        expect(a).toEqual(b)
        stats.comparisons++
        if (b.errors.length) {
          stats.rejected++
          for (const m of b.errors) {
            if (m.includes('9名')) stats.nineCap++
            if (m.includes('3名まで')) stats.reentryCap++
            if (m.includes('後半の交代は終了')) stats.secondHalfCap++
            if (m.includes('まだ出場していない')) stats.unlockBlocked++
          }
        } else stats.applied++

        // 2) "why can't this bench player come on" agrees for every bench player, with and without a half-built group
        for (const id of bench) {
          const others = randomPairs(rand, roster, teamId, pitch, bench).slice(0, Math.floor(rand() * 3))
          for (const ph of PHASES) {
            expect(describeUnavailability(before, roster, teamId, ph, id, saitamaWomenRules, others)).toBe(
              oracleDescribe(before, roster, teamId, ph, id, oraclePolicy, others),
            )
            stats.comparisons++
          }
        }

        events.push(event)
        // 3) the full replay (state, counters, NEEDS_REVIEW list) agrees after every event
        const na = replayMatch(roster, events, saitamaWomenRules)
        const nb = oracleReplay(roster, events, oraclePolicy)
        expect(na).toEqual(nb)
        stats.comparisons++
      }
      const final = oracleReplay(roster, events, oraclePolicy).state
      for (const p of Object.values(final.players)) if (p.reentryCount > 0) stats.reentries++
      for (const c of Object.values(final.teamCounters)) stats.secondHalfUsed += c.secondHalfOpportunitiesUsed
    }
  })

  it('the random histories really exercised the rules (re-entry, all three caps, unlock condition, rejections)', () => {
    expect(stats.comparisons).toBeGreaterThan(20000)
    expect(stats.applied).toBeGreaterThan(200)
    expect(stats.rejected).toBeGreaterThan(200)
    expect(stats.reentries).toBeGreaterThan(20)
    expect(stats.secondHalfUsed).toBeGreaterThan(100)
    expect(stats.secondHalfCap).toBeGreaterThan(0)
    expect(stats.unlockBlocked).toBeGreaterThan(0)
    expect(stats.reentryCap).toBeGreaterThan(0)
    // caps that are hard to reach randomly are covered by the deterministic suites; report what we saw
    console.info('differential stats', JSON.stringify(stats))
  })
})

describe('the nine-substitute cap (too rare for random histories) is identical too', () => {
  it('a 20-player squad with 7 starters: the 10th distinct substitute is refused by both, message for message', () => {
    const roster: Player[] = Array.from({ length: 20 }, (_, i) => ({
      id: `HOME:${i + 1}`, teamId: 'HOME' as const, number: i + 1, isStarter: i < 7, isRegisteredGK: false,
    }))
    const events: SubstitutionEvent[] = []
    let refusedWithNineMessage = 0
    for (let k = 0; k < 13; k++) {
      const before = oracleReplay(roster, events, oraclePolicy).state
      const out = roster.find((p) => before.players[p.id].location === 'pitch')!
      const inn = roster.filter((p) => before.players[p.id].location === 'bench' && !before.players[p.id].hasAppeared)[0]
      const event: SubstitutionEvent = {
        id: `n${k}`, phase: 'FIRST_HALF', elapsedMs: k, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: out.id, inPlayerId: inn.id }] }], stoppageGroupId: null,
      }
      const a = validateSubstitutionEvent(before, roster, event, saitamaWomenRules)
      const b = oracleValidate(before, roster, event, oraclePolicy)
      expect(a).toEqual(b)
      if (b.errors.includes('使用できる交代要員は9名までです')) refusedWithNineMessage++
      events.push(event)
      expect(replayMatch(roster, events, saitamaWomenRules)).toEqual(oracleReplay(roster, events, oraclePolicy))
    }
    expect(refusedWithNineMessage).toBeGreaterThan(0)
  })
})
