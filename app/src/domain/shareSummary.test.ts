import { describe, expect, it } from 'vitest'
import { toArchivedMatch, type ArchivedMatch } from './matchArchive'
import {
  addPlayers,
  createInitialAppState,
  deleteGoalEvent,
  endFirstHalfPhase,
  endMatchPhase,
  recordCard,
  recordGoal,
  setStarter,
  startFirstHalfPhase,
  startSecondHalfPhase,
  updateGoalEvent,
  updateSettings,
  type AppState,
} from './matchStore'
import { archivedNeedsReview, buildShareSummary, formatShareDate, shareFileName } from './shareSummary'

const KICKOFF = new Date(2026, 8, 24, 14, 0, 0).getTime()
const min = (m: number, s = 0) => (m * 60 + s) * 1000

function base(names?: { home?: string; away?: string }): AppState {
  let s = createInitialAppState()
  s = updateSettings(s, { homeTeamName: names?.home ?? '', awayTeamName: names?.away ?? '' })
  s = addPlayers(s, 'HOME', '1,2,3,4,5,6,7,8,9,10,11,12').state
  s = addPlayers(s, 'AWAY', '1,2,3,4,5,6,7,8,9,10,11').state
  for (const p of s.roster.filter((p) => p.number <= 11)) s = setStarter(s, p.id, true).state
  return startFirstHalfPhase(s, KICKOFF)
}
function finish(s: AppState): AppState {
  s = endFirstHalfPhase(s, KICKOFF + 1_800_000)
  s = startSecondHalfPhase(s, KICKOFF + 2_400_000)
  return endMatchPhase(s, KICKOFF + 4_200_000)
}
const goal = (team: 'HOME' | 'AWAY', scorer: number | null, extra: Partial<{ ownGoal: boolean; ownGoalByNumber: number | null }> = {}) => ({
  teamId: team,
  scorerNumber: scorer,
  ownGoal: extra.ownGoal ?? false,
  ownGoalByNumber: extra.ownGoalByNumber ?? null,
})
const entryOf = (s: AppState): ArchivedMatch => toArchivedMatch(finish(s), 1)
const yellow = (team: 'HOME' | 'AWAY', n: number) => ({ teamId: team, card: 'YELLOW' as const, targetType: 'PLAYER' as const, playerNumber: n, officialRole: null, officialName: '' })

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v)
    Object.freeze(o)
  }
  return o
}

describe('basics', () => {
  it('title, date (kickoff day, YYYY.MM.DD), names and final score', () => {
    let s = base({ home: 'TEAM A', away: 'TEAM B' })
    s = recordGoal(s, goal('HOME', 10), 'FIRST_HALF', min(12, 35))
    s = recordGoal(s, goal('HOME', 14), 'SECOND_HALF', min(24, 10))
    s = recordGoal(s, goal('AWAY', 7), 'SECOND_HALF', min(8, 20))
    const sum = buildShareSummary(entryOf(s))
    expect(sum).toMatchObject({ title: '試合結果', dateLabel: '2026.09.24', homeName: 'TEAM A', awayName: 'TEAM B', homeScore: 2, awayScore: 1 })
    expect(formatShareDate(new Date(2026, 0, 5).getTime())).toBe('2026.01.05')
  })

  it('unset team names read HOME / AWAY (and need no extra caption)', () => {
    const sum = buildShareSummary(entryOf(base()))
    expect(sum).toMatchObject({ homeName: 'HOME', awayName: 'AWAY', homeCaption: null, awayCaption: null })
  })

  it('custom names keep a small HOME / AWAY caption so the sides stay clear', () => {
    const sum = buildShareSummary(entryOf(base({ home: 'いちご', away: '' })))
    expect(sum).toMatchObject({ homeCaption: 'HOME', awayCaption: null })
  })

  it('a 0-0 match with nothing recorded has empty lists', () => {
    const sum = buildShareSummary(entryOf(base()))
    expect(sum).toMatchObject({ homeScore: 0, awayScore: 0, goals: [], cards: [] })
  })

  it('file name carries the date', () => {
    expect(shareFileName(entryOf(base()))).toBe('試合結果_20260924.png')
  })
})

