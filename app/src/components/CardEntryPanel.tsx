import { useState } from 'react'
import type { CardDraft } from '../domain/matchStore'
import { countPlayerYellows } from '../domain/matchRecord'
import type { CardEvent, CardKind, Player, TeamId, TeamOfficialRole } from '../domain/types'
import { TeamDot } from './TeamBadge'

const OFFICIAL_ROLES: { value: TeamOfficialRole; label: string }[] = [
  { value: 'MANAGER', label: '監督' },
  { value: 'COACH', label: 'コーチ' },
  { value: 'STAFF', label: 'スタッフ' },
  { value: 'OTHER', label: 'その他' },
]

interface CardEntryPanelProps {
  roster: Player[]
  homeName: string
  awayName: string
  cardEvents: CardEvent[]
  initial?: CardEvent
  submitLabel: string
  onSubmit: (draft: CardDraft) => void
  onCancel: () => void
}

function teamNumbers(roster: Player[], teamId: TeamId): number[] {
  return roster
    .filter((p) => p.teamId === teamId)
    .map((p) => p.number)
    .sort((a, b) => a - b)
}

export function CardEntryPanel({
  roster,
  homeName,
  awayName,
  cardEvents,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: CardEntryPanelProps) {
  const [team, setTeam] = useState<TeamId | null>(initial ? initial.teamId : null)
  const [targetType, setTargetType] = useState<'PLAYER' | 'OFFICIAL'>(initial ? initial.targetType : 'PLAYER')
  const [playerNumber, setPlayerNumber] = useState<number | null>(initial ? initial.playerNumber : null)
  const [officialRole, setOfficialRole] = useState<TeamOfficialRole | null>(initial ? initial.officialRole : null)
  const [officialName, setOfficialName] = useState(initial ? initial.officialName : '')
  const [card, setCard] = useState<CardKind | null>(initial ? initial.card : null)

  const targetChosen = targetType === 'PLAYER' ? playerNumber !== null : officialRole !== null
  const canConfirm = team !== null && targetChosen && card !== null

  const priorYellows =
    team !== null && targetType === 'PLAYER' && playerNumber !== null
      ? countPlayerYellows(
          initial ? cardEvents.filter((c) => c.id !== initial.id) : cardEvents,
          team,
          playerNumber,
        )
      : 0

  function handleConfirm() {
    if (team === null || card === null) return
    onSubmit({
      teamId: team,
      card,
      targetType,
      playerNumber: targetType === 'PLAYER' ? playerNumber : null,
      officialRole: targetType === 'OFFICIAL' ? officialRole : null,
      officialName: targetType === 'OFFICIAL' ? officialName : '',
    })
  }

  return (
    <section className="rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-gray-900">🟨🟥 カードを記録</h3>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 underline">
          キャンセル
        </button>
      </div>

      <p className="mt-3 text-xs font-medium text-gray-500">どちらのチームですか？</p>
      <div className="mt-1 flex gap-2">
        {(['HOME', 'AWAY'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTeam(t)}
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
          <p className="mt-4 text-xs font-medium text-gray-500">対象</p>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => setTargetType('PLAYER')}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                targetType === 'PLAYER' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-700'
              }`}
            >
              選手
            </button>
            <button
              type="button"
              onClick={() => setTargetType('OFFICIAL')}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                targetType === 'OFFICIAL' ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-700'
              }`}
            >
              チーム役員
            </button>
          </div>

          {targetType === 'PLAYER' ? (
            <>
              <div className="mt-2 flex flex-wrap gap-2">
                {teamNumbers(roster, team).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPlayerNumber(n)}
                    className={`h-11 min-w-11 rounded-lg border px-3 text-lg font-bold tabular-nums ${
                      playerNumber === n
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-gray-300 bg-white text-gray-800 active:bg-gray-100'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {priorYellows > 0 && (
                <p className="mt-2 text-sm font-medium text-amber-700">
                  この選手には警告が{priorYellows}枚記録されています
                </p>
              )}
            </>
          ) : (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap gap-2">
                {OFFICIAL_ROLES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setOfficialRole(r.value)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                      officialRole === r.value
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-300 text-gray-700'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={officialName}
                onChange={(e) => setOfficialName(e.target.value)}
                placeholder="名前（任意）"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
              />
            </div>
          )}

          <p className="mt-4 text-xs font-medium text-gray-500">カード</p>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => setCard('YELLOW')}
              className={`flex-1 rounded-lg border px-3 py-3 text-base font-bold ${
                card === 'YELLOW' ? 'border-amber-500 bg-amber-100 text-amber-900' : 'border-gray-300 text-gray-700'
              }`}
            >
              🟨 警告
            </button>
            <button
              type="button"
              onClick={() => setCard('RED')}
              className={`flex-1 rounded-lg border px-3 py-3 text-base font-bold ${
                card === 'RED' ? 'border-red-600 bg-red-100 text-red-900' : 'border-gray-300 text-gray-700'
              }`}
            >
              🟥 退場
            </button>
          </div>
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
