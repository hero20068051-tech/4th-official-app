import { useState } from 'react'
import { buildTimeline, formatTimelineMoment, playerYellowOrdinal } from '../domain/matchRecord'
import type { ClockState, HalfKey } from '../domain/matchTypes'
import type { CardDraft, GoalDraft, GoalTimeEdit } from '../domain/matchStore'
import type {
  CardEvent,
  GoalEvent,
  Player,
  ReplayIssue,
  SubstitutionEvent,
  SubstitutionPair,
  TeamId,
  TeamOfficialRole,
} from '../domain/types'
import { CardEntryPanel } from './CardEntryPanel'
import { GoalEntryPanel } from './GoalEntryPanel'
import { TeamBadge } from './TeamBadge'

const OFFICIAL_ROLE_LABELS: Record<TeamOfficialRole, string> = {
  MANAGER: '監督',
  COACH: 'コーチ',
  STAFF: 'スタッフ',
  OTHER: 'その他',
}

interface MatchTimelineProps {
  substitutionEvents: SubstitutionEvent[]
  goalEvents: GoalEvent[]
  cardEvents: CardEvent[]
  clock: ClockState
  hydrationCompletionElapsedMsByHalf: Record<HalfKey, number | null>
  roster: Player[]
  needsReview: ReplayIssue[]
  teamLabels: Record<TeamId, string>
  onDeleteSubstitution: (eventId: string) => void
  onUpdateSubstitutionPairs: (eventId: string, pairs: SubstitutionPair[]) => void
  onLinkStoppage: (eventId: string) => void
  onUnlinkStoppage: (eventId: string) => void
  canMoveToHalfTime: (eventId: string) => boolean
  previewMoveToHalfTime: (eventId: string) => number
  onMoveToHalfTime: (eventId: string) => void
  onEditGoal: (goalId: string, draft: GoalDraft, time?: GoalTimeEdit) => void
  onDeleteGoal: (goalId: string) => void
  onEditCard: (cardId: string, draft: CardDraft) => void
  onDeleteCard: (cardId: string) => void
}

