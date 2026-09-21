import { beforeEach, describe, expect, it } from 'vitest'
import {
  archiveFinishedMatch,
  archivedMatchDateMs,
  deleteArchivedMatch,
  formatShortDate,
  isMatchArchived,
  loadArchive,
  saveArchive,
  sortArchive,
  summarizeArchivedMatch,
  toArchivedMatch,
  upsertArchivedMatch,
} from './matchArchive'
import { buildTimeline, deriveScore } from './matchRecord'
import {
  addPlayers,
  confirmDraft,
  createInitialAppState,
  endFirstHalfPhase,
  endMatchPhase,
  getDerivedMatchState,
  recordCard,
  recordGoal,
  setDraftPair,
  setStarter,
  startFirstHalfPhase,
  startSecondHalfPhase,
  updateSettings,
  type AppState,
} from './matchStore'
import { clearMatchState, hasMeaningfulProgress, loadMatchState, saveMatchState } from './persistence'

// The test environment has no browser storage; a tiny in-memory stand-in.
class MemoryStorage {
  private data = new Map<string, string>()
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v))
  }
  removeItem(k: string) {
    this.data.delete(k)
  }
  clear() {
    this.data.clear()
  }
}

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage()
})

const KICKOFF = new Date(2026, 8, 21, 14, 0, 0).getTime() // 2026-09-21 14:00 local

function finishedMatch(opts: { kickoff?: number; home?: string; away?: string; homeGoals?: number; awayGoals?: number } = {}): AppState {
  const kickoff = opts.kickoff ?? KICKOFF
  let s = createInitialAppState()
  s = updateSettings(s, { homeTeamName: opts.home ?? '', awayTeamName: opts.away ?? '' })
  s = addPlayers(s, 'HOME', '1,2,3,4,5,6,7,8,9,10,11,12').state
  s = addPlayers(s, 'AWAY', '1,2,3,4,5,6,7,8,9,10,11').state
  for (const p of s.roster.filter((p) => p.number <= 11)) s = setStarter(s, p.id, true).state
  s = startFirstHalfPhase(s, kickoff)
  for (let i = 0; i < (opts.homeGoals ?? 0); i++) s = recordGoal(s, { teamId: 'HOME', scorerNumber: 10, ownGoal: false, ownGoalByNumber: null }, 'FIRST_HALF', 60_000 * (i + 1))
  for (let i = 0; i < (opts.awayGoals ?? 0); i++) s = recordGoal(s, { teamId: 'AWAY', scorerNumber: null, ownGoal: false, ownGoalByNumber: null }, 'SECOND_HALF', 60_000 * (i + 1))
  s = recordCard(s, { teamId: 'HOME', card: 'YELLOW', targetType: 'PLAYER', playerNumber: 6, officialRole: null, officialName: '' }, 'FIRST_HALF', 120_000)
  s = setDraftPair(s, 'HOME', 0, 'out', 'HOME:10')
  s = setDraftPair(s, 'HOME', 0, 'in', 'HOME:12')
  s = confirmDraft(s, 'HOME', kickoff + 300_000).state
  s = endFirstHalfPhase(s, kickoff + 1_800_000)
  s = startSecondHalfPhase(s, kickoff + 2_400_000)
  return endMatchPhase(s, kickoff + 4_200_000)
}

