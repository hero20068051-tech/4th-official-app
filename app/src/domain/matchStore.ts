import {
  computeElapsedMs,
  correctHalfStartedAt,
  createInitialClockState,
  endFirstHalf,
  endHydrationPause,
  endSecondHalf,
  startFirstHalf,
  startHydrationPause,
  startSecondHalf,
} from './clock'
import { applySubstitutionEvent, MAX_SECOND_HALF_OPPORTUNITIES, replayMatch } from './engine'
import {
  MAX_SQUAD_SIZE,
  MAX_STARTERS,
  defaultMatchSettings,
  evaluateStartEligibility,
  findDuplicateNumbers,
  parseNumberList,
} from './matchSetup'
import type { ClockState, HalfKey, HydrationCompletionState, MatchSettings } from './matchTypes'
import { pendingConfirmationReentryPolicy } from './reentryPolicy'
import type {
  CardEvent,
  CardKind,
  DraftPair,
  GoalEvent,
  MatchPhase,
  Player,
  RecordablePhase,
  ReplayResult,
  SubstitutionEvent,
  SubstitutionPair,
  SubstitutionPhase,
  TeamDraft,
  TeamId,
  TeamOfficialRole,
} from './types'

export interface AppState {
  // Identity of this match (Phase 2.4). The past-matches archive is keyed by
  // it, so saving the same finished match twice — or again after a
  // correction — updates one entry instead of adding a duplicate. Matches
  // saved before this existed get a stable id in persistence.loadMatchState.
  matchId: string
  settings: MatchSettings
  roster: Player[]
  phase: MatchPhase
  clock: ClockState
  substitutionEvents: SubstitutionEvent[]
  drafts: Record<TeamId, TeamDraft>
  hydrationCompletedByHalf: HydrationCompletionState
  // Phase 2 v0.1 — parallel to substitutionEvents, never read by engine.ts.
  hydrationCompletionElapsedMsByHalf: Record<HalfKey, number | null>
  goalEvents: GoalEvent[]
  cardEvents: CardEvent[]
}

function emptyDraft(teamId: TeamId): TeamDraft {
  return { teamId, pairs: [{}] }
}

export function createInitialAppState(): AppState {
  return {
    matchId: generateEventId(),
    settings: defaultMatchSettings(),
    roster: [],
    phase: 'PRE_MATCH',
    clock: createInitialClockState(),
    substitutionEvents: [],
    drafts: { HOME: emptyDraft('HOME'), AWAY: emptyDraft('AWAY') },
    hydrationCompletedByHalf: { firstHalf: false, secondHalf: false },
    hydrationCompletionElapsedMsByHalf: { firstHalf: null, secondHalf: null },
    goalEvents: [],
    cardEvents: [],
  }
}

// The single source of truth for who is on the pitch, who has appeared, and
// every counter: always rebuilt from the roster + confirmed event log
// (LOCKED principle: event-log reconstruction, never a separately maintained
// runtime state that could drift from history).
export function getDerivedMatchState(state: AppState): ReplayResult {
  return replayMatch(state.roster, eventsInReplayOrder(state.substitutionEvents), pendingConfirmationReentryPolicy)
}

const REPLAY_PHASE_RANK: Record<SubstitutionPhase, number> = {
  FIRST_HALF: 0,
  HALF_TIME: 1,
  SECOND_HALF: 2,
}

// The log is appended in real time, so array order is already chronological
// and this is a no-op for every untouched match. It only matters once an
// event's phase has been corrected after the fact (a substitution recorded
// as "second half" that was really half-time): that event must then replay
// *before* the second-half events, wherever it sits in the array. Only the
// phase decides the order — never elapsedMs, which is not comparable across
// a start-time correction — and ties keep their recorded order.
export function eventsInReplayOrder(events: SubstitutionEvent[]): SubstitutionEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => REPLAY_PHASE_RANK[a.event.phase] - REPLAY_PHASE_RANK[b.event.phase] || a.index - b.index)
    .map((x) => x.event)
}

