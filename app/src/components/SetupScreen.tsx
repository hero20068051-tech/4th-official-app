import { useState } from 'react'
import { checkStartLineups, displayTeamName, HYDRATION_MODE_LABELS, isValidHalfLength } from '../domain/matchSetup'
import type { HydrationMode, MatchSettings } from '../domain/matchTypes'
import type { TeamId } from '../domain/types'
import { ruleSetOf } from '../domain/rulesets'
import { StarterShortageDialog } from './StarterShortageDialog'
import { TeamRosterEditor } from './TeamRosterEditor'
import type { AppState } from '../domain/matchStore'

const HALF_LENGTH_PRESETS = [30, 35]

interface SetupScreenProps {
  state: AppState
  onUpdateSettings: (partial: Partial<MatchSettings>) => void
  onAddPlayers: (teamId: TeamId, rawInput: string) => string[]
  onRemovePlayer: (playerId: string) => void
  onSetStarter: (playerId: string, isStarter: boolean) => string[]
  onSetRegisteredGK: (playerId: string, isRegisteredGK: boolean) => void
  onStartMatch: () => void
  // Only given when there is something behind the top screen (past matches).
  onOpenHome?: () => void
}

export function SetupScreen({
  state,
  onUpdateSettings,
  onAddPlayers,
  onRemovePlayer,
  onSetStarter,
  onSetRegisteredGK,
  onStartMatch,
  onOpenHome,
}: SetupScreenProps) {
  const [lineupDialog, setLineupDialog] = useState<
    { mode: 'CONFIRM' | 'BLOCK'; teams: { label: string; count: number }[] } | null
  >(null)
  const [customHalfLength, setCustomHalfLength] = useState(
    HALF_LENGTH_PRESETS.includes(state.settings.halfLengthMinutes) ? '' : String(state.settings.halfLengthMinutes),
  )
  const isCustomActive =
    customHalfLength !== '' &&
    isValidHalfLength(Number(customHalfLength)) &&
    state.settings.halfLengthMinutes === Number(customHalfLength)

  const rules = ruleSetOf(state.settings)
  const homePlayers = state.roster.filter((p) => p.teamId === 'HOME')
  const awayPlayers = state.roster.filter((p) => p.teamId === 'AWAY')

  function handleStartClick() {
    const check = checkStartLineups({
      HOME: homePlayers.filter((p) => p.isStarter).length,
      AWAY: awayPlayers.filter((p) => p.isStarter).length,
    }, rules)
    if (check.level === 'OK') {
      onStartMatch()
      return
    }
    // 7-10 starters: never start straight away — a full-screen dialog makes
    // the operator read the count first. 6 or fewer: the same dialog, with
    // no way to proceed.
    setLineupDialog({
      mode: check.level,
      teams: check.teams.map((t) => ({
        label: displayTeamName(t.teamId === 'HOME' ? state.settings.homeTeamName : state.settings.awayTeamName, t.teamId),
        count: t.count,
      })),
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-28">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">試合前設定</h1>
        {onOpenHome && (
          <button type="button" onClick={onOpenHome} className="px-1 py-1 text-xs text-gray-400 underline">
            トップへ
          </button>
        )}
      </div>

      <section className="space-y-3 rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            HOMEチーム名
            <input
              type="text"
              value={state.settings.homeTeamName}
              onChange={(e) => onUpdateSettings({ homeTeamName: e.target.value })}
              placeholder="HOME"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
            />
          </label>
          <label className="block text-sm">
            AWAYチーム名
            <input
              type="text"
              value={state.settings.awayTeamName}
              onChange={(e) => onUpdateSettings({ awayTeamName: e.target.value })}
              placeholder="AWAY"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
            />
          </label>
        </div>

        <div>
          <span className="block text-sm">ハーフ時間</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {HALF_LENGTH_PRESETS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => {
                  setCustomHalfLength('')
                  onUpdateSettings({ halfLengthMinutes: minutes })
                }}
                className={`rounded-lg border px-4 py-2 text-base ${
                  state.settings.halfLengthMinutes === minutes && customHalfLength === ''
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-300 text-gray-700'
                }`}
              >
                {minutes}分
              </button>
            ))}
            <div className="relative">
              <input
                type="number"
                min={1}
                value={customHalfLength}
                onChange={(e) => {
                  setCustomHalfLength(e.target.value)
                  const n = Number(e.target.value)
                  if (isValidHalfLength(n)) onUpdateSettings({ halfLengthMinutes: n })
                }}
                placeholder="その他(分)"
                className={`w-28 rounded-lg border px-3 py-2 pr-7 text-base ${
                  isCustomActive ? 'border-gray-900 bg-gray-50 font-semibold text-gray-900' : 'border-gray-300'
                }`}
              />
              {isCustomActive && (
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-gray-900">✓</span>
              )}
            </div>
          </div>
        </div>

        <div>
          <span className="block text-sm">飲水</span>
          <div className="mt-1 flex flex-col gap-2">
            {(Object.keys(HYDRATION_MODE_LABELS) as HydrationMode[]).map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-base">
                <input
                  type="radio"
                  name="hydrationMode"
                  checked={state.settings.hydrationMode === mode}
                  onChange={() => onUpdateSettings({ hydrationMode: mode })}
                  className="h-5 w-5"
                />
                {HYDRATION_MODE_LABELS[mode]}
              </label>
            ))}
          </div>
          {state.settings.hydrationMode !== 'NONE' && (
            <input
              type="text"
              value={state.settings.hydrationMemo}
              onChange={(e) => onUpdateSettings({ hydrationMemo: e.target.value })}
              placeholder="任意メモ 例: 15分頃"
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
            />
          )}
        </div>
      </section>

      <TeamRosterEditor
        maxSquadSize={rules.maxSquadSize}
        teamId="HOME"
        teamLabel={state.settings.homeTeamName.trim() || 'HOME'}
        players={homePlayers}
        onAddPlayers={onAddPlayers}
        onRemovePlayer={onRemovePlayer}
        onSetStarter={onSetStarter}
        onSetRegisteredGK={onSetRegisteredGK}
      />
      <TeamRosterEditor
        maxSquadSize={rules.maxSquadSize}
        teamId="AWAY"
        teamLabel={state.settings.awayTeamName.trim() || 'AWAY'}
        players={awayPlayers}
        onAddPlayers={onAddPlayers}
        onRemovePlayer={onRemovePlayer}
        onSetStarter={onSetStarter}
        onSetRegisteredGK={onSetRegisteredGK}
      />

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white p-4 will-change-transform">
        <button
          type="button"
          onClick={handleStartClick}
          className="mx-auto block w-full max-w-2xl rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white active:bg-emerald-700"
        >
          前半開始
        </button>
      </div>

      {lineupDialog && (
        <StarterShortageDialog
          mode={lineupDialog.mode}
          action="start"
          teams={lineupDialog.teams}
          onBack={() => setLineupDialog(null)}
          onProceed={() => {
            setLineupDialog(null)
            onStartMatch()
          }}
        />
      )}
    </div>
  )
}
