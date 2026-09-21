import { deriveScore } from './matchRecord'
import { displayTeamName } from './matchSetup'
import type { AppState } from './matchStore'

// Past matches (Phase 2.4). This module only *stores and reads* finished
// matches; it never touches the substitution engine, replay, clock or any
// rule. A finished match is kept as the data the app already has (roster +
// event logs + clock + settings), so score, goals, cards, substitutions and
// the timeline are always derived from it exactly the way the live screen
// derives them — nothing is stored twice, so nothing can drift.

const ARCHIVE_KEY = 'fourth-official-app:archive:v1'

export type FinishedMatchData = Pick<
  AppState,
  | 'settings'
  | 'roster'
  | 'clock'
  | 'substitutionEvents'
  | 'goalEvents'
  | 'cardEvents'
  | 'hydrationCompletedByHalf'
  | 'hydrationCompletionElapsedMsByHalf'
>

export interface ArchivedMatch {
  archiveVersion: 1
  id: string // = AppState.matchId
  savedAt: number
  match: FinishedMatchData
}

export function toArchivedMatch(state: AppState, now: number): ArchivedMatch {
  return {
    archiveVersion: 1,
    id: state.matchId,
    savedAt: now,
    match: {
      settings: state.settings,
      roster: state.roster,
      clock: state.clock,
      substitutionEvents: state.substitutionEvents,
      goalEvents: state.goalEvents,
      cardEvents: state.cardEvents,
      hydrationCompletedByHalf: state.hydrationCompletedByHalf,
      hydrationCompletionElapsedMsByHalf: state.hydrationCompletionElapsedMsByHalf,
    },
  }
}

// Same id replaces the entry in place (idempotent: finishing/reopening/
// correcting the same match never creates a second one).
export function upsertArchivedMatch(list: ArchivedMatch[], entry: ArchivedMatch): ArchivedMatch[] {
  const at = list.findIndex((e) => e.id === entry.id)
  if (at === -1) return [...list, entry]
  return list.map((e, i) => (i === at ? entry : e))
}

export function removeArchivedMatch(list: ArchivedMatch[], id: string): ArchivedMatch[] {
  return list.filter((e) => e.id !== id)
}

// The match's own date: kickoff, else the final whistle, else when it was saved.
export function archivedMatchDateMs(entry: ArchivedMatch): number {
  const { clock } = entry.match
  return clock.firstHalfStartedAt ?? clock.secondHalfEndedAt ?? entry.savedAt
}

// Newest match first.
export function sortArchive(list: ArchivedMatch[]): ArchivedMatch[] {
  return [...list].sort((a, b) => archivedMatchDateMs(b) - archivedMatchDateMs(a) || b.savedAt - a.savedAt)
}

export interface ArchivedMatchSummary {
  id: string
  dateMs: number
  homeName: string
  awayName: string
  homeScore: number
  awayScore: number
}

export function summarizeArchivedMatch(entry: ArchivedMatch): ArchivedMatchSummary {
  const score = deriveScore(entry.match.goalEvents)
  return {
    id: entry.id,
    dateMs: archivedMatchDateMs(entry),
    homeName: displayTeamName(entry.match.settings.homeTeamName, 'HOME'),
    awayName: displayTeamName(entry.match.settings.awayTeamName, 'AWAY'),
    homeScore: score.HOME,
    awayScore: score.AWAY,
  }
}

// "9/21"
export function formatShortDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// "2026年9月21日（日）"
export function formatLongDate(ms: number): string {
  const d = new Date(ms)
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${weekday}）`
}

function isValidEntry(e: unknown): e is ArchivedMatch {
  if (!e || typeof e !== 'object') return false
  const x = e as Partial<ArchivedMatch>
  const m = x.match as Partial<FinishedMatchData> | undefined
  return (
    typeof x.id === 'string' &&
    x.id !== '' &&
    typeof x.savedAt === 'number' &&
    !!m &&
    typeof m === 'object' &&
    !!m.settings &&
    Array.isArray(m.roster) &&
    !!m.clock &&
    Array.isArray(m.substitutionEvents) &&
    Array.isArray(m.goalEvents) &&
    Array.isArray(m.cardEvents)
  )
}

// --- localStorage (same mechanism as the live match; a separate key) ---

// If what is stored cannot be fully read, keep a copy of the raw text before
// anything can overwrite it (a later save would otherwise silently discard
// the unreadable entries).
function backUpUnreadable(raw: string): void {
  try {
    localStorage.setItem(`${ARCHIVE_KEY}:unreadable-backup`, raw)
  } catch {
    // Nothing more can be done if storage refuses the write.
  }
}

export function loadArchive(): ArchivedMatch[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(ARCHIVE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      backUpUnreadable(raw)
      return []
    }
    const valid = parsed.filter(isValidEntry)
    if (valid.length !== parsed.length) backUpUnreadable(raw)
    return valid.map((e) => ({
      ...e,
      match: {
        ...e.match,
        hydrationCompletedByHalf: e.match.hydrationCompletedByHalf ?? { firstHalf: false, secondHalf: false },
        hydrationCompletionElapsedMsByHalf: e.match.hydrationCompletionElapsedMsByHalf ?? {
          firstHalf: null,
          secondHalf: null,
        },
      },
    }))
  } catch {
    if (raw) backUpUnreadable(raw)
    return []
  }
}

// Returns false if the browser refused the write (private mode, quota).
export function saveArchive(list: ArchivedMatch[]): boolean {
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

// Called for a finished match every time it is (re)saved; safe to call any
// number of times.
export function archiveFinishedMatch(state: AppState, now: number = Date.now()): boolean {
  if (state.phase !== 'FULL_TIME') return false
  return saveArchive(upsertArchivedMatch(loadArchive(), toArchivedMatch(state, now)))
}

export function deleteArchivedMatch(id: string): boolean {
  return saveArchive(removeArchivedMatch(loadArchive(), id))
}

export function isMatchArchived(id: string): boolean {
  return loadArchive().some((e) => e.id === id)
}