function generateEventId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function updateSettings(state: AppState, partial: Partial<MatchSettings>): AppState {
  return { ...state, settings: { ...state.settings, ...partial } }
}

function playerId(teamId: TeamId, number: number): string {
  return `${teamId}:${number}`
}

export interface AddPlayersResult {
  state: AppState
  errors: string[]
}

// Roster edits are only meaningful before kickoff (SPEC/Phase1_Spec_v0.2.md
// 4.4) — after kickoff, changes to who is on the pitch happen exclusively
// through substitution events, never by editing the roster directly.
export function addPlayers(state: AppState, teamId: TeamId, rawInput: string): AddPlayersResult {
  if (state.phase !== 'PRE_MATCH') {
    return { state, errors: ['試合開始後は選手登録を変更できません'] }
  }

  const { numbers, errors } = parseNumberList(rawInput)
  const teamRoster = state.roster.filter((p) => p.teamId === teamId)
  const duplicates = findDuplicateNumbers(
    teamRoster.map((p) => p.number),
    numbers,
  )
  const allErrors = [...errors]
  if (duplicates.length > 0) {
    allErrors.push(`背番号が重複しています：${duplicates.join('、')}番`)
  }

  const newNumbers = numbers.filter((n) => !duplicates.includes(n))
  if (teamRoster.length + newNumbers.length > MAX_SQUAD_SIZE) {
    allErrors.push(`登録は${MAX_SQUAD_SIZE}名までです`)
    return { state, errors: allErrors }
  }

  if (allErrors.length > 0) {
    return { state, errors: allErrors }
  }

  const newPlayers: Player[] = newNumbers.map((number) => ({
    id: playerId(teamId, number),
    teamId,
    number,
    isStarter: false,
    isRegisteredGK: false,
  }))

  return { state: { ...state, roster: [...state.roster, ...newPlayers] }, errors: [] }
}

export function removePlayer(state: AppState, playerToRemoveId: string): AppState {
  if (state.phase !== 'PRE_MATCH') return state
  return { ...state, roster: state.roster.filter((p) => p.id !== playerToRemoveId) }
}

export interface SetStarterResult {
  state: AppState
  errors: string[]
}

export function setStarter(state: AppState, targetPlayerId: string, isStarter: boolean): SetStarterResult {
  if (state.phase !== 'PRE_MATCH') {
    return { state, errors: ['試合開始後は先発設定を変更できません'] }
  }
  const target = state.roster.find((p) => p.id === targetPlayerId)
  if (!target) return { state, errors: [] }

  if (isStarter) {
    const currentStarters = state.roster.filter((p) => p.teamId === target.teamId && p.isStarter).length
    if (currentStarters >= MAX_STARTERS) {
      return { state, errors: [`先発は${MAX_STARTERS}人までです`] }
    }
  }

  return {
    state: {
      ...state,
      roster: state.roster.map((p) => (p.id === targetPlayerId ? { ...p, isStarter } : p)),
    },
    errors: [],
  }
}

export function setRegisteredGK(state: AppState, targetPlayerId: string, isRegisteredGK: boolean): AppState {
  if (state.phase !== 'PRE_MATCH') return state
  return {
    ...state,
    roster: state.roster.map((p) => (p.id === targetPlayerId ? { ...p, isRegisteredGK } : p)),
  }
}

export function startFirstHalfPhase(state: AppState, now: number): AppState {
  if (state.phase !== 'PRE_MATCH') return state
  return { ...state, phase: 'FIRST_HALF', clock: startFirstHalf(state.clock, now) }
}

// Phase 2.2: fixing a starter typo after kickoff. This is NOT a substitution
// edit — it rewrites the initial lineup (roster.isStarter) and never creates
// an event. That is only coherent while that team's log is still empty:
// replayMatch() rebuilds everything from roster + events, so with no events
// the corrected lineup simply becomes the baseline for every later
// substitution / re-entry judgment. Once the team has a confirmed
// substitution, its history was built on the old lineup and editing is
// refused. The check is per team (the engine keeps HOME/AWAY fully
// independent), so one team's first substitution never locks the other.
export function canCorrectStarters(state: AppState, teamId: TeamId): boolean {
  const inMatch = state.phase === 'FIRST_HALF' || state.phase === 'HALF_TIME' || state.phase === 'SECOND_HALF'
  if (!inMatch) return false
  return !state.substitutionEvents.some((e) => e.teamGroups.some((g) => g.teamId === teamId))
}

