import { replayMatch } from './engine'
import { OFFICIAL_ROLE_LABELS } from './matchFormat'
import { archivedMatchDateMs, summarizeArchivedMatch, type ArchivedMatch } from './matchArchive'
import { buildTimeline, formatTimelineMoment, playerYellowOrdinal } from './matchRecord'
import { eventsInReplayOrder } from './matchStore'
import { pendingConfirmationReentryPolicy } from './reentryPolicy'
import type { ReplayIssue, TeamId } from './types'

// Result-sharing model (Phase 2.5). Everything here is a *pure read* of an
// archived match: nothing is written back, and only what the app already
// stores is used (numbers, never names of players; no substitutions, no
// re-entry, no timeline, no counters — those are referee-only detail).
//
//   archived match  ->  ShareSummary  ->  layout  ->  PNG

export interface ShareGoal {
  moment: string // "前半 12:35"
  teamId: TeamId // the team the goal counts for
  text: string // team name, full-width space, then "#10" / "得点者未確認" / "オウンゴール（AWAY #5）"
}

export interface ShareCard {
  moment: string
  teamId: TeamId
  kind: 'YELLOW' | 'RED'
  text: string // team, target ("#6" / "監督"), card name, e.g. "…イエローカード（2枚目）"
}

export interface ShareSummary {
  title: string
  dateLabel: string // "2026.09.24"
  homeName: string
  awayName: string
  // Only set when the team has a custom name, so the picture still says which side is HOME/AWAY.
  homeCaption: string | null
  awayCaption: string | null
  homeScore: number
  awayScore: number
  goals: ShareGoal[]
  cards: ShareCard[]
}

const SEP = '\u3000' // full-width space, as in the agreed layout (HOME, space, 得点者未確認)

export function formatShareDate(ms: number): string {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}.${mm}.${dd}`
}

export function buildShareSummary(entry: ArchivedMatch): ShareSummary {
  const base = summarizeArchivedMatch(entry)
  const { match } = entry
  const names: Record<TeamId, string> = { HOME: base.homeName, AWAY: base.awayName }

  // Same ordering as the timeline everywhere else in the app.
  const timeline = buildTimeline({
    substitutionEvents: match.substitutionEvents,
    goalEvents: match.goalEvents,
    cardEvents: match.cardEvents,
    clock: match.clock,
    hydrationCompletionElapsedMsByHalf: match.hydrationCompletionElapsedMsByHalf,
  })

  const goals: ShareGoal[] = []
  const cards: ShareCard[] = []
  for (const e of timeline) {
    if (e.kind === 'GOAL') {
      const g = e.goal
      let detail: string
      if (g.ownGoal) {
        const other: TeamId = g.teamId === 'HOME' ? 'AWAY' : 'HOME'
        detail = g.ownGoalByNumber !== null ? `オウンゴール（${names[other]} #${g.ownGoalByNumber}）` : 'オウンゴール'
      } else {
        detail = g.scorerNumber !== null ? `#${g.scorerNumber}` : '得点者未確認'
      }
      goals.push({ moment: formatTimelineMoment(e.phase, e.elapsedMs), teamId: g.teamId, text: `${names[g.teamId]}${SEP}${detail}` })
    } else if (e.kind === 'CARD') {
      const c = e.card
      const kindLabel = c.card === 'YELLOW' ? 'イエローカード' : 'レッドカード'
      // The stored free-text name of a team official is deliberately not shown.
      const target =
        c.targetType === 'OFFICIAL'
          ? c.officialRole
            ? OFFICIAL_ROLE_LABELS[c.officialRole]
            : '役員'
          : c.playerNumber !== null
            ? `#${c.playerNumber}`
            : '背番号不明'
      const ordinal = c.targetType === 'PLAYER' ? playerYellowOrdinal(match.cardEvents, c.id) : null
      const ordinalLabel = ordinal !== null && ordinal >= 2 ? `（${ordinal}枚目）` : ''
      cards.push({
        moment: formatTimelineMoment(e.phase, e.elapsedMs),
        teamId: c.teamId,
        kind: c.card,
        text: `${names[c.teamId]}${SEP}${target}${SEP}${kindLabel}${ordinalLabel}`,
      })
    }
  }

  return {
    title: '試合結果',
    dateLabel: formatShareDate(archivedMatchDateMs(entry)),
    homeName: base.homeName,
    awayName: base.awayName,
    homeCaption: base.homeName === 'HOME' ? null : 'HOME',
    awayCaption: base.awayName === 'AWAY' ? null : 'AWAY',
    homeScore: base.homeScore,
    awayScore: base.awayScore,
    goals,
    cards,
  }
}

// The existing NEEDS_REVIEW judgement (an event that no longer replays
// legally), re-run on the archived record — no new rule. Sharing is refused
// while any remain.
export function archivedNeedsReview(entry: ArchivedMatch): ReplayIssue[] {
  return replayMatch(
    entry.match.roster,
    eventsInReplayOrder(entry.match.substitutionEvents),
    pendingConfirmationReentryPolicy,
  ).needsReview
}

export function shareFileName(entry: ArchivedMatch): string {
  return `試合結果_${formatShareDate(archivedMatchDateMs(entry)).replaceAll('.', '')}.png`
}
