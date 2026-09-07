import { useEffect, useState } from 'react'
import type { Player, TeamId } from '../domain/types'

const ERROR_DISPLAY_MS = 4000

interface TeamRosterEditorProps {
  teamId: TeamId
  teamLabel: string
  players: Player[]
  onAddPlayers: (teamId: TeamId, rawInput: string) => string[]
  onRemovePlayer: (playerId: string) => void
  onSetStarter: (playerId: string, isStarter: boolean) => string[]
  onSetRegisteredGK: (playerId: string, isRegisteredGK: boolean) => void
}

export function TeamRosterEditor({
  teamId,
  teamLabel,
  players,
  onAddPlayers,
  onRemovePlayer,
  onSetStarter,
  onSetRegisteredGK,
}: TeamRosterEditorProps) {
  const [input, setInput] = useState('')
  const [errors, setErrors] = useState<string[]>([])

  const sorted = [...players].sort((a, b) => a.number - b.number)
  const starterCount = players.filter((p) => p.isStarter).length

  // A blocked action (e.g. trying to pick an 11th+1 starter) is momentary
  // guidance, not a standing problem with the current, valid state — so it
  // fades on its own, and any further normal action clears it immediately
  // rather than leaving a stale warning next to an already-fine roster.
  useEffect(() => {
    if (errors.length === 0) return
    const timer = setTimeout(() => setErrors([]), ERROR_DISPLAY_MS)
    return () => clearTimeout(timer)
  }, [errors])

  function handleAdd() {
    const addErrors = onAddPlayers(teamId, input)
    setErrors(addErrors)
    if (addErrors.length === 0) setInput('')
  }

  function handleStarterToggle(player: Player) {
    const toggleErrors = onSetStarter(player.id, !player.isStarter)
    setErrors(toggleErrors)
  }

  function handleRemove(playerId: string) {
    setErrors([])
    onRemovePlayer(playerId)
  }

  function handleGKToggle(player: Player) {
    setErrors([])
    onSetRegisteredGK(player.id, !player.isRegisteredGK)
  }

  return (
    <section
      className={`rounded-xl border-2 p-4 ${teamId === 'HOME' ? 'border-blue-300 bg-blue-50/40' : 'border-orange-300 bg-orange-50/40'}`}
    >
      <h2 className="text-base font-bold text-gray-900">
        {teamLabel}
        <span className="ml-2 text-sm font-normal text-gray-500">
          登録{players.length}名 / 先発{starterCount}名
        </span>
      </h2>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="背番号をまとめて入力 例: 1,2,3,10"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-3 text-base"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="shrink-0 rounded-lg bg-gray-900 px-4 py-3 text-base font-medium text-white active:bg-gray-700"
        >
          追加
        </button>
      </div>
      {errors.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-red-600">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {sorted.map((player) => (
          <li key={player.id} className="rounded-lg border border-gray-200 bg-white p-2">
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold tabular-nums text-gray-900">{player.number}</span>
              <button
                type="button"
                onClick={() => handleRemove(player.id)}
                aria-label={`${player.number}番を削除`}
                className="rounded px-2 py-1 text-sm text-gray-400 active:bg-gray-100"
              >
                削除
              </button>
            </div>
            <div className="mt-1 flex flex-col gap-1 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={player.isStarter}
                  onChange={() => handleStarterToggle(player)}
                  className="h-5 w-5"
                />
                先発
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={player.isRegisteredGK}
                  onChange={() => handleGKToggle(player)}
                  className="h-5 w-5"
                />
                GK登録
              </label>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