export function correctStarters(state: AppState, teamId: TeamId, starterPlayerIds: string[]): SetStarterResult {
  if (!canCorrectStarters(state, teamId)) {
    const inMatch = state.phase === 'FIRST_HALF' || state.phase === 'HALF_TIME' || state.phase === 'SECOND_HALF'
    return {
      state,
      errors: [
        inMatch
          ? '交代を確定済みのため、先発設定は修正できません'
          : '今は先発設定を修正できません',
      ],
    }
  }

  const teamIds = new Set(state.roster.filter((p) => p.teamId === teamId).map((p) => p.id))
  const chosen = new Set(starterPlayerIds)
  if (chosen.size !== starterPlayerIds.length || starterPlayerIds.some((id) => !teamIds.has(id))) {
    return { state, errors: ['先発に選べない選手が含まれています'] }
  }
  if (chosen.size > MAX_STARTERS) {
    return { state, errors: [`先発は${MAX_STARTERS}人までです`] }
  }
  if (evaluateStartEligibility(chosen.size).level === 'BLOCK') {
    return { state, errors: ['先発は7名以上必要です'] }
  }

  return {
    state: {
      ...state,
      roster: state.roster.map((p) => (p.teamId === teamId ? { ...p, isStarter: chosen.has(p.id) } : p)),
      // A half-built substitution refers to the old lineup; drop it.
      drafts: { ...state.drafts, [teamId]: emptyDraft(teamId) },
    },
    errors: [],
  }
}

export function endFirstHalfPhase(state: AppState, now: number): AppState {
  if (state.phase !== 'FIRST_HALF') return state
  return { ...state, phase: 'HALF_TIME', clock: endFirstHalf(state.clock, now) }
}

export function startSecondHalfPhase(state: AppState, now: number): AppState {
  if (state.phase !== 'HALF_TIME') return state
  return { ...state, phase: 'SECOND_HALF', clock: startSecondHalf(state.clock, now) }
}

export function endMatchPhase(state: AppState, now: number): AppState {
  if (state.phase !== 'SECOND_HALF') return state
  return { ...state, phase: 'FULL_TIME', clock: endSecondHalf(state.clock, now) }
}

function currentHalfKey(phase: MatchPhase): HalfKey | null {
  if (phase === 'FIRST_HALF') return 'firstHalf'
  if (phase === 'SECOND_HALF') return 'secondHalf'
  return null
}

export function startHydrationPausePhase(state: AppState, now: number): AppState {
  if (state.settings.hydrationMode !== 'STOP_CLOCK') return state
  if (!currentHalfKey(state.phase)) return state
  return { ...state, clock: startHydrationPause(state.clock, now) }
}

// Completing a pause/resume cycle in STOP_CLOCK mode *is* the hydration
// break, so it marks that half's hydration done automatically. Nothing else
// about the pause/resume behavior changes.
export function endHydrationPausePhase(state: AppState, now: number): AppState {
  const halfKey = currentHalfKey(state.phase)
  if (state.settings.hydrationMode !== 'STOP_CLOCK' || !halfKey) return state
  const clock = endHydrationPause(state.clock, now, halfKey)
  return {
    ...state,
    clock,
    hydrationCompletedByHalf: { ...state.hydrationCompletedByHalf, [halfKey]: true },
    hydrationCompletionElapsedMsByHalf: recordHydrationElapsed(
      state.hydrationCompletionElapsedMsByHalf,
      halfKey,
      computeElapsedMs(clock, state.phase, now),
    ),
  }
}

