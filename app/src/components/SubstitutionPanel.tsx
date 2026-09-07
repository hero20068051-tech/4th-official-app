import { useEffect, useState } from 'react'
import { describeUnavailability, MAX_REENTRY_PLAYERS, MAX_SECOND_HALF_OPPORTUNITIES } from '../domain/engine'
import { pendingConfirmationReentryPolicy } from '../domain/reentryPolicy'
import type {
  DraftPair,
  MatchState,
  Player,
  SubstitutionEvent,
  SubstitutionPhase,
  TeamDraft,
  TeamId,
} from '../domain/types'

interface SubstitutionPanelProps {
  teamId: TeamId
  teamLabel: string
  roster: Player[]
  matchState: MatchState
  phase: SubstitutionPhase
  draft: TeamDraft
  // Passed only so its *reference* can be used to detect "the history
  // changed" (confirm / delete / edit / replay) — see the clearing effect
  // below. Not read for its contents here.
  substitutionEvents: SubstitutionEvent[]
  onSetDraftPair: (teamId: TeamId, pairIndex: number, role: 'out' | 'in', playerId: string | undefined) => void
  onAddDraftPair: (teamId: TeamId) => void
  onRemoveDraftPair: (teamId: TeamId, pairIndex: number) => void
  onClearDraft: (teamId: TeamId) => void
  onConfirm: (teamId: TeamId) => string[]
}

function chipUsedElsewhere(draft: TeamDraft, pairIndex: number, playerId: string): boolean {
  return draft.pairs.some(
    (p, i) => i !== pairIndex && (p.outPlayerId === playerId || p.inPlayerId === playerId),
  )
}

