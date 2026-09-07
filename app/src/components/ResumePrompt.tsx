import { useState } from 'react'
import { displayTeamName } from '../domain/matchSetup'
import type { AppState } from '../domain/matchStore'
import { ConfirmDialog } from './ConfirmDialog'

const PHASE_LABELS: Record<AppState['phase'], string> = {
  PRE_MATCH: '試合前',
  FIRST_HALF: '前半',
  HALF_TIME: 'ハーフタイム',
  SECOND_HALF: '後半',
  FULL_TIME: '試合終了',
}

interface ResumePromptProps {
  savedState: AppState
  onResume: () => void
  onStartNew: () => void
}

// SPEC/Phase1_Spec_v0.2.md section 15: on reload, offer to continue an
// in-progress match rather than silently discarding it.
export function ResumePrompt({ savedState, onResume, onStartNew }: ResumePromptProps) {
  const [confirmingNew, setConfirmingNew] = useState(false)
  const homeName = displayTeamName(savedState.settings.homeTeamName, 'HOME')
  const awayName = displayTeamName(savedState.settings.awayTeamName, 'AWAY')

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-bold text-gray-900">進行中の試合があります</h1>
      <p className="text-sm text-gray-600">
        {homeName} vs {awayName}（{PHASE_LABELS[savedState.phase]}）
      </p>
      <button
        type="button"
        onClick={onResume}
        className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white active:bg-emerald-700"
      >
        続きから再開
      </button>
      <button
        type="button"
        onClick={() => setConfirmingNew(true)}
        className="w-full rounded-xl border border-gray-300 py-3 text-base text-gray-600 active:bg-gray-100"
      >
        新しい試合を始める
      </button>

      {confirmingNew && (
        <ConfirmDialog
          title="新しい試合を始めますか？"
          message="進行中の試合の記録は消えます。この操作は取り消せません。"
          confirmLabel="新しい試合を始める"
          onConfirm={() => {
            setConfirmingNew(false)
            onStartNew()
          }}
          onCancel={() => setConfirmingNew(false)}
        />
      )}
    </div>
  )
}