// RUNNING_CLOCK mode has no pause/resume to hook into, so the operator marks
// hydration done directly; this never touches the clock. `elapsedMs` (when
// given) is only used to place the "飲水" marker on the timeline.
export function markHydrationCompleted(state: AppState, half: HalfKey, elapsedMs?: number): AppState {
  return {
    ...state,
    hydrationCompletedByHalf: { ...state.hydrationCompletedByHalf, [half]: true },
    hydrationCompletionElapsedMsByHalf:
      elapsedMs === undefined
        ? state.hydrationCompletionElapsedMsByHalf
        : recordHydrationElapsed(state.hydrationCompletionElapsedMsByHalf, half, elapsedMs),
  }
}

// Keeps the first hydration time for a half; a rare second break in the same
// half does not overwrite it.
function recordHydrationElapsed(
  current: Record<HalfKey, number | null>,
  half: HalfKey,
  elapsedMs: number,
): Record<HalfKey, number | null> {
  if (current[half] !== null) return current
  return { ...current, [half]: elapsedMs }
}

export function correctHalfStart(state: AppState, half: HalfKey, correctedAt: number): AppState {
  return { ...state, clock: correctHalfStartedAt(state.clock, half, correctedAt) }
}

// --- Substitution drafts (SPEC/Phase1_Spec_v0.2.md section 8) ---
// Drafts never touch match state, history, or counters until confirmed.
// Each team keeps its own draft so switching teams never loses input.

function updateDraft(state: AppState, teamId: TeamId, updater: (draft: TeamDraft) => TeamDraft): AppState {
  return { ...state, drafts: { ...state.drafts, [teamId]: updater(state.drafts[teamId]) } }
}

export function setDraftPair(
  state: AppState,
  teamId: TeamId,
  pairIndex: number,
  role: 'out' | 'in',
  playerId: string | undefined,
): AppState {
  return updateDraft(state, teamId, (draft) => ({
    ...draft,
    pairs: draft.pairs.map((pair, i): DraftPair =>
      i === pairIndex ? { ...pair, [role === 'out' ? 'outPlayerId' : 'inPlayerId']: playerId } : pair,
    ),
  }))
}

export function addDraftPair(state: AppState, teamId: TeamId): AppState {
  return updateDraft(state, teamId, (draft) => ({ ...draft, pairs: [...draft.pairs, {}] }))
}

export function removeDraftPair(state: AppState, teamId: TeamId, pairIndex: number): AppState {
  return updateDraft(state, teamId, (draft) => {
    const pairs = draft.pairs.filter((_, i) => i !== pairIndex)
    return { ...draft, pairs: pairs.length > 0 ? pairs : [{}] }
  })
}

// Discards the draft without touching history, state, or any counter (T16).
export function clearDraft(state: AppState, teamId: TeamId): AppState {
  return { ...state, drafts: { ...state.drafts, [teamId]: emptyDraft(teamId) } }
}

export interface ConfirmDraftResult {
  state: AppState
  errors: string[]
}

// Two teams substituting within this many match-clock milliseconds of each
// other are assumed to be the same real-world play stoppage (in practice
// this is a ~4-5s gap between confirming HOME then AWAY). This is only a
// convenience default for the history display, not a rule — the operator
// can always link or unlink events manually afterwards.
const STOPPAGE_AUTO_LINK_WINDOW_MS = 60_000

function withAutoLinkedStoppage(events: SubstitutionEvent[], newEvent: SubstitutionEvent): SubstitutionEvent[] {
  const newTeamId = newEvent.teamGroups[0].teamId
  let nearestOpposing: SubstitutionEvent | null = null
  let nearestGapMs = Number.POSITIVE_INFINITY

  for (const event of events) {
    if (event.teamGroups[0].teamId === newTeamId || event.phase !== newEvent.phase) continue
    const gapMs = Math.abs(event.elapsedMs - newEvent.elapsedMs)
    if (gapMs < nearestGapMs) {
      nearestGapMs = gapMs
      nearestOpposing = event
    }
  }

  if (!nearestOpposing || nearestGapMs > STOPPAGE_AUTO_LINK_WINDOW_MS) {
    return [...events, newEvent]
  }

  const groupId = nearestOpposing.stoppageGroupId ?? generateEventId()
  return [
    ...events.map((e) => (e.id === nearestOpposing!.id ? { ...e, stoppageGroupId: groupId } : e)),
    { ...newEvent, stoppageGroupId: groupId },
  ]
}

