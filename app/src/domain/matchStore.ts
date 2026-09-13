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
import { applySubstitutionEvent, replayMatch } from './engine'
import {
  MAX_SQUAD_SIZE,
  MAX_STARTERS,
  defaultMatchSettings,
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
  return replayMatch(state.roster, state.substitutionEvents, pendingConfirmationReentryPolicy)
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
