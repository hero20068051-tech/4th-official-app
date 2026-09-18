import { useState } from 'react'
import { MAX_STARTERS, evaluateStartEligibility } from '../domain/matchSetup'
import type { Player, TeamId } from '../domain/types'
import { StarterShortageDialog } from './StarterShortageDialog'

interface StarterCorrectionPanelProps {
  teamId: TeamId
  teamLabel: string
  players: Player[]
  onConfirm: (teamId: TeamId, starterPlayerIds: string[]) => string[]
  onCancel: () => void
}

// Fixes the *initial lineup* typed before kickoff (Phase 2.2). It is offered
// only until that team's first substitution is confirmed, and it never
// creates a substitution event — the parent just receives the new starter
// set. Everything downstream (bench, re-entry eligibility, counters) is
// re-derived from that set by the existing replay.
export function StarterCorrectionPanel({ teamId, teamLabel, players, onConfirm, onCancel }: StarterCorrectionPanelProps) {
  const sorted = [...players].sort((a, b) => a.number - b.number)
  const [chosen, setChosen] = useState<string[]>(() => sorted.filter((p) => p.isStarter).map((p) => p.id))
  const [errors, setErrors] = useState<string[]>([])
  const [confirmingShort, setConfirmingShort] = useState(false)

  const chosenSet = new Set(chosen)
  const chosenNumbers = sorted.filter((p) => chosenSet.has(p.id)).map((p) => p.number)
  const count = chosen.length
  const level = evaluateStartEligibility(count).level

  function toggle(player: Player) {
    if (chosenSet.has(player.id)) {
      setChosen((prev) => prev.filter((id) => id !== player.id))
      setErrors([])
      return
    }
    if (count >= MAX_STARTERS) {
      setErrors([`先発は${MAX_STARTERS}人までです`])
      return
    }
    setErrors([])
    setChosen((prev) => [...prev, player.id])
  }

  function submit() {
    const result = onConfirm(teamId, chosen)
    if (result.length > 0) {
      setErrors(result)
      setConfirmingShort(false)
    }
  }

  function handleConfirmClick() {
    if (level === 'BLOCK') {
      setErrors(['先発は7名以上必要です'])
      return
    }
    if (level === 'WARN') {
      setConfirmingShort(true)
      return
    }
    submit()
  }

  return (
    <section className="rounded-xl border-2 border-amber-400 bg-amber-50/50 p-4">
      <h2 className="text-base font-bold text-gray-900">{teamLabel}の先発設定を修正</h2>
      <p className="mt-1 text-xs text-gray-600">
        開始時の先発の入力ミスを直します。交代の記録は作られません。
      </p>

      <div className="mt-3 grid grid-cols-5 gap-2">
        {sorted.map((p) => {
          const on = chosenSet.has(p.id)
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p)}
              aria-pressed={on}
              aria-label={`${p.number}番${on ? '（先発）' : ''}`}
              className={`h-12 rounded-lg border text-lg font-bold tabular-nums ${
                on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-800 active:bg-gray-100'
              }`}
            >
              {p.number}
            </button>
          )
        })}
      </div>

      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
        <p className={`text-sm font-bold ${level === 'OK' ? 'text-gray-800' : 'text-red-700'}`}>
          {level === 'OK' ? '' : '⚠ '}先発 {count}名{level === 'OK' ? '' : '（11名ではありません）'}
        </p>
        {count > 0 && <p className="mt-1 font-mono text-sm text-gray-900">{chosenNumbers.join(' / ')}</p>}
      </div>

      {errors.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm font-medium text-red-600">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-gray-300 bg-white py-3 text-base font-medium text-gray-700 active:bg-gray-100"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={handleConfirmClick}
          className="flex-1 rounded-lg bg-blue-600 py-3 text-base font-bold text-white active:bg-blue-700"
        >
          修正を確定
        </button>
      </div>

      {confirmingShort && (
        <StarterShortageDialog
          mode="CONFIRM"
          action="correct"
          teams={[{ label: teamLabel, count }]}
          onBack={() => setConfirmingShort(false)}
          onProceed={submit}
        />
      )}
    </section>
  )
}
