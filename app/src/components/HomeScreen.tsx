import { useState } from 'react'
import { loadArchive } from '../domain/matchArchive'
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

interface HomeScreenProps {
  // The match currently in the app's single working slot, if it is worth
  // offering (in progress, or just finished). null = nothing to resume.
  current: AppState | null
  onResume: () => void
  onStartNew: () => void
  onOpenArchive: () => void
}

// Top screen. Deliberately just buttons: the everyday actions are big and
// first; "past matches" is a quieter, smaller entry one level in — no lists,
// counts or delete buttons live here.
export function HomeScreen({ current, onResume, onStartNew, onOpenArchive }: HomeScreenProps) {
  const [confirmingNew, setConfirmingNew] = useState(false)

  const finished = current?.phase === 'FULL_TIME'
  // A finished match is already kept in "past matches", so starting a new one
  // loses nothing. Anything else in progress would be discarded — ask first.
  const startingNewDiscards = current !== null && !(finished && loadArchive().some((e) => e.id === current.matchId))

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      {current ? (
        <>
          <h1 className="text-xl font-bold text-gray-900">{finished ? '試合は終了しています' : '進行中の試合があります'}</h1>
          <p className="text-sm text-gray-600">
            {displayTeamName(current.settings.homeTeamName, 'HOME')} vs {displayTeamName(current.settings.awayTeamName, 'AWAY')}（
            {PHASE_LABELS[current.phase]}）
          </p>
          <button
            type="button"
            onClick={onResume}
            className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white active:bg-emerald-700"
          >
            {finished ? '終了した試合を開く' : '試合を再開する'}
          </button>
          <button
            type="button"
            onClick={() => (startingNewDiscards ? setConfirmingNew(true) : onStartNew())}
            className="w-full rounded-xl border border-gray-300 py-3 text-base text-gray-700 active:bg-gray-100"
          >
            新しい試合を始める
          </button>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold text-gray-900">第4審判 交代管理</h1>
          <button
            type="button"
            onClick={onStartNew}
            className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white active:bg-emerald-700"
          >
            新しい試合を始める
          </button>
        </>
      )}

      <button
        type="button"
        onClick={onOpenArchive}
        className="mt-2 rounded-lg border border-gray-200 px-6 py-2 text-sm text-gray-500 active:bg-gray-100"
      >
        過去の試合
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