// "Confirm" is the only moment a substitution becomes real: it is appended
// to the event log and the draft is cleared. Nothing here mutates player
// location directly — the next read of getDerivedMatchState() replays it.
export function confirmDraft(state: AppState, teamId: TeamId, now: number): ConfirmDraftResult {
  if (state.phase !== 'FIRST_HALF' && state.phase !== 'HALF_TIME' && state.phase !== 'SECOND_HALF') {
    return { state, errors: ['今は交代を確定できません'] }
  }

  const completePairs: SubstitutionPair[] = state.drafts[teamId].pairs
    .filter((p): p is Required<DraftPair> => Boolean(p.outPlayerId && p.inPlayerId))
    .map((p) => ({ outPlayerId: p.outPlayerId, inPlayerId: p.inPlayerId }))

  if (completePairs.length === 0) {
    return { state, errors: ['交代する選手を選んでください'] }
  }

  const phase: SubstitutionPhase = state.phase
  const event: SubstitutionEvent = {
    id: generateEventId(),
    phase,
    elapsedMs: computeElapsedMs(state.clock, state.phase, now),
    teamGroups: [{ teamId, pairs: completePairs }],
  }

  const currentMatchState = getDerivedMatchState(state).state
  const { errors } = applySubstitutionEvent(currentMatchState, state.roster, event, pendingConfirmationReentryPolicy)
  if (errors.length > 0) {
    return { state, errors }
  }

  return {
    state: {
      ...state,
      substitutionEvents: withAutoLinkedStoppage(state.substitutionEvents, event),
      drafts: { ...state.drafts, [teamId]: emptyDraft(teamId) },
    },
    errors: [],
  }
}

// --- History edit / cancel (SPEC/Phase1_Spec_v0.2.md section 14) ---
// Edits and deletions are applied to the raw log unconditionally; legality
// of everything is re-derived by replaying from the start via
// getDerivedMatchState(). Events that become illegal are never dropped or
// silently re-legalized — they simply show up in that replay's needsReview.

export function deleteSubstitutionEvent(state: AppState, eventId: string): AppState {
  return { ...state, substitutionEvents: state.substitutionEvents.filter((e) => e.id !== eventId) }
}

export function updateSubstitutionEventPairs(
  state: AppState,
  eventId: string,
  newPairs: SubstitutionPair[],
): AppState {
  return {
    ...state,
    substitutionEvents: state.substitutionEvents.map((event) =>
      event.id === eventId
        ? { ...event, teamGroups: event.teamGroups.map((g) => ({ ...g, pairs: newPairs })) }
        : event,
    ),
  }
}

// Half-time substitutions are easy to record under the wrong phase when the
// operator can't keep up (e.g. the second half was started before the last
// half-time pairs were entered). This re-files a "second half" substitution
// as a half-time one. It is a real edit of the event's phase — never just a
// label: the derived state (pitch/bench, appearances, re-entry
// eligibility, the 3 re-entry cap, and the second-half opportunity counter)
// is rebuilt from the log by replay, so a second-half opportunity the event
// had used is given back automatically. Later events that the new picture
// makes illegal are not deleted; they surface in needsReview like any other
// edit (SPEC section 14.2).
//
// Deliberately one-directional (second half -> half-time): the reverse would
// have to invent a second-half clock time that nobody recorded.
export function canMoveSubstitutionToHalfTime(state: AppState, eventId: string): boolean {
  const event = state.substitutionEvents.find((e) => e.id === eventId)
  return Boolean(event && event.phase === 'SECOND_HALF' && state.clock.firstHalfEndedAt !== null)
}

