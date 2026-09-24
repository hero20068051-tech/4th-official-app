import { useState } from 'react'
import {
  MAX_REASONABLE_ELAPSED_MS,
  computeElapsedMs,
  formatElapsed,
  parseElapsedInput,
  startedAtForElapsed,
} from '../domain/clock'
import { isMatchArchived } from '../domain/matchArchive'
import { ruleSetOf } from '../domain/rulesets'
import { deriveScore } from '../domain/matchRecord'
import {
  displayTeamName,
  isNearHydrationTarget,
  isPastHydrationTarget,
  parseHydrationTargetMinutes,
} from '../domain/matchSetup'
import type { HalfKey } from '../domain/matchTypes'
import {
  type AppState,
  type CardDraft,
  type GoalDraft,
  type GoalTimeEdit,
  canCorrectStarters,
  canMoveSubstitutionToHalfTime,
  canMoveSubstitutionToSecondHalf,
  previewMoveSubstitutionPairsToSecondHalf,
  type SecondHalfMove,
  getDerivedMatchState,
  previewMoveSubstitutionToHalfTime,
} from '../domain/matchStore'
import type { RecordablePhase, SubstitutionPair, SubstitutionPhase, TeamId } from '../domain/types'
import { useNow } from '../hooks/useNow'
import { CardEntryPanel } from './CardEntryPanel'
import { ConfirmDialog } from './ConfirmDialog'
import { GoalEntryPanel } from './GoalEntryPanel'
import { MatchTimeline } from './MatchTimeline'
import { StarterCorrectionPanel } from './StarterCorrectionPanel'
import { SubstitutionPanel } from './SubstitutionPanel'
import { TeamDot } from './TeamBadge'

const PHASE_LABELS: Record<AppState['phase'], string> = {
  PRE_MATCH: '試合前',
  FIRST_HALF: '前半',
  HALF_TIME: 'ハーフタイム',
  SECOND_HALF: '後半',
  FULL_TIME: '試合終了',
}

interface MatchScreenProps {
  state: AppState
  onEndFirstHalf: () => void
  onStartSecondHalf: () => void
  onEndMatch: () => void
  onStartHydrationPause: () => void
  onEndHydrationPause: () => void
  onCorrectHalfStart: (half: HalfKey, correctedAt: number) => void
  onCorrectStarters: (teamId: TeamId, starterPlayerIds: string[]) => string[]
  onSetDraftPair: (teamId: TeamId, pairIndex: number, role: 'out' | 'in', playerId: string | undefined) => void
  onAddDraftPair: (teamId: TeamId) => void
  onRemoveDraftPair: (teamId: TeamId, pairIndex: number) => void
  onClearDraft: (teamId: TeamId) => void
  onConfirmDraft: (teamId: TeamId) => string[]
  onDeleteSubstitutionEvent: (eventId: string) => void
  onUpdateSubstitutionEventPairs: (eventId: string, pairs: SubstitutionPair[]) => void
  onLinkStoppage: (eventId: string) => void
  onUnlinkStoppage: (eventId: string) => void
  onMoveSubstitutionToHalfTime: (eventId: string) => void
  onMoveSubstitutionToSecondHalf: (eventId: string, moves: SecondHalfMove[]) => string[]
  onMarkHydrationCompleted: (half: HalfKey, elapsedMs: number) => void
  onRecordGoal: (draft: GoalDraft, phase: RecordablePhase, elapsedMs: number) => void
  onUpdateGoal: (goalId: string, draft: GoalDraft, time?: GoalTimeEdit) => void
  onDeleteGoal: (goalId: string) => void
  onRecordCard: (draft: CardDraft, phase: RecordablePhase, elapsedMs: number) => void
  onUpdateCard: (cardId: string, draft: CardDraft) => void
  onDeleteCard: (cardId: string) => void
  onStartNewMatch: () => void
  onOpenHome: () => void
}

