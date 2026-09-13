import { useState } from 'react'
import { parseElapsedInput } from '../domain/clock'
import type { GoalDraft, GoalTimeEdit } from '../domain/matchStore'
import type { GoalEvent, Player, RecordablePhase, TeamId } from '../domain/types'
import { TeamDot } from './TeamBadge'

interface GoalEntryPanelProps {
  roster: Player[]
  homeName: string
  awayName: string
  initial?: GoalEvent
  submitLabel: string
  onSubmit: (draft: GoalDraft, time?: GoalTimeEdit) => void
  onCancel: () => void
}

type Selection =
  | { kind: 'none' }
  | { kind: 'scorer'; number: number }
  | { kind: 'unknown' }
  | { kind: 'og'; number: number | null }

// Goals can only happen while the ball is in play, so editing a goal's time
// only ever moves it within 前半/後半 — never to ハーフタイム/試合終了後.
type GoalHalf = Extract<RecordablePhase, 'FIRST_HALF' | 'SECOND_HALF'>

function selectionFromGoal(goal: GoalEvent): Selection {
  if (goal.ownGoal) return { kind: 'og', number: goal.ownGoalByNumber }
  if (goal.scorerNumber === null) return { kind: 'unknown' }
  return { kind: 'scorer', number: goal.scorerNumber }
}

function teamNumbers(roster: Player[], teamId: TeamId): number[] {
  return roster
    .filter((p) => p.teamId === teamId)
    .map((p) => p.number)
    .sort((a, b) => a - b)
}

export function GoalEntryPanel({ roster, homeName, awayName, initial, submitLabel, onSubmit, onCancel }: GoalEntryPanelProps) {
  const [team, setTeam] = useState<TeamId | null>(initial ? initial.teamId : null)
  const [selection, setSelection] = useState<Selection>(initial ? selectionFromGoal(initial) : { kind: 'none' })

  // Time-of-recording fields — only rendered (and only ever read) in edit
  // mode. Pre-filled from the existing event so leaving them untouched is a
  // no-op.
  const [goalHalf, setGoalHalf] = useState<GoalHalf>(
    initial && initial.phase === 'SECOND_HALF' ? 'SECOND_HALF' : 'FIRST_HALF',
  )
  const [minutesText, setMinutesText] = useState(initial ? String(Math.floor(initial.elapsedMs / 60_000)) : '')
  const [secondsText, setSecondsText] = useState(
    initial ? String(Math.floor((initial.elapsedMs % 60_000) / 1000)) : '',
  )
  const [timeError, setTimeError] = useState<string | null>(null)

  const otherTeam: TeamId | null = team === 'HOME' ? 'AWAY' : team === 'AWAY' ? 'HOME' : null
  const canConfirm = team !== null && selection.kind !== 'none'

  function handleConfirm() {
    if (team === null || selection.kind === 'none') return
    const draft: GoalDraft = {
      teamId: team,
      scorerNumber: selection.kind === 'scorer' ? selection.number : null,
      ownGoal: selection.kind === 'og',
      ownGoalByNumber: selection.kind === 'og' ? selection.number : null,
    }

    if (!initial) {
      onSubmit(draft)
      return
    }

    // Edit mode: also validate the (possibly changed) recorded time. Reuses
    // the exact same "m:s" parser and 180-minute safety cap as the half
    // start-time correction — separate 分/秒 fields because Android's
    // numeric keypad has no ":" key.
    const m = minutesText.trim() === '' ? '0' : minutesText.trim()
    const s = secondsText.trim() === '' ? '0' : secondsText.trim()
    const result = parseElapsedInput(`${m}:${s}`)
    if (!result.ok) {
      setTimeError(result.error)
      return
    }
    setTimeError(null)
    onSubmit(draft, { phase: goalHalf, elapsedMs: result.ms })
  }

  return (
    <section className="rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-gray-900">⚽ 得点を記録</h3>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 underline">
          キャンセル
        </button>
      </div>

      <p className="mt-3 text-xs font-medium text-gray-500">どちらの得点ですか？</p>
      <div className="mt-1 flex gap-2">
        {(['HOME', 'AWAY'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTeam(t)
              setSelection({ kind: 'none' })
            }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-bold ${
              team === t
                ? t === 'HOME'
                  ? 'bg-blue-600 text-white'
                  : 'bg-orange-600 text-white'
                : 'border border-gray-300 text-gray-700'
            }`}
          >
            <TeamDot teamId={t} />
            {t === 'HOME' ? homeName : awayName}
          </button>
        ))}
      </div>

      {team !== null && (
        <>
          <p className="mt-4 text-xs font-medium text-gray-500">得点者（背番号）</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {teamNumbers(roster, team).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSelection({ kind: 'scorer', number: n })}
                className={`h-11 min-w-11 rounded-lg border px-3 text-lg font-bold tabular-nums ${
                  selection.kind === 'scorer' && selection.number === n
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-gray-300 bg-white text-gray-800 active:bg-gray-100'
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelection({ kind: 'unknown' })}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                selection.kind === 'unknown'
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-300 text-gray-700'
              }`}
            >
              得点者未確認
            </button>
            <button
              type="button"
              onClick={() => setSelection({ kind: 'og', number: null })}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                selection.kind === 'og'
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-300 text-gray-700'
              }`}
            >
              オウンゴール
            </button>
          </div>

          {selection.kind === 'og' && otherTeam !== null && (
            <div className="mt-3 rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-medium text-gray-500">
                入れてしまった選手（{otherTeam === 'HOME' ? homeName : awayName}）— 分からなければ「背番号不明」
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                {teamNumbers(roster, otherTeam).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setSelection({ kind: 'og', number: n })}
                    className={`h-10 min-w-10 rounded-lg border px-2 text-base font-bold tabular-nums ${
                      selection.number === n
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-gray-300 bg-white text-gray-800 active:bg-gray-100'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSelection({ kind: 'og', number: null })}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                    selection.number === null
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-300 text-gray-700'
                  }`}
                >
                  背番号不明
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {initial && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-500">記録した時間</p>
          <div className="mt-1 flex gap-2">
            {(['FIRST_HALF', 'SECOND_HALF'] as const).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setGoalHalf(h)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  goalHalf === h ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-700'
                }`}
              >
                {h === 'FIRST_HALF' ? '前半' : '後半'}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={minutesText}
              onChange={(e) => setMinutesText(e.target.value)}
              placeholder="2"
              className="w-16 rounded border border-gray-300 px-2 py-1 text-center"
            />
            <span className="text-sm">分</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              value={secondsText}
              onChange={(e) => setSecondsText(e.target.value)}
              placeholder="00"
              className="w-16 rounded border border-gray-300 px-2 py-1 text-center"
            />
            <span className="text-sm">秒</span>
          </div>
          {timeError && <p className="mt-1 text-sm font-medium text-red-600">{timeError}</p>}
        </div>
      )}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={!canConfirm}
        className="mt-4 w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white disabled:bg-gray-300 active:bg-blue-700"
      >
        {submitLabel}
      </button>
    </section>
  )
}