export function moveSubstitutionToHalfTime(state: AppState, eventId: string): AppState {
  if (!canMoveSubstitutionToHalfTime(state, eventId)) return state
  const moved = state.substitutionEvents.find((e) => e.id === eventId)!
  const halfTimeElapsedMs = computeElapsedMs(state.clock, 'HALF_TIME', 0)

  let events = state.substitutionEvents.map((e) =>
    e.id === eventId ? { ...e, phase: 'HALF_TIME' as const, elapsedMs: halfTimeElapsedMs } : e,
  )

  // "Same play stoppage" is informational and only makes sense within one
  // moment; a link that now spans half-time and the second half is dropped
  // (for both members) rather than left pointing across phases.
  if (moved.stoppageGroupId) {
    const groupId = moved.stoppageGroupId
    const members = events.filter((e) => e.stoppageGroupId === groupId)
    if (members.some((m) => m.phase !== 'HALF_TIME')) {
      events = events.map((e) => (e.stoppageGroupId === groupId ? { ...e, stoppageGroupId: null } : e))
    }
  }

  return { ...state, substitutionEvents: events }
}

// What the move would do, without applying it: how many substitutions that
// were fine before would newly need review afterwards. Lets the UI say so
// before the operator commits.
export function previewMoveSubstitutionToHalfTime(state: AppState, eventId: string): { newlyNeedingReview: number } {
  const before = new Set(getDerivedMatchState(state).needsReview.map((r) => r.eventId))
  const after = getDerivedMatchState(moveSubstitutionToHalfTime(state, eventId)).needsReview
  return { newlyNeedingReview: after.filter((r) => !before.has(r.eventId)).length }
}

// The opposite correction: substitutions recorded under half-time that were
// really made in the second half. Unlike the second-half -> half-time move
// (whose time is the fixed half-time value), this needs facts nobody
// recorded, so the operator supplies them and nothing is guessed:
//   * which of the event's pairs actually happened in the second half, and
//   * for each real substitution occasion, the second-half clock time.
// One `SecondHalfMove` becomes one new second-half event = one substitution
// occasion in the engine's own counting (a team's group in the second half
// costs one opportunity no matter how many pairs it holds). "Same
// stoppage" is therefore one move holding several pairs, "separate
// timings" is one move per pair — the operator decides, the app never
// infers it.
export interface SecondHalfMove {
  pairIndexes: number[]
  elapsedMs: number
}

export function canMoveSubstitutionToSecondHalf(state: AppState, eventId: string): boolean {
  const event = state.substitutionEvents.find((e) => e.id === eventId)
  return Boolean(
    event && event.phase === 'HALF_TIME' && event.teamGroups.length === 1 && state.clock.secondHalfStartedAt !== null,
  )
}

export interface MoveToSecondHalfResult {
  state: AppState
  errors: string[]
}

