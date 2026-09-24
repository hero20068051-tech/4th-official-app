import { useEffect, useState } from 'react'
import type { RuleSet } from '../domain/rulesets'
import type { Player, PlayerCategory, TeamId } from '../domain/types'
import { PlayerCategoryEditor } from './PlayerCategoryEditor'
import { PlayerNumberPicker } from './PlayerNumberPicker'
import { VoiceRosterEntry } from './VoiceRosterEntry'

const ERROR_DISPLAY_MS = 4000

interface TeamRosterEditorProps {
  rules: RuleSet
  maxSquadSize: number | null
  onSetCategory: (playerIds: string[], category: PlayerCategory) => string[]
  onSetUnsetCategory: (teamId: TeamId, category: PlayerCategory) => string[]
  teamId: TeamId
  teamLabel: string
  players: Player[]
  onAddPlayers: (teamId: TeamId, rawInput: string) => string[]
  onRemovePlayer: (playerId: string) => void
  onSetStarter: (playerId: string, isStarter: boolean) => string[]
  onSetRegisteredGK: (playerId: string, isRegisteredGK: boolean) => void
}

export function TeamRosterEditor({
  rules,
  maxSquadSize,
  onSetCategory,
  onSetUnsetCategory,
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
  const [voiceEntryOpen, setVoiceEntryOpen] = useState(false)
  const [otherEntryOpen, setOtherEntryOpen] = useState(false)

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
      {rules.playerCategories !== null && (
        <p className="mt-1 text-xs text-gray-700">
          {rules.playerCategories.map((o) => `${o.label} ${players.filter((p) => p.category === o.id).length}名`).join('／')}
          {players.some((p) => p.category === undefined) && (
            <span className="font-bold text-red-700">
              ／⚠未設定 {players.filter((p) => p.category === undefined).length}名
            </span>
          )}
        </p>
      )}

      <p className="mt-3 text-sm font-medium text-gray-700">背番号を選択</p>
      <PlayerNumberPicker
        maxSquadSize={maxSquadSize}
        teamId={teamId}
        existingNumbers={players.map((p) => p.number)}
        onAddPlayers={onAddPlayers}
      />

      <PlayerCategoryEditor
        rules={rules}
        players={players}
        onAssign={onSetCategory}
        onAssignUnset={(category) => onSetUnsetCategory(teamId, category)}
      />

      <button
        type="button"
        onClick={() => setOtherEntryOpen((open) => !open)}
        className="mt-3 text-sm font-medium text-gray-500 underline underline-offset-2"
      >
        {otherEntryOpen ? '他の入力方法を閉じる' : 'その他の入力方法（手入力）'}
      </button>

      {otherEntryOpen && (
        <div className="mt-2 rounded-lg border border-gray-200 p-3">
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="背番号をまとめて入力 例: 1 2 3,10"
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
          <p className="mt-1 text-xs text-gray-400">
            スペース・改行・「、」「,」のどれで区切っても構いません（例: 1 2 3,10）。
          </p>
          {errors.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-red-600">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => setVoiceEntryOpen((open) => !open)}
            className="mt-3 text-sm font-medium text-gray-400 underline underline-offset-2"
          >
            🧪 音声入力（実験的機能・推奨しません）
          </button>
          {voiceEntryOpen && (
            <>
              <p className="mt-1 text-xs text-amber-600">
                実機での確認で、発声していない番号が誤って追加されるケースが確認されています。使用する場合は登録後に必ず一覧を目視確認してください。
              </p>
              <VoiceRosterEntry teamId={teamId} onAddPlayers={onAddPlayers} onClose={() => setVoiceEntryOpen(false)} />
            </>
          )}
        </div>
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
              {rules.usesGoalkeeperRegistration && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={player.isRegisteredGK}
                  onChange={() => handleGKToggle(player)}
                  className="h-5 w-5"
                />
                GK登録
              </label>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
