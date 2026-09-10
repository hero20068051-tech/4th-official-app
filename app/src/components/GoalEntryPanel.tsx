import { useState } from 'react'
import type { GoalDraft } from '../domain/matchStore'
import type { GoalEvent, Player, TeamId } from '../domain/types'
import { TeamDot } from './TeamBadge'

interface GoalEntryPanelProps {
  roster: Player[]
  homeName: string
  awayName: string
  initial?: GoalEvent
  submitLabel: string
  onSubmit: (draft: GoalDraft) => void
  onCancel: () => void
}

type Selection =
  | { kind: 'none' }
  | { kind: 'scorer'; number: number }
  | { kind: 'unknown' }
  | { kind: 'og'; number: number | null }

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

  const otherTeam: TeamId | null = team === 'HOME' ? 'AWAY' : team === 'AWAY' ? 'HOME' : null
  const canConfirm = team !== null && selection.kind !== 'none'

  function handleConfirm() {
    if (team === null || selection.kind === 'none') return
    onSubmit({
      teamId: team,
      scorerNumber: selection.kind === 'scorer' ? selection.number : null,
      ownGoal: selection.kind === 'og',
      ownGoalByNumber: selection.kind === 'og' ? selection.number : null,
    })
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