export function MatchScreen({
  state,
  onEndFirstHalf,
  onStartSecondHalf,
  onEndMatch,
  onStartHydrationPause,
  onEndHydrationPause,
  onCorrectHalfStart,
  onCorrectStarters,
  onSetDraftPair,
  onAddDraftPair,
  onRemoveDraftPair,
  onClearDraft,
  onConfirmDraft,
  onDeleteSubstitutionEvent,
  onUpdateSubstitutionEventPairs,
  onLinkStoppage,
  onUnlinkStoppage,
  onMoveSubstitutionToHalfTime,
  onMoveSubstitutionToSecondHalf,
  onMarkHydrationCompleted,
  onRecordGoal,
  onUpdateGoal,
  onDeleteGoal,
  onRecordCard,
  onUpdateCard,
  onDeleteCard,
  onStartNewMatch,
  onOpenHome,
}: MatchScreenProps) {
  const now = useNow()
  const [confirmAction, setConfirmAction] = useState<'END_FIRST_HALF' | 'END_MATCH' | 'START_NEW' | null>(null)
  const [confirmingEarlyHydration, setConfirmingEarlyHydration] = useState(false)
  const [activeTeam, setActiveTeam] = useState<TeamId>('HOME')
  const [entryPanel, setEntryPanel] = useState<'goal' | 'card' | null>(null)
  const [correctingStarters, setCorrectingStarters] = useState(false)

  const elapsedMs = computeElapsedMs(state.clock, state.phase, now)
  const isPaused = state.clock.activePauseStartedAt !== null
  const isMidHalf = state.phase === 'FIRST_HALF' || state.phase === 'SECOND_HALF'
  const regulationTimePassed = isMidHalf && elapsedMs >= state.settings.halfLengthMinutes * 60_000
  const elapsedLooksWrong = isMidHalf && elapsedMs > MAX_REASONABLE_ELAPSED_MS

  // Only pops the correction panel open by default when a resumed match's
  // stored timestamps already look wrong — never re-opens itself later just
  // because the operator collapsed it.
  const [showCorrection, setShowCorrection] = useState(
    () => (state.phase === 'FIRST_HALF' || state.phase === 'SECOND_HALF') && elapsedMs > MAX_REASONABLE_ELAPSED_MS,
  )

  const rules = ruleSetOf(state.settings)
  const secondHalfLimit = rules.secondHalfOpportunityLimit
  const homeName = displayTeamName(state.settings.homeTeamName, 'HOME')
  const awayName = displayTeamName(state.settings.awayTeamName, 'AWAY')

  const currentHalf: HalfKey | null =
    state.phase === 'FIRST_HALF' ? 'firstHalf' : state.phase === 'SECOND_HALF' ? 'secondHalf' : null

  const { state: matchState, needsReview } = getDerivedMatchState(state)
  const canSubstitute = state.phase === 'FIRST_HALF' || state.phase === 'HALF_TIME' || state.phase === 'SECOND_HALF'

  const hydrationCompleted = currentHalf ? Boolean(state.hydrationCompletedByHalf?.[currentHalf]) : false
  const hydrationTargetMinutes = parseHydrationTargetMinutes(state.settings.hydrationMemo)
  const isNearHydration =
    !hydrationCompleted &&
    hydrationTargetMinutes !== null &&
    isMidHalf &&
    isNearHydrationTarget(elapsedMs, hydrationTargetMinutes)
  const isPastHydration =
    !hydrationCompleted &&
    hydrationTargetMinutes !== null &&
    isMidHalf &&
    isPastHydrationTarget(elapsedMs, hydrationTargetMinutes)
  // A target is set and it's still more than ~1 minute away — pressing
  // "飲水を実施" here is unexpected (early or a mistap), so it asks first
  // instead of silently trusting it. With no parseable target at all, or
  // once within the normal 1-minute-before window, one tap is enough.
  const isWellBeforeHydrationTarget =
    hydrationTargetMinutes !== null && isMidHalf && !isNearHydration && !isPastHydration && !hydrationCompleted

  const score = deriveScore(state.goalEvents)
  // Fresh elapsed time at the moment an event is confirmed (not the 1-second
  // useNow tick, which can be stale if a panel was open a while).
  const recordablePhase = state.phase as RecordablePhase
  const currentElapsedMs = () => computeElapsedMs(state.clock, state.phase, Date.now())

  function handleHydrationDoneClick() {
    if (!currentHalf) return
    if (isWellBeforeHydrationTarget) {
      setConfirmingEarlyHydration(true)
      return
    }
    onMarkHydrationCompleted(currentHalf, currentElapsedMs())
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-28">
      <section className="rounded-xl border border-gray-200 p-4 text-center">
        <p className="text-sm font-medium text-gray-500">
          {PHASE_LABELS[state.phase]}
          {isMidHalf && <>｜{state.settings.halfLengthMinutes}分ハーフ</>}
        </p>
        <p className="mt-1 text-5xl font-bold tabular-nums text-gray-900">{formatElapsed(elapsedMs)}</p>
        <div className="mt-2 flex items-center justify-center gap-3 text-xl font-bold text-gray-900">
          <span className="flex items-center gap-1.5">
            <TeamDot teamId="HOME" />
            {homeName}
          </span>
          <span className="tabular-nums">
            {score.HOME} - {score.AWAY}
          </span>
          <span className="flex items-center gap-1.5">
            {awayName}
            <TeamDot teamId="AWAY" />
          </span>
        </div>
        {isPaused && <p className="mt-1 text-sm font-medium text-amber-600">飲水のため時計を止めています</p>}
        {regulationTimePassed && (
          <p className="mt-1 text-sm text-gray-500">規定時間{state.settings.halfLengthMinutes}分を経過</p>
        )}
        {elapsedLooksWrong && (
          <p className="mt-1 text-sm font-medium text-amber-700">
            経過時間が長すぎるようです。下の「今の試合時間に合わせる」から確認してください。
          </p>
        )}
      </section>

      {state.settings.hydrationMode !== 'NONE' && isMidHalf && currentHalf && (
        <section className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          {hydrationCompleted ? (
            <p className="font-semibold">💧 飲水済み</p>
          ) : isPastHydration ? (
            <p className="font-semibold">💧 飲水の目安時刻です</p>
          ) : isNearHydration ? (
            <p className="font-semibold">💧 まもなく飲水の目安です</p>
          ) : (
            <p>
              💧 飲水あり
              {state.settings.hydrationMemo.trim() && <>｜{state.settings.hydrationMemo.trim()}</>}
            </p>
          )}
          {state.settings.hydrationMode === 'RUNNING_CLOCK' && !hydrationCompleted && (
            <button
              type="button"
              onClick={handleHydrationDoneClick}
              className="mt-2 rounded-lg border border-sky-400 px-3 py-1.5 text-sm font-medium text-sky-800 active:bg-sky-100"
            >
              飲水を実施
            </button>
          )}
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="rounded-xl border-2 border-blue-300 bg-blue-50/40 p-3">
          <p className="text-sm font-bold text-gray-800">{homeName}</p>
          {state.phase === 'SECOND_HALF' && secondHalfLimit !== null && (
            <p className="mt-1 text-xs text-gray-600">
              後半の交代 あと{Math.max(0, secondHalfLimit - matchState.teamCounters.HOME.secondHalfOpportunitiesUsed)}回
            </p>
          )}
        </div>
        <div className="rounded-xl border-2 border-orange-300 bg-orange-50/40 p-3">
          <p className="text-sm font-bold text-gray-800">{awayName}</p>
          {state.phase === 'SECOND_HALF' && secondHalfLimit !== null && (
            <p className="mt-1 text-xs text-gray-600">
              後半の交代 あと{Math.max(0, secondHalfLimit - matchState.teamCounters.AWAY.secondHalfOpportunitiesUsed)}回
            </p>
          )}
        </div>
      </div>

      {state.settings.hydrationMode === 'STOP_CLOCK' && isMidHalf && (
        <button
          type="button"
          onClick={isPaused ? onEndHydrationPause : onStartHydrationPause}
          className={`w-full rounded-xl py-3 text-base font-semibold ${
            isPaused ? 'bg-amber-600 text-white active:bg-amber-700' : 'border border-amber-400 text-amber-700 active:bg-amber-50'
          }`}
        >
          {isPaused ? '試合再開' : '飲水開始'}
        </button>
      )}

      {/* 得点 only while the ball can be in play; カード any time the match
          screen is up, including at half-time and after the final whistle. */}
      <div className="flex gap-2">
        {isMidHalf && (
          <button
            type="button"
            onClick={() => setEntryPanel(entryPanel === 'goal' ? null : 'goal')}
            className={`flex-1 rounded-xl py-3 text-base font-bold ${
              entryPanel === 'goal' ? 'bg-blue-600 text-white' : 'border border-blue-400 text-blue-700 active:bg-blue-50'
            }`}
          >
            ⚽ 得点
          </button>
        )}
        <button
          type="button"
          onClick={() => setEntryPanel(entryPanel === 'card' ? null : 'card')}
          className={`flex-1 rounded-xl py-3 text-base font-bold ${
            entryPanel === 'card' ? 'bg-gray-900 text-white' : 'border border-gray-400 text-gray-700 active:bg-gray-100'
          }`}
        >
          🟨🟥 カード
        </button>
      </div>

      {entryPanel === 'goal' && isMidHalf && (
        <GoalEntryPanel
          roster={state.roster}
          homeName={homeName}
          awayName={awayName}
          submitLabel="得点を確定"
          onSubmit={(draft) => {
            onRecordGoal(draft, recordablePhase, currentElapsedMs())
            setEntryPanel(null)
          }}
          onCancel={() => setEntryPanel(null)}
        />
      )}

      {entryPanel === 'card' && (
        <CardEntryPanel
          roster={state.roster}
          homeName={homeName}
          awayName={awayName}
          cardEvents={state.cardEvents}
          submitLabel="カードを確定"
          onSubmit={(draft) => {
            onRecordCard(draft, recordablePhase, currentElapsedMs())
            setEntryPanel(null)
          }}
          onCancel={() => setEntryPanel(null)}
        />
      )}

      {canSubstitute && (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveTeam('HOME')
                setCorrectingStarters(false)
              }}
              className={`flex-1 rounded-lg py-2 text-sm font-bold ${
                activeTeam === 'HOME' ? 'bg-blue-600 text-white' : 'border border-blue-300 text-blue-700'
              }`}
            >
              {homeName}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTeam('AWAY')
                setCorrectingStarters(false)
              }}
              className={`flex-1 rounded-lg py-2 text-sm font-bold ${
                activeTeam === 'AWAY' ? 'bg-orange-600 text-white' : 'border border-orange-300 text-orange-700'
              }`}
            >
              {awayName}
            </button>
          </div>

          {canCorrectStarters(state, activeTeam) && !correctingStarters && (
            <button
              type="button"
              onClick={() => setCorrectingStarters(true)}
              className="text-sm font-medium text-gray-500 underline underline-offset-2"
            >
              先発設定を修正（最初の交代前のみ）
            </button>
          )}

          {correctingStarters && canCorrectStarters(state, activeTeam) ? (
            <StarterCorrectionPanel
              rules={rules}
              key={activeTeam}
              teamId={activeTeam}
              teamLabel={activeTeam === 'HOME' ? homeName : awayName}
              players={state.roster.filter((p) => p.teamId === activeTeam)}
              onConfirm={(teamId, ids) => {
                const errors = onCorrectStarters(teamId, ids)
                if (errors.length === 0) setCorrectingStarters(false)
                return errors
              }}
              onCancel={() => setCorrectingStarters(false)}
            />
          ) : (
            <SubstitutionPanel
              rules={rules}
              // Remounts on team switch so no leftover per-team warning can
              // survive the switch (see SubstitutionPanel's own clearing effect
              // for same-team clearing triggers).
              key={activeTeam}
              teamId={activeTeam}
              teamLabel={activeTeam === 'HOME' ? homeName : awayName}
              roster={state.roster}
              matchState={matchState}
              phase={state.phase as SubstitutionPhase}
              draft={state.drafts[activeTeam]}
              substitutionEvents={state.substitutionEvents}
              onSetDraftPair={onSetDraftPair}
              onAddDraftPair={onAddDraftPair}
              onRemoveDraftPair={onRemoveDraftPair}
              onClearDraft={onClearDraft}
              onConfirm={onConfirmDraft}
            />
          )}
        </>
      )}

      <MatchTimeline
        substitutionEvents={state.substitutionEvents}
        goalEvents={state.goalEvents}
        cardEvents={state.cardEvents}
        clock={state.clock}
        hydrationCompletionElapsedMsByHalf={state.hydrationCompletionElapsedMsByHalf}
        roster={state.roster}
        needsReview={needsReview}
        teamLabels={{ HOME: homeName, AWAY: awayName }}
        onDeleteSubstitution={onDeleteSubstitutionEvent}
        onUpdateSubstitutionPairs={onUpdateSubstitutionEventPairs}
        onLinkStoppage={onLinkStoppage}
        onUnlinkStoppage={onUnlinkStoppage}
        canMoveToHalfTime={(eventId) => canMoveSubstitutionToHalfTime(state, eventId)}
        previewMoveToHalfTime={(eventId) => previewMoveSubstitutionToHalfTime(state, eventId).newlyNeedingReview}
        onMoveToHalfTime={onMoveSubstitutionToHalfTime}
        canMoveToSecondHalf={(eventId) => canMoveSubstitutionToSecondHalf(state, eventId)}
        previewMoveToSecondHalf={(eventId, moves) => previewMoveSubstitutionPairsToSecondHalf(state, eventId, moves)}
        onMoveToSecondHalf={onMoveSubstitutionToSecondHalf}
        onEditGoal={onUpdateGoal}
        onDeleteGoal={onDeleteGoal}
        onEditCard={onUpdateCard}
        onDeleteCard={onDeleteCard}
      />

      <details
        open={showCorrection}
        onToggle={(e) => setShowCorrection((e.target as HTMLDetailsElement).open)}
        className="rounded-lg border border-gray-200 p-3 text-sm text-gray-500"
      >
        <summary className="cursor-pointer select-none">今の試合時間に合わせる</summary>
        {currentHalf && (
          <HalfStartCorrectionForm half={currentHalf} now={now} onApply={onCorrectHalfStart} />
        )}
      </details>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white p-4 will-change-transform">
        {state.phase === 'FIRST_HALF' && (
          <button
            type="button"
            onClick={() => setConfirmAction('END_FIRST_HALF')}
            className="mx-auto block w-full max-w-2xl rounded-xl bg-gray-900 py-4 text-lg font-bold text-white active:bg-gray-700"
          >
            前半終了
          </button>
        )}
        {state.phase === 'HALF_TIME' && (
          <button
            type="button"
            onClick={onStartSecondHalf}
            className="mx-auto block w-full max-w-2xl rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white active:bg-emerald-700"
          >
            後半開始
          </button>
        )}
        {state.phase === 'SECOND_HALF' && (
          <button
            type="button"
            onClick={() => setConfirmAction('END_MATCH')}
            className="mx-auto block w-full max-w-2xl rounded-xl bg-gray-900 py-4 text-lg font-bold text-white active:bg-gray-700"
          >
            試合終了
          </button>
        )}
        {state.phase === 'FULL_TIME' && (
          <div className="mx-auto max-w-2xl space-y-2 text-center">
            <p className="text-base font-semibold text-gray-700">試合は終了しました</p>
            <button
              type="button"
              onClick={() => setConfirmAction('START_NEW')}
              className="w-full rounded-xl border border-gray-300 py-3 text-base text-gray-600 active:bg-gray-100"
            >
              新しい試合を始める
            </button>
            <button type="button" onClick={onOpenHome} className="text-sm text-gray-500 underline">
              トップへ戻る
            </button>
          </div>
        )}
      </div>

      {confirmAction === 'END_FIRST_HALF' && (
        <ConfirmDialog
          title="前半を終了しますか？"
          message="この操作は取り消せません。前半の途中で押し間違えていないか確認してください。"
          confirmLabel="前半を終了"
          onConfirm={() => {
            setConfirmAction(null)
            onEndFirstHalf()
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === 'END_MATCH' && (
        <ConfirmDialog
          title="試合を終了しますか？"
          message="この操作は取り消せません。試合が本当に終了しているか確認してください。"
          confirmLabel="試合を終了"
          onConfirm={() => {
            setConfirmAction(null)
            onEndMatch()
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === 'START_NEW' && (
        <ConfirmDialog
          title="新しい試合を始めますか？"
          message={
            isMatchArchived(state.matchId)
              ? 'この試合は「過去の試合」に残ります。新しい試合の設定に進みます。'
              : 'この試合の記録は消えます。この操作は取り消せません。'
          }
          confirmLabel="新しい試合を始める"
          onConfirm={() => {
            setConfirmAction(null)
            onStartNewMatch()
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmingEarlyHydration && currentHalf && (
        <ConfirmDialog
          title="まだ飲水目安時刻より前です"
          message="飲水を実施しましたか？"
          confirmLabel="実施した"
          onConfirm={() => {
            setConfirmingEarlyHydration(false)
            onMarkHydrationCompleted(currentHalf, currentElapsedMs())
          }}
          onCancel={() => setConfirmingEarlyHydration(false)}
        />
      )}
    </div>
  )
}

interface HalfStartCorrectionFormProps {
  half: HalfKey
  now: number
  onApply: (half: HalfKey, correctedAt: number) => void
}

// Asks directly for "how much time has actually passed" (e.g. 2 minutes 0
// seconds) instead of a time-of-day — a "00:02:00" typed as one field used
// to be read as a wall-clock time and jump the match clock by ~20 hours.
// Minutes and seconds are separate number inputs (not a single "mm:ss" text
// field) because Android's numeric keypad has no ":" key, which forced a
// value like "200" to be read as 200 minutes.
function HalfStartCorrectionForm({ half, now, onApply }: HalfStartCorrectionFormProps) {
  const [minutes, setMinutes] = useState('')
  const [seconds, setSeconds] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleApply() {
    const m = minutes.trim() === '' ? '0' : minutes.trim()
    const s = seconds.trim() === '' ? '0' : seconds.trim()
    // Reuses the same "m:s" parsing and safety-cap logic as the combined
    // input used to, just built from two separate fields.
    const result = parseElapsedInput(`${m}:${s}`)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    onApply(half, startedAtForElapsed(now, result.ms))
    setMinutes('')
    setSeconds('')
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs">実際の試合で、今表示したい経過時間を入力してください。</p>
      <p className="text-xs text-gray-500">
        例：実際の{half === 'firstHalf' ? '前半' : '後半'}が3分20秒なら、「3」分「20」秒と入れます。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          placeholder="2"
          className="w-16 rounded border border-gray-300 px-2 py-1 text-center"
        />
        <span>分</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={59}
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
          placeholder="00"
          className="w-16 rounded border border-gray-300 px-2 py-1 text-center"
        />
        <span>秒</span>
        <button
          type="button"
          onClick={handleApply}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          この時間に合わせる
        </button>
      </div>
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
    </div>
  )
}