export function moveSubstitutionPairsToSecondHalf(
  state: AppState,
  eventId: string,
  moves: SecondHalfMove[],
): MoveToSecondHalfResult {
  if (!canMoveSubstitutionToSecondHalf(state, eventId)) {
    return { state, errors: ['この交代は後半の記録に変更できません'] }
  }
  const original = state.substitutionEvents.find((e) => e.id === eventId)!
  const group = original.teamGroups[0]

  const seen = new Set<number>()
  for (const move of moves) {
    if (move.pairIndexes.length === 0) return { state, errors: ['後半へ移す交代を選んでください'] }
    if (!Number.isFinite(move.elapsedMs) || move.elapsedMs < 0) return { state, errors: ['後半の経過時間が正しくありません'] }
    for (const i of move.pairIndexes) {
      if (!Number.isInteger(i) || i < 0 || i >= group.pairs.length || seen.has(i)) {
        return { state, errors: ['後半へ移す交代の指定が正しくありません'] }
      }
      seen.add(i)
    }
  }
  if (moves.length === 0) return { state, errors: ['後半へ移す交代を選んでください'] }

  const remainingPairs = group.pairs.filter((_, i) => !seen.has(i))
  // Chronological among themselves; equal times keep the order given.
  const ordered = moves.map((m, index) => ({ m, index })).sort((a, b) => a.m.elapsedMs - b.m.elapsedMs || a.index - b.index)
  const created: SubstitutionEvent[] = ordered.map(({ m }, k) => ({
    // If nothing stays behind, the first moved event keeps the original id.
    id: remainingPairs.length === 0 && k === 0 ? original.id : generateEventId(),
    phase: 'SECOND_HALF',
    elapsedMs: m.elapsedMs,
    teamGroups: [{ teamId: group.teamId, pairs: [...m.pairIndexes].sort((a, b) => a - b).map((i) => group.pairs[i]) }],
    stoppageGroupId: null,
  }))

  let events: SubstitutionEvent[] =
    remainingPairs.length > 0
      ? state.substitutionEvents.map((e) =>
          e.id === eventId ? { ...e, teamGroups: [{ ...group, pairs: remainingPairs }] } : e,
        )
      : state.substitutionEvents.filter((e) => e.id !== eventId)

  // Place each new event by its second-half time among the existing
  // second-half events (replay order within a phase is array order).
  for (const event of created) {
    const at = events.findIndex((e) => e.phase === 'SECOND_HALF' && e.elapsedMs > event.elapsedMs)
    events = at === -1 ? [...events, event] : [...events.slice(0, at), event, ...events.slice(at)]
  }

  // A stoppage link that now spans half-time and the second half is dropped
  // for both members (only possible when the whole event moved).
  if (remainingPairs.length === 0 && original.stoppageGroupId) {
    const groupId = original.stoppageGroupId
    events = events.map((e) => (e.stoppageGroupId === groupId ? { ...e, stoppageGroupId: null } : e))
  }

  return { state: { ...state, substitutionEvents: events }, errors: [] }
}

export interface MoveToSecondHalfPreview {
  errors: string[]
  newlyNeedingReview: number
  secondHalfRemaining: number | null
}

// What the move would do, without applying it (same idea as
// previewMoveSubstitutionToHalfTime), plus how many second-half
// opportunities that team would have left afterwards.
export function previewMoveSubstitutionPairsToSecondHalf(
  state: AppState,
  eventId: string,
  moves: SecondHalfMove[],
): MoveToSecondHalfPreview {
  const result = moveSubstitutionPairsToSecondHalf(state, eventId, moves)
  if (result.errors.length > 0) return { errors: result.errors, newlyNeedingReview: 0, secondHalfRemaining: null }
  const teamId = state.substitutionEvents.find((e) => e.id === eventId)!.teamGroups[0].teamId
  const before = new Set(getDerivedMatchState(state).needsReview.map((r) => r.eventId))
  const after = getDerivedMatchState(result.state)
  return {
    errors: [],
    newlyNeedingReview: after.needsReview.filter((r) => !before.has(r.eventId)).length,
    secondHalfRemaining: MAX_SECOND_HALF_OPPORTUNITIES - after.state.teamCounters[teamId].secondHalfOpportunitiesUsed,
  }
}

// --- Manual stoppage linking (SPEC has no auto-detection rule for this —
// see withAutoLinkedStoppage above for the convenience default applied at
// confirm time). These let the operator fix a link the automatic guess
// missed or got wrong, after the fact, from the history view.

export function linkToNearestOpposingEvent(state: AppState, eventId: string): AppState {
  const event = state.substitutionEvents.find((e) => e.id === eventId)
  if (!event) return state
  const teamId = event.teamGroups[0].teamId

  const candidates = state.substitutionEvents.filter((e) => e.id !== eventId && e.teamGroups[0].teamId !== teamId)
  if (candidates.length === 0) return state

  const nearest = candidates.reduce((best, e) =>
    Math.abs(e.elapsedMs - event.elapsedMs) < Math.abs(best.elapsedMs - event.elapsedMs) ? e : best,
  )
  const groupId = nearest.stoppageGroupId ?? event.stoppageGroupId ?? generateEventId()

  return {
    ...state,
    substitutionEvents: state.substitutionEvents.map((e) =>
      e.id === eventId || e.id === nearest.id ? { ...e, stoppageGroupId: groupId } : e,
    ),
  }
}

