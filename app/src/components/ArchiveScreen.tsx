import { useState, type ReactNode } from 'react'
import {
  type ArchivedMatch,
  formatLongDate,
  formatShortDate,
  loadArchive,
  sortArchive,
  summarizeArchivedMatch,
} from '../domain/matchArchive'
import { cardSummary, goalSummary } from '../domain/matchFormat'
import { buildTimeline, formatTimelineMoment, playerYellowOrdinal, type TimelineEntry } from '../domain/matchRecord'
import type { SubstitutionEvent, TeamId } from '../domain/types'
import { ConfirmDialog } from './ConfirmDialog'
import { TeamBadge } from './TeamBadge'

interface ArchiveScreenProps {
  onBack: () => void
  onDelete: (id: string) => void
}

// "Past matches": a plain list, one tap into a match. Nothing here is editable
// and nothing on the list can delete — deletion sits inside a match, under
// 「その他」, behind a confirmation.
export function ArchiveScreen({ onBack, onDelete }: ArchiveScreenProps) {
  const [entries, setEntries] = useState<ArchivedMatch[]>(() => sortArchive(loadArchive()))
  const [openId, setOpenId] = useState<string | null>(null)

  const opened = openId ? entries.find((e) => e.id === openId) : undefined

  if (opened) {
    return (
      <ArchiveDetail
        entry={opened}
        onBack={() => setOpenId(null)}
        onDelete={() => {
          onDelete(opened.id)
          setEntries((prev) => prev.filter((e) => e.id !== opened.id))
          setOpenId(null)
        }}
      />
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <ScreenHeader title="過去の試合" onBack={onBack} backLabel="トップへ" />
      {entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500">終了した試合はまだありません。</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => {
            const s = summarizeArchivedMatch(entry)
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(entry.id)}
                  className="block w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left active:bg-gray-100"
                >
                  <span className="block text-xs text-gray-500">{formatShortDate(s.dateMs)}</span>
                  <span className="mt-0.5 block break-words text-base font-bold text-gray-900">
                    {s.homeName} {s.homeScore} - {s.awayScore} {s.awayName}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function ScreenHeader({ title, onBack, backLabel }: { title: string; onBack: () => void; backLabel: string }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        className="min-h-11 shrink-0 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 active:bg-gray-100"
      >
        ← {backLabel}
      </button>
      <h1 className="min-w-0 truncate text-lg font-bold text-gray-900">{title}</h1>
    </div>
  )
}

function Section({ title, count, defaultOpen, children }: { title: string; count?: number; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="rounded-xl border border-gray-200 bg-white">
      <summary className="cursor-pointer select-none px-4 py-3 text-base font-semibold text-gray-800">
        {title}
        {count !== undefined && <span className="ml-2 text-sm font-normal text-gray-500">{count}</span>}
      </summary>
      <div className="border-t border-gray-100 px-4 py-3">{children}</div>
    </details>
  )
}

function Line({ teamId, teamLabel, moment, text }: { teamId: TeamId; teamLabel: string; moment: string; text: string }) {
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-gray-500">
        <TeamBadge teamId={teamId} label={teamLabel} />
        <span>・ {moment}</span>
      </div>
      <p className="mt-0.5 break-words text-base font-semibold text-gray-800">{text}</p>
    </li>
  )
}

function ArchiveDetail({ entry, onBack, onDelete }: { entry: ArchivedMatch; onBack: () => void; onDelete: () => void }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const { match } = entry
  const summary = summarizeArchivedMatch(entry)
  const labels: Record<TeamId, string> = { HOME: summary.homeName, AWAY: summary.awayName }
  const numberOf = (playerId: string) => match.roster.find((p) => p.id === playerId)?.number ?? '?'

  const entries = buildTimeline({
    substitutionEvents: match.substitutionEvents,
    goalEvents: match.goalEvents,
    cardEvents: match.cardEvents,
    clock: match.clock,
    hydrationCompletionElapsedMsByHalf: match.hydrationCompletionElapsedMsByHalf,
  })

  const subLine = (e: SubstitutionEvent) => (
    <Line
      key={e.id}
      teamId={e.teamGroups[0].teamId}
      teamLabel={labels[e.teamGroups[0].teamId]}
      moment={formatTimelineMoment(e.phase, e.elapsedMs)}
      text={e.teamGroups[0].pairs.map((p) => `${numberOf(p.outPlayerId)}→${numberOf(p.inPlayerId)}`).join('、 ')}
    />
  )
  const goalLine = (entry: Extract<TimelineEntry, { kind: 'GOAL' }>) => (
    <Line key={entry.key} teamId={entry.goal.teamId} teamLabel={labels[entry.goal.teamId]} moment={formatTimelineMoment(entry.phase, entry.elapsedMs)} text={goalSummary(entry.goal, labels)} />
  )
  const cardLine = (entry: Extract<TimelineEntry, { kind: 'CARD' }>) => (
    <Line
      key={entry.key}
      teamId={entry.card.teamId}
      teamLabel={labels[entry.card.teamId]}
      moment={formatTimelineMoment(entry.phase, entry.elapsedMs)}
      text={cardSummary(entry.card, playerYellowOrdinal(match.cardEvents, entry.card.id))}
    />
  )

  const goals = entries.filter((e): e is Extract<TimelineEntry, { kind: 'GOAL' }> => e.kind === 'GOAL')
  const cards = entries.filter((e): e is Extract<TimelineEntry, { kind: 'CARD' }> => e.kind === 'CARD')
  const subs = entries.flatMap((e) => (e.kind === 'SUB_SINGLE' ? [e.event] : e.kind === 'SUB_GROUP' ? e.events : []))

  return (
    <div className="mx-auto max-w-md space-y-3 p-4 pb-10">
      <ScreenHeader title="試合の記録" onBack={onBack} backLabel="一覧へ" />

      <div className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-center">
        <p className="text-xs text-gray-500">{formatLongDate(summary.dateMs)}</p>
        <p className="mt-1 break-words text-xl font-bold text-gray-900">
          {summary.homeName} {summary.homeScore} - {summary.awayScore} {summary.awayName}
        </p>
      </div>

      <Section title="得点" count={goals.length} defaultOpen>
        {goals.length === 0 ? <p className="text-sm text-gray-500">記録なし</p> : <ul className="divide-y divide-gray-100">{goals.map(goalLine)}</ul>}
      </Section>

      <Section title="カード" count={cards.length}>
        {cards.length === 0 ? <p className="text-sm text-gray-500">記録なし</p> : <ul className="divide-y divide-gray-100">{cards.map(cardLine)}</ul>}
      </Section>

      <Section title="交代" count={subs.length}>
        {subs.length === 0 ? <p className="text-sm text-gray-500">記録なし</p> : <ul className="divide-y divide-gray-100">{subs.map(subLine)}</ul>}
      </Section>

      <Section title="タイムライン">
        <ul className="space-y-1">
          {entries.map((e) => {
            if (e.kind === 'MARKER') {
              return (
                <li key={e.key} className="py-1 text-center text-xs font-medium text-gray-500">
                  — {e.label} —
                </li>
              )
            }
            if (e.kind === 'HYDRATION') {
              return (
                <li key={e.key} className="py-1 text-center text-xs text-sky-700">
                  💧 飲水（{formatTimelineMoment(e.phase, e.elapsedMs)}）
                </li>
              )
            }
            if (e.kind === 'GOAL') return goalLine(e)
            if (e.kind === 'CARD') return cardLine(e)
            return e.kind === 'SUB_SINGLE' ? subLine(e.event) : <>{e.events.map(subLine)}</>
          })}
        </ul>
      </Section>

      <details className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm text-gray-500">その他</summary>
        <div className="border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 active:bg-red-50"
          >
            この試合を削除
          </button>
        </div>
      </details>

      {confirmingDelete && (
        <ConfirmDialog
          title="⚠ この試合を削除します"
          message={`${formatShortDate(summary.dateMs)}  ${summary.homeName} ${summary.homeScore} - ${summary.awayScore} ${summary.awayName}\n削除すると元に戻せません。`}
          confirmLabel="削除する"
          cancelLabel="キャンセル"
          onConfirm={() => {
            setConfirmingDelete(false)
            onDelete()
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  )
}