export function SubstitutionPanel({
  teamId,
  teamLabel,
  roster,
  matchState,
  phase,
  draft,
  substitutionEvents,
  onSetDraftPair,
  onAddDraftPair,
  onRemoveDraftPair,
  onClearDraft,
  onConfirm,
}: SubstitutionPanelProps) {
  const teamRoster = roster.filter((p) => p.teamId === teamId).sort((a, b) => a.number - b.number)
  const pitchPlayers = teamRoster.filter((p) => matchState.players[p.id].location === 'pitch')
  const benchPlayers = teamRoster.filter((p) => matchState.players[p.id].location === 'bench')
  const counters = matchState.teamCounters[teamId]

  const hasAnySelection = draft.pairs.some((p) => p.outPlayerId || p.inPlayerId)
  const numberOf = (playerId: string) => teamRoster.find((p) => p.id === playerId)?.number
  const completePairs = draft.pairs.filter((p) => p.outPlayerId && p.inPlayerId)

  // "現在の状態から導かれる説明" — recomputed from matchState/phase every
  // render, never stored, so it can never go stale.
  const secondHalfRemaining = MAX_SECOND_HALF_OPPORTUNITIES - counters.secondHalfOpportunitiesUsed
  const isSecondHalfExhausted = phase === 'SECOND_HALF' && secondHalfRemaining <= 0
  const reentryNumbers = counters.reentryPlayerIds
    .map((id) => teamRoster.find((p) => p.id === id)?.number)
    .filter((n): n is number => n !== undefined)
    .sort((a, b) => a - b)
  const reentryExhausted = reentryNumbers.length >= MAX_REENTRY_PLAYERS

  // "一時的な操作エラー" — must not outlive the context it was shown in.
  // Cleared whenever the draft changes (a fresh selection, or "入力を取り
  // やめる"), whenever the confirmed history changes (confirm / delete /
  // edit / replay), or whenever the phase changes. Team switching is
  // handled by MatchScreen remounting this component with a `key`.
  const [transientMessage, setTransientMessage] = useState<string[] | null>(null)
  useEffect(() => {
    setTransientMessage(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, substitutionEvents, phase])

  function handleConfirm() {
    setTransientMessage(onConfirm(teamId))
  }

  return (
    <section className="rounded-xl border border-gray-200 p-4">
      <h3 className="text-base font-bold text-gray-900">{teamLabel} の交代</h3>

      {(phase === 'HALF_TIME' || phase === 'SECOND_HALF') && (
        <p className="mt-1 text-xs text-gray-500">
          {phase === 'SECOND_HALF' && <>交代 あと{Math.max(0, secondHalfRemaining)}回｜</>}
          リエントリー {reentryNumbers.length}/{MAX_REENTRY_PLAYERS}名
          {reentryNumbers.length > 0 && <>（{reentryNumbers.join('・')}）</>}
        </p>
      )}

      {isSecondHalfExhausted && (
        <p className="mt-2 rounded-lg bg-gray-100 p-2 text-sm font-medium text-gray-700">
          後半の交代を{MAX_SECOND_HALF_OPPORTUNITIES}回使っています
        </p>
      )}
      {!isSecondHalfExhausted && reentryExhausted && (phase === 'HALF_TIME' || phase === 'SECOND_HALF') && (
        <p className="mt-2 rounded-lg bg-gray-100 p-2 text-sm font-medium text-gray-700">
          リエントリー{MAX_REENTRY_PLAYERS}名を使用済みのため、これ以上のリエントリーはできません
        </p>
      )}

      <div className="mt-3 space-y-4">
        {draft.pairs.map((pair, pairIndex) => (
          <PairEditor
            // biome-ignore lint: stable index key is fine, pairs are only appended/removed at the end of user actions
            key={pairIndex}
            pair={pair}
            pairIndex={pairIndex}
            teamId={teamId}
            phase={phase}
            matchState={matchState}
            teamRoster={teamRoster}
            pitchPlayers={pitchPlayers}
            benchPlayers={benchPlayers}
            draft={draft}
            canRemove={draft.pairs.length > 1}
            locked={isSecondHalfExhausted}
            onSetDraftPair={onSetDraftPair}
            onRemoveDraftPair={onRemoveDraftPair}
            onBlocked={(reason) => setTransientMessage([reason])}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAddDraftPair(teamId)}
          disabled={isSecondHalfExhausted}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 disabled:border-gray-200 disabled:text-gray-300 active:bg-gray-100"
        >
          ＋もう1組
        </button>
        {hasAnySelection && (
          <button
            type="button"
            onClick={() => onClearDraft(teamId)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-500 active:bg-gray-100"
          >
            入力を取りやめる
          </button>
        )}
      </div>

      {completePairs.length > 0 && (
        <p className="mt-3 text-sm text-gray-600">
          {completePairs.map((p) => `${numberOf(p.outPlayerId!)}番 → ${numberOf(p.inPlayerId!)}番`).join('、 ')}
          {' '}を交代します
        </p>
      )}

      {transientMessage && transientMessage.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-red-600">
          {transientMessage.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={!hasAnySelection || isSecondHalfExhausted}
        className="mt-4 w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white disabled:bg-gray-300 active:bg-blue-700"
      >
        交代を確定
      </button>
    </section>
  )
}

interface PairEditorProps {
  pair: DraftPair
  pairIndex: number
  teamId: TeamId
  phase: SubstitutionPhase
  matchState: MatchState
  teamRoster: Player[]
  pitchPlayers: Player[]
  benchPlayers: Player[]
  draft: TeamDraft
  canRemove: boolean
  locked: boolean
  onSetDraftPair: (teamId: TeamId, pairIndex: number, role: 'out' | 'in', playerId: string | undefined) => void
  onRemoveDraftPair: (teamId: TeamId, pairIndex: number) => void
  onBlocked: (reason: string) => void
}

// Disabled buttons never receive taps on a touchscreen, so a hover-only
// title tooltip is invisible on the phones this app is built for. Chips stay
// tappable; tapping a blocked one reports the reason up to the panel instead
// of making the selection (LOCKED principle: show the reason for an
// unavailable player, not just grey it out). The only case chips are made
// genuinely inert (`locked`) is when the whole team is out of second-half
// substitutions — that reason is already shown as a standing banner above,
// so nothing is hidden by disabling here.
function PairEditor({
  pair,
  pairIndex,
  teamId,
  phase,
  matchState,
  teamRoster,
  pitchPlayers,
  benchPlayers,
  draft,
  canRemove,
  locked,
  onSetDraftPair,
  onRemoveDraftPair,
  onBlocked,
}: PairEditorProps) {
  function handleChipTap(role: 'out' | 'in', playerId: string, blockedReason: string | null, selected: boolean) {
    if (locked) return
    if (blockedReason) {
      onBlocked(blockedReason)
      return
    }
    onSetDraftPair(teamId, pairIndex, role, selected ? undefined : playerId)
  }

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">組 {pairIndex + 1}</span>
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemoveDraftPair(teamId, pairIndex)}
            disabled={locked}
            className="text-xs text-gray-400 underline disabled:no-underline disabled:text-gray-300"
          >
            この組を削除
          </button>
        )}
      </div>

      <p className="mt-2 text-xs font-medium text-gray-500">OUT（今ピッチにいる選手）</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {pitchPlayers.map((player) => {
          const blockedReason = chipUsedElsewhere(draft, pairIndex, player.id)
            ? '同じ選手を2つの交代に入れることはできません'
            : null
          const selected = pair.outPlayerId === player.id
          return (
            <button
              key={player.id}
              type="button"
              disabled={locked}
              aria-pressed={selected}
              onClick={() => handleChipTap('out', player.id, blockedReason, selected)}
              className={`h-11 min-w-11 rounded-lg border px-3 text-lg font-bold tabular-nums ${
                selected
                  ? 'border-red-600 bg-red-600 text-white'
                  : locked || blockedReason
                    ? 'border-gray-200 text-gray-300'
                    : 'border-gray-300 bg-white text-gray-800 active:bg-gray-100'
              }`}
            >
              {player.number}
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-xs font-medium text-gray-500">IN（今ベンチにいる選手）</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {benchPlayers.map((player) => {
          const blockedReason = chipUsedElsewhere(draft, pairIndex, player.id)
            ? '同じ選手を2つの交代に入れることはできません'
            : describeUnavailability(matchState, teamRoster, teamId, phase, player.id, pendingConfirmationReentryPolicy)
          const selected = pair.inPlayerId === player.id
          return (
            <button
              key={player.id}
              type="button"
              disabled={locked}
              aria-pressed={selected}
              onClick={() => handleChipTap('in', player.id, blockedReason, selected)}
              className={`h-11 min-w-11 rounded-lg border px-3 text-lg font-bold tabular-nums ${
                selected
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : locked || blockedReason
                    ? 'border-gray-200 text-gray-300'
                    : 'border-gray-300 bg-white text-gray-800 active:bg-gray-100'
              }`}
            >
              {player.number}
            </button>
          )
        })}
      </div>
    </div>
  )
}