export function unlinkStoppageEvent(state: AppState, eventId: string): AppState {
  return {
    ...state,
    substitutionEvents: state.substitutionEvents.map((e) =>
      e.id === eventId ? { ...e, stoppageGroupId: null } : e,
    ),
  }
}

// --- Phase 2 v0.1: goals ---
// Score is derived from goalEvents (matchRecord.deriveScore) — never stored.

export interface GoalDraft {
  teamId: TeamId
  scorerNumber: number | null
  ownGoal: boolean
  ownGoalByNumber: number | null
}

function normalizeGoalDraft(draft: GoalDraft): Pick<GoalEvent, 'scorerNumber' | 'ownGoal' | 'ownGoalByNumber'> {
  // An own goal has no "our" scorer number; a normal goal has no opponent number.
  return draft.ownGoal
    ? { scorerNumber: null, ownGoal: true, ownGoalByNumber: draft.ownGoalByNumber }
    : { scorerNumber: draft.scorerNumber, ownGoal: false, ownGoalByNumber: null }
}

export function recordGoal(state: AppState, draft: GoalDraft, phase: RecordablePhase, elapsedMs: number): AppState {
  const goal: GoalEvent = {
    id: generateEventId(),
    phase,
    elapsedMs,
    teamId: draft.teamId,
    ...normalizeGoalDraft(draft),
  }
  return { ...state, goalEvents: [...state.goalEvents, goal] }
}

// Phase 2.1: the recorded time can also be corrected — a goal isn't always
// entered the instant it happens. `time` is optional so existing callers
// that only fix the team/scorer/own-goal keep working unchanged; when given,
// it replaces phase + elapsedMs. The timeline re-derives its order from
// these on every read (matchRecord.buildTimeline), so no separate re-sort
// step is needed — correcting the time here is enough.
export interface GoalTimeEdit {
  phase: RecordablePhase
  elapsedMs: number
}

export function updateGoalEvent(state: AppState, id: string, draft: GoalDraft, time?: GoalTimeEdit): AppState {
  return {
    ...state,
    goalEvents: state.goalEvents.map((g) =>
      g.id === id
        ? { ...g, teamId: draft.teamId, ...normalizeGoalDraft(draft), ...(time ?? {}) }
        : g,
    ),
  }
}

export function deleteGoalEvent(state: AppState, id: string): AppState {
  return { ...state, goalEvents: state.goalEvents.filter((g) => g.id !== id) }
}

// --- Phase 2 v0.1: cards ---

export interface CardDraft {
  teamId: TeamId
  card: CardKind
  targetType: 'PLAYER' | 'OFFICIAL'
  playerNumber: number | null
  officialRole: TeamOfficialRole | null
  officialName: string
}

function normalizeCardDraft(
  draft: CardDraft,
): Pick<CardEvent, 'card' | 'targetType' | 'playerNumber' | 'officialRole' | 'officialName'> {
  return draft.targetType === 'PLAYER'
    ? {
        card: draft.card,
        targetType: 'PLAYER',
        playerNumber: draft.playerNumber,
        officialRole: null,
        officialName: '',
      }
    : {
        card: draft.card,
        targetType: 'OFFICIAL',
        playerNumber: null,
        officialRole: draft.officialRole,
        officialName: draft.officialName.trim(),
      }
}

export function recordCard(state: AppState, draft: CardDraft, phase: RecordablePhase, elapsedMs: number): AppState {
  const card: CardEvent = {
    id: generateEventId(),
    phase,
    elapsedMs,
    teamId: draft.teamId,
    ...normalizeCardDraft(draft),
  }
  return { ...state, cardEvents: [...state.cardEvents, card] }
}

export function updateCardEvent(state: AppState, id: string, draft: CardDraft): AppState {
  return {
    ...state,
    cardEvents: state.cardEvents.map((c) =>
      c.id === id ? { ...c, teamId: draft.teamId, ...normalizeCardDraft(draft) } : c,
    ),
  }
}

export function deleteCardEvent(state: AppState, id: string): AppState {
  return { ...state, cardEvents: state.cardEvents.filter((c) => c.id !== id) }
}