describe('saving a finished match', () => {
  it('a finished match is archived; a match that has not finished is not', () => {
    const done = finishedMatch({ homeGoals: 2, awayGoals: 1 })
    expect(archiveFinishedMatch(done)).toBe(true)
    expect(loadArchive()).toHaveLength(1)

    let inProgress = createInitialAppState()
    inProgress = addPlayers(inProgress, 'HOME', '1,2,3,4,5,6,7').state
    for (const p of inProgress.roster) inProgress = setStarter(inProgress, p.id, true).state
    inProgress = startFirstHalfPhase(inProgress, KICKOFF)
    expect(archiveFinishedMatch(inProgress)).toBe(false)
    expect(loadArchive()).toHaveLength(1)
  })

  it('saving the same finished match again does not create a duplicate', () => {
    const done = finishedMatch()
    for (let i = 0; i < 5; i++) archiveFinishedMatch(done)
    expect(loadArchive()).toHaveLength(1)
  })

  it('a correction made after full time updates the same entry instead of drifting or duplicating', () => {
    const done = finishedMatch({ homeGoals: 1 })
    archiveFinishedMatch(done)
    expect(summarizeArchivedMatch(loadArchive()[0])).toMatchObject({ homeScore: 1, awayScore: 0 })

    const corrected = recordGoal(done, { teamId: 'AWAY', scorerNumber: 9, ownGoal: false, ownGoalByNumber: null }, 'SECOND_HALF', 5_000)
    archiveFinishedMatch(corrected)
    const list = loadArchive()
    expect(list).toHaveLength(1)
    expect(summarizeArchivedMatch(list[0])).toMatchObject({ homeScore: 1, awayScore: 1 })
  })

  it('starting a new match does not remove the finished one; several matches accumulate', () => {
    const a = finishedMatch({ kickoff: new Date(2026, 8, 7, 10).getTime(), homeGoals: 3, awayGoals: 2 })
    const b = finishedMatch({ kickoff: new Date(2026, 8, 14, 10).getTime() })
    const c = finishedMatch({ kickoff: new Date(2026, 8, 21, 10).getTime(), homeGoals: 2, awayGoals: 1 })
    expect(new Set([a.matchId, b.matchId, c.matchId]).size).toBe(3)
    for (const m of [a, b, c]) {
      archiveFinishedMatch(m)
      // "新しい試合を始める": the working slot is replaced by a fresh match
      saveMatchState(m)
      clearMatchState()
      saveMatchState(createInitialAppState())
    }
    const list = sortArchive(loadArchive())
    expect(list.map((e) => formatShortDate(archivedMatchDateMs(e)))).toEqual(['9/21', '9/14', '9/7'])
    expect(list.map((e) => e.id)).toEqual([c.matchId, b.matchId, a.matchId])
  })

  it('survives a reload (data is read back from storage as it was saved)', () => {
    const done = finishedMatch({ home: 'TEAM A', away: 'TEAM B', homeGoals: 1 })
    archiveFinishedMatch(done)
    const first = loadArchive()
    expect(loadArchive()).toEqual(first)
    expect(summarizeArchivedMatch(first[0])).toMatchObject({ homeName: 'TEAM A', awayName: 'TEAM B' })
  })
})

describe('what a past match shows', () => {
  it('uses HOME / AWAY when team names are not set, and the final score including own goals', () => {
    let done = finishedMatch({ homeGoals: 2, awayGoals: 1 })
    done = recordGoal(done, { teamId: 'AWAY', scorerNumber: null, ownGoal: true, ownGoalByNumber: 4 }, 'SECOND_HALF', 9_000) // own goal credited to AWAY
    const s = summarizeArchivedMatch(toArchivedMatch(done, 1))
    expect(s).toMatchObject({ homeName: 'HOME', awayName: 'AWAY', homeScore: 2, awayScore: 2 })
  })

  it('the date is the kickoff day', () => {
    const s = summarizeArchivedMatch(toArchivedMatch(finishedMatch(), 999))
    expect(formatShortDate(s.dateMs)).toBe('9/21')
  })

  it('score, goals, cards, substitutions and the timeline read back identically to the live match', () => {
    const done = finishedMatch({ homeGoals: 2, awayGoals: 1 })
    archiveFinishedMatch(done)
    const { match } = loadArchive()[0]
    expect(deriveScore(match.goalEvents)).toEqual(deriveScore(done.goalEvents))
    expect(match.cardEvents).toEqual(done.cardEvents)
    expect(match.substitutionEvents).toEqual(done.substitutionEvents)
    const timeline = (m: typeof match) =>
      buildTimeline({
        substitutionEvents: m.substitutionEvents,
        goalEvents: m.goalEvents,
        cardEvents: m.cardEvents,
        clock: m.clock,
        hydrationCompletionElapsedMsByHalf: m.hydrationCompletionElapsedMsByHalf,
      }).map((e) => e.key)
    expect(timeline(match)).toEqual(timeline(done))
    // the engine can still replay the archived log (a future share/PDF step can rely on it)
    expect(getDerivedMatchState({ ...done, ...match }).state.players['HOME:12'].location).toBe('pitch')
  })
})

