import { beforeEach, describe, expect, it } from 'vitest'
import { loadArchive, toArchivedMatch, saveArchive, archiveFinishedMatch } from '../matchArchive'
import {
  addPlayers,
  confirmDraft,
  createInitialAppState,
  endFirstHalfPhase,
  endMatchPhase,
  getDerivedMatchState,
  recordGoal,
  setDraftPair,
  setStarter,
  startFirstHalfPhase,
  startSecondHalfPhase,
  type AppState,
} from '../matchStore'
import { loadMatchState } from '../persistence'
import { archivedNeedsReview, buildShareSummary } from '../shareSummary'
import { DEFAULT_RULESET_ID, getRuleSet, ruleSetOf } from './index'
import { saitamaWomenRules } from './saitamaWomen'

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null }
  setItem(k: string, v: string) { this.data.set(k, String(v)) }
  removeItem(k: string) { this.data.delete(k) }
}
beforeEach(() => {
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()
})

function playedMatch(): AppState {
  let s = createInitialAppState()
  s = addPlayers(s, 'HOME', '1,2,3,4,5,6,7,8,9,10,11,12,13').state
  s = addPlayers(s, 'AWAY', '1,2,3,4,5,6,7,8,9,10,11').state
  for (const p of s.roster.filter((p) => p.number <= 11)) s = setStarter(s, p.id, true).state
  s = startFirstHalfPhase(s, 1_000_000)
  s = recordGoal(s, { teamId: 'HOME', scorerNumber: 10, ownGoal: false, ownGoalByNumber: null }, 'FIRST_HALF', 60_000)
  s = setDraftPair(s, 'HOME', 0, 'out', 'HOME:10')
  s = setDraftPair(s, 'HOME', 0, 'in', 'HOME:12')
  s = confirmDraft(s, 'HOME', 1_300_000).state
  s = endFirstHalfPhase(s, 2_800_000)
  s = startSecondHalfPhase(s, 3_400_000)
  return endMatchPhase(s, 5_200_000)
}

// what the app saved before rule sets existed: the same thing without the new field
function asSavedBeforeRuleSets(state: AppState): string {
  const clone = JSON.parse(JSON.stringify(state))
  delete clone.settings.rulesetId
  return JSON.stringify(clone)
}

describe('choosing the rules', () => {
  it('a match with no rule set (saved before they existed) plays under the Saitama women\'s league', () => {
    expect(ruleSetOf({})).toBe(saitamaWomenRules)
    expect(DEFAULT_RULESET_ID).toBe('saitama-women')
  })
  it('an id this version does not know also falls back safely (never throws, never picks something else)', () => {
    for (const id of ['unknown', 'toString', '__proto__', '']) expect(ruleSetOf({ rulesetId: id })).toBe(saitamaWomenRules)
  })
  it('a new match records its rule set explicitly', () => {
    expect(createInitialAppState().settings.rulesetId).toBe('saitama-women')
    expect(getRuleSet('saitama-women').name).toBe('埼玉県女子リーグ')
  })
})

describe('data saved before rule sets existed', () => {
  it('an in-progress / finished match loads unchanged and replays exactly as before', () => {
    const current = playedMatch()
    localStorage.setItem('fourth-official-app:match:v1', asSavedBeforeRuleSets(current))
    const loaded = loadMatchState()!
    expect(loaded.settings.rulesetId).toBeUndefined() // nothing is rewritten on load
    expect(getDerivedMatchState(loaded)).toEqual(getDerivedMatchState(current))
    expect(loaded.goalEvents).toEqual(current.goalEvents)
    expect(loaded.substitutionEvents).toEqual(current.substitutionEvents)
  })

  it('an archived past match without a rule set still opens, shares, and passes the review check', () => {
    const current = playedMatch()
    const entry = toArchivedMatch(current, 1)
    const old = JSON.parse(JSON.stringify(entry))
    delete old.match.settings.rulesetId
    saveArchive([old])
    const [loaded] = loadArchive()
    expect(loaded.match.settings.rulesetId).toBeUndefined()
    expect(archivedNeedsReview(loaded)).toEqual([])
    expect(buildShareSummary(loaded)).toEqual(buildShareSummary(entry))
  })

  it('archiving a legacy finished match keeps working and does not add a rule set to the stored copy of the old one', () => {
    const current = playedMatch()
    const legacy = JSON.parse(asSavedBeforeRuleSets(current)) as AppState
    expect(archiveFinishedMatch(legacy)).toBe(true)
    expect(loadArchive()[0].match.settings.rulesetId).toBeUndefined()
  })
})