describe('goals', () => {
  it('several goals in match order, with first / second half labels', () => {
    let s = base()
    s = recordGoal(s, goal('HOME', 14), 'SECOND_HALF', min(24, 10))
    s = recordGoal(s, goal('AWAY', 7), 'SECOND_HALF', min(8, 20))
    s = recordGoal(s, goal('HOME', 10), 'FIRST_HALF', min(12, 35))
    const sum = buildShareSummary(entryOf(s))
    expect(sum.goals.map((g) => [g.moment, g.text])).toEqual([
      ['前半 12:35', 'HOME　#10'],
      ['後半 08:20', 'AWAY　#7'],
      ['後半 24:10', 'HOME　#14'],
    ])
  })

  it('an unconfirmed scorer is shown honestly, not guessed', () => {
    const s = recordGoal(base(), goal('HOME', null), 'SECOND_HALF', min(12, 10))
    const sum = buildShareSummary(entryOf(s))
    expect(sum.goals).toEqual([{ moment: '後半 12:10', teamId: 'HOME', text: 'HOME　得点者未確認' }])
    expect(sum.homeScore).toBe(1)
  })

  it('an own goal names the team it counts for and, if known, the opposing player', () => {
    let s = recordGoal(base(), goal('HOME', null, { ownGoal: true, ownGoalByNumber: 5 }), 'FIRST_HALF', min(20, 5))
    s = recordGoal(s, goal('AWAY', null, { ownGoal: true, ownGoalByNumber: null }), 'SECOND_HALF', min(3))
    const sum = buildShareSummary(entryOf(s))
    expect(sum.goals.map((g) => g.text)).toEqual(['HOME　オウンゴール（AWAY #5）', 'AWAY　オウンゴール'])
    expect(sum).toMatchObject({ homeScore: 1, awayScore: 1 })
  })

  it('a corrected goal time is used, and the goal moves to its new place', () => {
    let s = recordGoal(base(), goal('HOME', 10), 'FIRST_HALF', min(13, 10))
    s = recordGoal(s, goal('AWAY', 3), 'FIRST_HALF', min(12, 50))
    s = updateGoalEvent(s, s.goalEvents[0].id, goal('HOME', 10), { phase: 'FIRST_HALF', elapsedMs: min(12, 35) })
    const sum = buildShareSummary(entryOf(s))
    expect(sum.goals.map((g) => g.moment)).toEqual(['前半 12:35', '前半 12:50'])
  })

  it('a goal cancelled before archiving is simply not there (score follows)', () => {
    let s = recordGoal(base(), goal('HOME', 10), 'FIRST_HALF', min(5))
    s = recordGoal(s, goal('HOME', 9), 'FIRST_HALF', min(6))
    s = deleteGoalEvent(s, s.goalEvents[1].id)
    const sum = buildShareSummary(entryOf(s))
    expect(sum.goals).toHaveLength(1)
    expect(sum.homeScore).toBe(1)
  })
})

describe('cards', () => {
  it('yellow and red are named in words, for players, with the second yellow marked', () => {
    let s = recordCard(base(), yellow('AWAY', 6), 'SECOND_HALF', min(15, 40))
    s = recordCard(s, yellow('AWAY', 6), 'SECOND_HALF', min(30))
    s = recordCard(s, { ...yellow('HOME', 9), card: 'RED' }, 'FIRST_HALF', min(20))
    const sum = buildShareSummary(entryOf(s))
    expect(sum.cards.map((c) => [c.moment, c.kind, c.text])).toEqual([
      ['前半 20:00', 'RED', 'HOME　#9　レッドカード'],
      ['後半 15:40', 'YELLOW', 'AWAY　#6　イエローカード'],
      ['後半 30:00', 'YELLOW', 'AWAY　#6　イエローカード（2枚目）'],
    ])
  })

  it('a team official is shown by role; the typed name is not put on the picture', () => {
    const s = recordCard(
      base(),
      { teamId: 'HOME', card: 'YELLOW', targetType: 'OFFICIAL', playerNumber: null, officialRole: 'MANAGER', officialName: '山田太郎' },
      'SECOND_HALF',
      min(4),
    )
    const sum = buildShareSummary(entryOf(s))
    expect(sum.cards[0].text).toBe('HOME　監督　イエローカード')
    expect(JSON.stringify(sum)).not.toContain('山田')
  })

  it('no cards -> empty list', () => {
    expect(buildShareSummary(entryOf(base())).cards).toEqual([])
  })
})

describe('what is deliberately left out', () => {
  it('only the agreed fields exist: no substitutions, timeline, re-entry, hydration or counts', () => {
    const sum = buildShareSummary(entryOf(base()))
    expect(Object.keys(sum).sort()).toEqual(
      ['awayCaption', 'awayName', 'awayScore', 'cards', 'dateLabel', 'goals', 'homeCaption', 'homeName', 'homeScore', 'title'].sort(),
    )
  })
})

describe('NEEDS_REVIEW', () => {
  it('a clean archived match has none, and an unconfirmed scorer is not an inconsistency', () => {
    const s = recordGoal(base(), goal('HOME', null), 'FIRST_HALF', min(3))
    expect(archivedNeedsReview(entryOf(s))).toEqual([])
  })

  it('an archived substitution that cannot replay legally is reported (existing rule, not a new one)', () => {
    const entry = entryOf(base())
    const bad: ArchivedMatch = {
      ...entry,
      match: {
        ...entry.match,
        substitutionEvents: [
          { id: 'bad', phase: 'FIRST_HALF', elapsedMs: 1000, teamGroups: [{ teamId: 'HOME', pairs: [{ outPlayerId: 'HOME:12', inPlayerId: 'HOME:11' }] }], stoppageGroupId: null },
        ],
      },
    }
    expect(archivedNeedsReview(bad).map((i) => i.eventId)).toEqual(['bad'])
  })
})

describe('read-only', () => {
  it('building a summary from a deeply frozen archive entry works and changes nothing', () => {
    let s = recordGoal(base({ home: 'A', away: 'B' }), goal('HOME', 10), 'FIRST_HALF', min(1))
    s = recordCard(s, yellow('AWAY', 4), 'SECOND_HALF', min(2))
    const entry = entryOf(s)
    const before = JSON.stringify(entry)
    deepFreeze(entry)
    expect(() => {
      buildShareSummary(entry)
      archivedNeedsReview(entry)
      shareFileName(entry)
    }).not.toThrow()
    expect(JSON.stringify(entry)).toBe(before)
  })
})
