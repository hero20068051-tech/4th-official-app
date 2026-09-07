import { useState } from 'react'
import { formatElapsed } from '../domain/clock'
import type { Player, ReplayIssue, SubstitutionEvent, SubstitutionPair, TeamId } from '../domain/types'

const PHASE_LABELS: Record<SubstitutionEvent['phase'], string> = {
  FIRST_HALF: '前半',
  HALF_TIME: 'ハーフタイム',
  SECOND_HALF: '後半',
}

// Color is always paired with the team's own name label, never used alone,
// so the distinction still reads correctly without relying on color vision.
const TEAM_DOT_CLASS: Record<TeamId, string> = {
  HOME: 'bg-blue-500',
  AWAY: 'bg-orange-500',
}

function TeamDot({ teamId }: { teamId: TeamId }) {
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${TEAM_DOT_CLASS[teamId]}`} aria-hidden="true" />
}

interface SubstitutionHistoryProps {
  events: SubstitutionEvent[]
  roster: Player[]
  needsReview: ReplayIssue[]
  teamLabels: Record<TeamId, string>
  onDelete: (eventId: string) => void
  onUpdatePairs: (eventId: string, pairs: SubstitutionPair[]) => void
  onLinkStoppage: (eventId: string) => void
  onUnlinkStoppage: (eventId: string) => void
}

export function SubstitutionHistory({
  events,
  roster,
  needsReview,
  teamLabels,
  onDelete,
  onUpdatePairs,
  onLinkStoppage,
  onUnlinkStoppage,
}: SubstitutionHistoryProps) {
  if (events.length === 0) return null

  const numberOf = (playerId: string) => roster.find((p) => p.id === playerId)?.number ?? '?'
  const reviewByEventId = new Map(needsReview.map((r) => [r.eventId, r.messages]))

  // Two events sharing a stoppageGroupId are rendered together in a single
  // card, in whichever order they were confirmed, so the merged group only
  // ever appears once (at the earlier event's position).
  const renderedIds = new Set<string>()
  const rows: React.ReactNode[] = []
  for (const event of events) {
    if (renderedIds.has(event.id)) continue
    const partner = event.stoppageGroupId
      ? events.find((e) => e.id !== event.id && e.stoppageGroupId === event.stoppageGroupId)
      : undefined

    if (partner) {
      renderedIds.add(event.id)
      renderedIds.add(partner.id)
      const pair = [event, partner].sort((a, b) => a.elapsedMs - b.elapsedMs)
      rows.push(
        <li key={event.id} className="rounded-lg border border-gray-200 p-3">
          <p className="text-xs font-medium text-gray-500">同じプレー停止</p>
          <div className="mt-1 divide-y divide-gray-100">
            {pair.map((e) => (
              <div key={e.id} className="py-2 first:pt-0 last:pb-0">
                <HistoryRowContent
                  event={e}
                  teamLabel={teamLabels[e.teamGroups[0].teamId]}
                  numberOf={numberOf}
                  review={reviewByEventId.get(e.id)}
                  roster={roster.filter((p) => p.teamId === e.teamGroups[0].teamId).sort((a, b) => a.number - b.number)}
                  onDelete={() => onDelete(e.id)}
                  onSave={(pairs) => onUpdatePairs(e.id, pairs)}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              onUnlinkStoppage(event.id)
              onUnlinkStoppage(partner.id)
            }}
            className="mt-2 text-sm text-gray-500 underline"
          >
            同じ停止のまとめを解除
          </button>
        </li>,
      )
      continue
    }

    renderedIds.add(event.id)
    const group = event.teamGroups[0]
    const hasOpposingTeamEvent = events.some((e) => e.id !== event.id && e.teamGroups[0].teamId !== group.teamId)
    rows.push(
      <li key={event.id} className="rounded-lg border border-gray-200 p-3">
        <HistoryRowContent
          event={event}
          teamLabel={teamLabels[group.teamId]}
          numberOf={numberOf}
          review={reviewByEventId.get(event.id)}
          roster={roster.filter((p) => p.teamId === group.teamId).sort((a, b) => a.number - b.number)}
          onDelete={() => onDelete(event.id)}
          onSave={(pairs) => onUpdatePairs(event.id, pairs)}
        />
        {hasOpposingTeamEvent && (
          <button
            type="button"
            onClick={() => onLinkStoppage(event.id)}
            className="mt-2 text-sm text-gray-500 underline"
          >
            相手チームの交代と同じ停止としてまとめる
          </button>
        )}
      </li>,
    )
  }

  return (
    <section className="rounded-xl border border-gray-200 p-4">
      <h3 className="text-base font-bold text-gray-900">交代履歴</h3>
      <ul className="mt-3 space-y-2">{rows}</ul>
    </section>
  )
}

interface HistoryRowContentProps {
  event: SubstitutionEvent
  teamLabel: string
  numberOf: (playerId: string) => number | string
  review?: string[]
  roster: Player[]
  onDelete: () => void
  onSave: (pairs: SubstitutionPair[]) => void
}

function HistoryRowContent({ event, teamLabel, numberOf, review, roster, onDelete, onSave }: HistoryRowContentProps) {
  const [mode, setMode] = useState<'view' | 'confirmDelete' | 'edit'>('view')
  const [draftPairs, setDraftPairs] = useState<SubstitutionPair[]>(event.teamGroups[0].pairs)
  const teamId = event.teamGroups[0].teamId

  function startEdit() {
    setDraftPairs(event.teamGroups[0].pairs)
    setMode('edit')
  }

  return (
    <div className={review ? '-m-1 rounded-lg border border-amber-400 bg-amber-50 p-1' : ''}>
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <TeamDot teamId={teamId} />
        <span className="font-semibold text-gray-700">{teamLabel}</span>
        <span>
          ・ {PHASE_LABELS[event.phase]} ・ {formatElapsed(event.elapsedMs)}
        </span>
      </div>

      {mode === 'edit' ? (
        <div className="mt-2 space-y-2">
          {draftPairs.map((pair, i) => (
            <div key={`${pair.outPlayerId}-${pair.inPlayerId}-${i}`} className="flex items-center gap-2 text-sm">
              <select
                value={pair.outPlayerId}
                onChange={(e) =>
                  setDraftPairs((prev) => prev.map((p, idx) => (idx === i ? { ...p, outPlayerId: e.target.value } : p)))
                }
                className="rounded border border-gray-300 px-2 py-1"
              >
                {roster.map((p) => (
                  <option key={p.id} value={p.id}>
                    OUT {p.number}
                  </option>
                ))}
              </select>
              <span>→</span>
              <select
                value={pair.inPlayerId}
                onChange={(e) =>
                  setDraftPairs((prev) => prev.map((p, idx) => (idx === i ? { ...p, inPlayerId: e.target.value } : p)))
                }
                className="rounded border border-gray-300 px-2 py-1"
              >
                {roster.map((p) => (
                  <option key={p.id} value={p.id}>
                    IN {p.number}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                onSave(draftPairs)
                setMode('view')
              }}
              className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => setMode('view')}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 text-base font-semibold text-gray-800">
            {event.teamGroups[0].pairs.map((p) => `${numberOf(p.outPlayerId)}→${numberOf(p.inPlayerId)}`).join('、 ')}
          </p>

          {review && review.length > 0 && (
            <p className="mt-1 text-sm font-medium text-amber-700">
              この修正により、後の交代記録に確認が必要です：{review.join(' / ')}
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            <button type="button" onClick={startEdit} className="text-blue-600 underline">
              編集
            </button>
            {mode === 'confirmDelete' ? (
              <>
                <span className="text-gray-500">本当に取り消しますか？</span>
                <button type="button" onClick={onDelete} className="font-semibold text-red-600 underline">
                  取り消す
                </button>
                <button type="button" onClick={() => setMode('view')} className="text-gray-500 underline">
                  やめる
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setMode('confirmDelete')} className="text-gray-500 underline">
                取消
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