export function MatchTimeline(props: MatchTimelineProps) {
  const {
    substitutionEvents,
    goalEvents,
    cardEvents,
    clock,
    hydrationCompletionElapsedMsByHalf,
    roster,
    needsReview,
    teamLabels,
  } = props

  const entries = buildTimeline({
    substitutionEvents,
    goalEvents,
    cardEvents,
    clock,
    hydrationCompletionElapsedMsByHalf,
  })

  if (entries.length === 0) return null

  const numberOf = (playerId: string) => roster.find((p) => p.id === playerId)?.number ?? '?'
  const reviewByEventId = new Map(needsReview.map((r) => [r.eventId, r.messages]))

  return (
    <section className="rounded-xl border border-gray-200 p-4">
      <h3 className="text-base font-bold text-gray-900">試合タイムライン</h3>
      <ul className="mt-3 space-y-2">
        {entries.map((entry) => {
          if (entry.kind === 'MARKER') {
            return (
              <li key={entry.key} className="py-1 text-center text-xs font-medium text-gray-500">
                — {entry.label} —
              </li>
            )
          }
          if (entry.kind === 'HYDRATION') {
            return (
              <li key={entry.key} className="py-1 text-center text-xs text-sky-700">
                💧 飲水（{formatTimelineMoment(entry.phase, entry.elapsedMs)}）
              </li>
            )
          }
          if (entry.kind === 'GOAL') {
            return (
              <li key={entry.key} className="rounded-lg border border-gray-200 p-3">
                <GoalRow
                  goal={entry.goal}
                  roster={roster}
                  teamLabels={teamLabels}
                  onSave={(draft, time) => props.onEditGoal(entry.goal.id, draft, time)}
                  onDelete={() => props.onDeleteGoal(entry.goal.id)}
                />
              </li>
            )
          }
          if (entry.kind === 'CARD') {
            return (
              <li key={entry.key} className="rounded-lg border border-gray-200 p-3">
                <CardRow
                  card={entry.card}
                  cardEvents={cardEvents}
                  roster={roster}
                  teamLabels={teamLabels}
                  onSave={(draft) => props.onEditCard(entry.card.id, draft)}
                  onDelete={() => props.onDeleteCard(entry.card.id)}
                />
              </li>
            )
          }
          if (entry.kind === 'SUB_GROUP') {
            const members = entry.events
            return (
              <li key={entry.key} className="rounded-lg border border-gray-200 p-3">
                <p className="text-xs font-medium text-gray-500">同じプレー停止</p>
                <div className="mt-1 divide-y divide-gray-100">
                  {members.map((e) => (
                    <div key={e.id} className="py-2 first:pt-0 last:pb-0">
                      <SubstitutionRowContent
                        event={e}
                        teamLabel={teamLabels[e.teamGroups[0].teamId]}
                        numberOf={numberOf}
                        review={reviewByEventId.get(e.id)}
                        roster={roster
                          .filter((p) => p.teamId === e.teamGroups[0].teamId)
                          .sort((a, b) => a.number - b.number)}
                        onDelete={() => props.onDeleteSubstitution(e.id)}
                        onSave={(pairs) => props.onUpdateSubstitutionPairs(e.id, pairs)}
                        halfTimeMove={
                          props.canMoveToHalfTime(e.id)
                            ? { preview: () => props.previewMoveToHalfTime(e.id), onMove: () => props.onMoveToHalfTime(e.id) }
                            : undefined
                        }
                      />
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => members.forEach((e) => props.onUnlinkStoppage(e.id))}
                  className="mt-2 text-sm text-gray-500 underline"
                >
                  同じ停止のまとめを解除
                </button>
              </li>
            )
          }
          // SUB_SINGLE
          const event = entry.event
          const group = event.teamGroups[0]
          const hasOpposingTeamEvent = substitutionEvents.some(
            (e) => e.id !== event.id && e.teamGroups[0].teamId !== group.teamId,
          )
          return (
            <li key={entry.key} className="rounded-lg border border-gray-200 p-3">
              <SubstitutionRowContent
                event={event}
                teamLabel={teamLabels[group.teamId]}
                numberOf={numberOf}
                review={reviewByEventId.get(event.id)}
                roster={roster.filter((p) => p.teamId === group.teamId).sort((a, b) => a.number - b.number)}
                onDelete={() => props.onDeleteSubstitution(event.id)}
                onSave={(pairs) => props.onUpdateSubstitutionPairs(event.id, pairs)}
                halfTimeMove={
                  props.canMoveToHalfTime(event.id)
                    ? {
                        preview: () => props.previewMoveToHalfTime(event.id),
                        onMove: () => props.onMoveToHalfTime(event.id),
                      }
                    : undefined
                }
              />
              {hasOpposingTeamEvent && (
                <button
                  type="button"
                  onClick={() => props.onLinkStoppage(event.id)}
                  className="mt-2 text-sm text-gray-500 underline"
                >
                  相手チームの交代と同じ停止としてまとめる
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// --- Goal row ---

function goalSummary(goal: GoalEvent, teamLabels: Record<TeamId, string>): string {
  if (goal.ownGoal) {
    const other = goal.teamId === 'HOME' ? 'AWAY' : 'HOME'
    return goal.ownGoalByNumber !== null
      ? `⚽ OG（${teamLabels[other]} #${goal.ownGoalByNumber}）`
      : '⚽ OG'
  }
  return goal.scorerNumber !== null ? `⚽ 得点 #${goal.scorerNumber}` : '⚽ 得点（得点者未確認）'
}

function GoalRow({
  goal,
  roster,
  teamLabels,
  onSave,
  onDelete,
}: {
  goal: GoalEvent
  roster: Player[]
  teamLabels: Record<TeamId, string>
  onSave: (draft: GoalDraft, time?: GoalTimeEdit) => void
  onDelete: () => void
}) {
  const [mode, setMode] = useState<'view' | 'confirmDelete' | 'edit'>('view')

  if (mode === 'edit') {
    return (
      <GoalEntryPanel
        roster={roster}
        homeName={teamLabels.HOME}
        awayName={teamLabels.AWAY}
        initial={goal}
        submitLabel="保存"
        onSubmit={(draft, time) => {
          onSave(draft, time)
          setMode('view')
        }}
        onCancel={() => setMode('view')}
      />
    )
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <TeamBadge teamId={goal.teamId} label={teamLabels[goal.teamId]} />
        <span>・ {formatTimelineMoment(goal.phase, goal.elapsedMs)}</span>
      </div>
      <p className="mt-1 text-base font-semibold text-gray-800">{goalSummary(goal, teamLabels)}</p>
      <RowActions
        mode={mode}
        onEdit={() => setMode('edit')}
        onAskDelete={() => setMode('confirmDelete')}
        onConfirmDelete={onDelete}
        onCancelDelete={() => setMode('view')}
      />
    </div>
  )
}

// --- Card row ---

function cardSummary(card: CardEvent, ordinal: number | null): string {
  const mark = card.card === 'YELLOW' ? '🟨 警告' : '🟥 退場'
  if (card.targetType === 'OFFICIAL') {
    const role = card.officialRole ? OFFICIAL_ROLE_LABELS[card.officialRole] : '役員'
    return card.officialName ? `${mark} ${role}（${card.officialName}）` : `${mark} ${role}`
  }
  const base = `${mark} #${card.playerNumber ?? '?'}`
  return ordinal !== null && ordinal >= 2 ? `${base}（${ordinal}枚目）` : base
}

function CardRow({
  card,
  cardEvents,
  roster,
  teamLabels,
  onSave,
  onDelete,
}: {
  card: CardEvent
  cardEvents: CardEvent[]
  roster: Player[]
  teamLabels: Record<TeamId, string>
  onSave: (draft: CardDraft) => void
  onDelete: () => void
}) {
  const [mode, setMode] = useState<'view' | 'confirmDelete' | 'edit'>('view')

  if (mode === 'edit') {
    return (
      <CardEntryPanel
        roster={roster}
        homeName={teamLabels.HOME}
        awayName={teamLabels.AWAY}
        cardEvents={cardEvents}
        initial={card}
        submitLabel="保存"
        onSubmit={(draft) => {
          onSave(draft)
          setMode('view')
        }}
        onCancel={() => setMode('view')}
      />
    )
  }

  const ordinal = playerYellowOrdinal(cardEvents, card.id)

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <TeamBadge teamId={card.teamId} label={teamLabels[card.teamId]} />
        <span>・ {formatTimelineMoment(card.phase, card.elapsedMs)}</span>
      </div>
      <p className="mt-1 text-base font-semibold text-gray-800">{cardSummary(card, ordinal)}</p>
      <RowActions
        mode={mode}
        onEdit={() => setMode('edit')}
        onAskDelete={() => setMode('confirmDelete')}
        onConfirmDelete={onDelete}
        onCancelDelete={() => setMode('view')}
      />
    </div>
  )
}

function RowActions({
  mode,
  onEdit,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  mode: 'view' | 'confirmDelete' | 'edit'
  onEdit: () => void
  onAskDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-3 text-sm">
      <button type="button" onClick={onEdit} className="text-blue-600 underline">
        編集
      </button>
      {mode === 'confirmDelete' ? (
        <>
          <span className="text-gray-500">本当に取り消しますか？</span>
          <button type="button" onClick={onConfirmDelete} className="font-semibold text-red-600 underline">
            取り消す
          </button>
          <button type="button" onClick={onCancelDelete} className="text-gray-500 underline">
            やめる
          </button>
        </>
      ) : (
        <button type="button" onClick={onAskDelete} className="text-gray-500 underline">
          取消
        </button>
      )}
    </div>
  )
}

// --- Substitution row (ported from the former SubstitutionHistory) ---

function SubstitutionRowContent({
  event,
  teamLabel,
  numberOf,
  review,
  roster,
  onDelete,
  onSave,
  halfTimeMove,
}: {
  event: SubstitutionEvent
  teamLabel: string
  numberOf: (playerId: string) => number | string
  review?: string[]
  roster: Player[]
  onDelete: () => void
  onSave: (pairs: SubstitutionPair[]) => void
  // Present only for a second-half substitution that can be re-filed as a
  // half-time one; `preview` says how many other substitutions the move
  // would newly flag for review.
  halfTimeMove?: { preview: () => number; onMove: () => void }
}) {
  const [mode, setMode] = useState<'view' | 'confirmDelete' | 'edit'>('view')
  const [askingMove, setAskingMove] = useState(false)
  const [draftPairs, setDraftPairs] = useState<SubstitutionPair[]>(event.teamGroups[0].pairs)
  const teamId = event.teamGroups[0].teamId

  function startEdit() {
    setDraftPairs(event.teamGroups[0].pairs)
    setMode('edit')
  }

  return (
    <div className={review ? '-m-1 rounded-lg border border-amber-400 bg-amber-50 p-1' : ''}>
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <TeamBadge teamId={teamId} label={teamLabel} />
        <span>・ {formatTimelineMoment(event.phase, event.elapsedMs)}</span>
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

          <RowActions
            mode={mode}
            onEdit={startEdit}
            onAskDelete={() => setMode('confirmDelete')}
            onConfirmDelete={onDelete}
            onCancelDelete={() => setMode('view')}
          />

          {halfTimeMove &&
            (askingMove ? (
              <div className="mt-2 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm">
                <p className="font-medium text-gray-800">
                  この交代を「後半」から「ハーフタイム」の記録に変更しますか？
                </p>
                <p className="text-xs text-gray-600">
                  後半の交代回数は元に戻り、ピッチ・ベンチの状態や再出場の人数は記録から計算し直します。
                </p>
                {halfTimeMove.preview() > 0 && (
                  <p className="text-xs font-medium text-amber-800">
                    ⚠ この変更で、確認が必要になる交代が{halfTimeMove.preview()}件あります（記録は削除されません）。
                  </p>
                )}
                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAskingMove(false)
                      halfTimeMove.onMove()
                    }}
                    className="rounded-lg bg-gray-900 px-3 py-1.5 font-medium text-white"
                  >
                    ハーフタイムに変更する
                  </button>
                  <button type="button" onClick={() => setAskingMove(false)} className="text-gray-500 underline">
                    やめる
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAskingMove(true)}
                className="mt-2 text-sm font-medium text-amber-800 underline"
              >
                ハーフタイムの交代だった
              </button>
            ))}
        </>
      )}
    </div>
  )
}