describe('deleting', () => {
  it('removes only the chosen match', () => {
    const a = finishedMatch({ kickoff: new Date(2026, 8, 7, 10).getTime() })
    const b = finishedMatch({ kickoff: new Date(2026, 8, 14, 10).getTime() })
    archiveFinishedMatch(a)
    archiveFinishedMatch(b)
    expect(deleteArchivedMatch(a.matchId)).toBe(true)
    expect(loadArchive().map((e) => e.id)).toEqual([b.matchId])
    expect(isMatchArchived(a.matchId)).toBe(false)
    expect(isMatchArchived(b.matchId)).toBe(true)
  })

  it('cancelling (doing nothing) leaves everything; deleting an unknown id changes nothing', () => {
    const a = finishedMatch()
    archiveFinishedMatch(a)
    deleteArchivedMatch('unknown')
    expect(loadArchive()).toHaveLength(1)
  })
})

describe('the live match is independent of the archive', () => {
  it('archiving never changes the match state or the saved working slot', () => {
    const done = finishedMatch({ homeGoals: 1 })
    const before = JSON.stringify(done)
    saveMatchState(done)
    archiveFinishedMatch(done)
    deleteArchivedMatch(done.matchId)
    expect(JSON.stringify(done)).toBe(before)
    expect(loadMatchState()?.matchId).toBe(done.matchId) // the working slot is untouched
  })

  it('upsert is pure', () => {
    const e = toArchivedMatch(finishedMatch(), 1)
    const list = [e]
    const next = upsertArchivedMatch(list, { ...e, savedAt: 2 })
    expect(list[0].savedAt).toBe(1)
    expect(next).toHaveLength(1)
    expect(next[0].savedAt).toBe(2)
  })
})

describe('matches saved before the archive existed', () => {
  function legacyJson(state: AppState) {
    const { matchId: _omit, ...rest } = state
    void _omit
    return JSON.stringify(rest)
  }

  it('get a stable id from the kickoff time, so the same finished match is never archived twice', () => {
    const done = finishedMatch()
    localStorage.setItem('fourth-official-app:match:v1', legacyJson(done))
    const first = loadMatchState()!
    const second = loadMatchState()!
    expect(first.matchId).toBe(`legacy-${KICKOFF}`)
    expect(second.matchId).toBe(first.matchId)
    archiveFinishedMatch(first)
    archiveFinishedMatch(second)
    expect(loadArchive()).toHaveLength(1)
    expect(first.phase).toBe('FULL_TIME') // nothing else about the match was changed
    expect(first.goalEvents).toEqual(done.goalEvents)
  })

  it('a not-yet-started legacy match gets some non-empty id', () => {
    const blank = createInitialAppState()
    localStorage.setItem('fourth-official-app:match:v1', legacyJson(blank))
    expect(loadMatchState()!.matchId).toMatch(/\S/)
  })

  it('keeps an existing id unchanged', () => {
    const done = finishedMatch()
    saveMatchState(done)
    expect(loadMatchState()!.matchId).toBe(done.matchId)
  })
})

describe('unreadable archive data', () => {
  it('does not crash, and keeps a copy of what it could not read', () => {
    localStorage.setItem('fourth-official-app:archive:v1', '{not json')
    expect(loadArchive()).toEqual([])
    expect(localStorage.getItem('fourth-official-app:archive:v1:unreadable-backup')).toBe('{not json')
  })

  it('skips broken entries but keeps the good ones (and a backup of the original)', () => {
    const good = toArchivedMatch(finishedMatch(), 1)
    const raw = JSON.stringify([good, { id: 'x' }, 5])
    localStorage.setItem('fourth-official-app:archive:v1', raw)
    expect(loadArchive().map((e) => e.id)).toEqual([good.id])
    expect(localStorage.getItem('fourth-official-app:archive:v1:unreadable-backup')).toBe(raw)
  })

  it('an empty / missing archive is just empty', () => {
    expect(loadArchive()).toEqual([])
    expect(saveArchive([])).toBe(true)
    expect(loadArchive()).toEqual([])
  })
})

describe('hasMeaningfulProgress', () => {
  it('a blank pre-match screen is not worth asking about; registered players or a started match are', () => {
    const blank = createInitialAppState()
    expect(hasMeaningfulProgress(blank)).toBe(false)
    expect(hasMeaningfulProgress(addPlayers(blank, 'HOME', '1').state)).toBe(true)
    expect(hasMeaningfulProgress(finishedMatch())).toBe(true)
  })
})
