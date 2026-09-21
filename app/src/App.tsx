import { useEffect, useState } from 'react'
import { MatchScreen } from './components/MatchScreen'
import { ArchiveScreen } from './components/ArchiveScreen'
import { HomeScreen } from './components/HomeScreen'
import { SetupScreen } from './components/SetupScreen'
import type { HalfKey } from './domain/matchTypes'
import {
  addDraftPair,
  addPlayers,
  type CardDraft,
  clearDraft,
  confirmDraft,
  correctHalfStart,
  correctStarters,
  createInitialAppState,
  deleteCardEvent,
  deleteGoalEvent,
  deleteSubstitutionEvent,
  endFirstHalfPhase,
  endHydrationPausePhase,
  endMatchPhase,
  type GoalDraft,
  linkToNearestOpposingEvent,
  markHydrationCompleted,
  moveSubstitutionPairsToSecondHalf,
  moveSubstitutionToHalfTime,
  recordCard,
  recordGoal,
  removeDraftPair,
  removePlayer,
  setDraftPair,
  setRegisteredGK,
  setStarter,
  startFirstHalfPhase,
  startHydrationPausePhase,
  startSecondHalfPhase,
  unlinkStoppageEvent,
  updateCardEvent,
  updateGoalEvent,
  updateSettings,
  updateSubstitutionEventPairs,
} from './domain/matchStore'
import { archiveFinishedMatch, deleteArchivedMatch, loadArchive } from './domain/matchArchive'
import { clearMatchState, hasMeaningfulProgress, loadMatchState, saveMatchState } from './domain/persistence'
import type { RecordablePhase, TeamId } from './domain/types'
import type { AppState } from './domain/matchStore'

type View = 'home' | 'archive' | 'app'

function App() {
  const [savedState, setSavedState] = useState<AppState | null>(() => loadMatchState())
  // A match worth asking about (in progress, or just finished) waits behind
  // the top screen until the operator chooses; a blank pre-match screen is
  // simply reopened.
  const savedIsMeaningful = savedState !== null && hasMeaningfulProgress(savedState)
  const [resumed, setResumed] = useState(() => !savedIsMeaningful)
  const [state, setState] = useState<AppState>(() =>
    savedState !== null && !hasMeaningfulProgress(savedState) ? savedState : createInitialAppState(),
  )
  // With nothing saved and nothing archived the app opens straight onto the
  // pre-match screen, exactly as before.
  const [archiveCount, setArchiveCount] = useState(() => loadArchive().length)
  const [view, setView] = useState<View>(() => (savedIsMeaningful || loadArchive().length > 0 ? 'home' : 'app'))

  useEffect(() => {
    if (!resumed) return
    saveMatchState(state)
  }, [state, resumed])

  // A finished match is archived automatically. The entry is keyed by the
  // match id and rewritten on every change while the match is finished, so
  // a correction made after full time is reflected in "past matches" too —
  // and doing this any number of times never creates a second copy.
  useEffect(() => {
    if (resumed && state.phase === 'FULL_TIME' && archiveFinishedMatch(state)) setArchiveCount(loadArchive().length)
  }, [state, resumed])

  // A match that finished before this version (or was closed at full time
  // without being reopened) is archived as soon as the app opens.
  useEffect(() => {
    if (savedState?.phase === 'FULL_TIME' && archiveFinishedMatch(savedState)) setArchiveCount(loadArchive().length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pinch-zoom is left fully enabled (no maximum-scale/user-scalable lock —
  // that would be an accessibility regression). Some Android browsers can
  // leave the page's own horizontal scroll position nonzero after a pinch
  // gesture ends, which reads as the whole page having shifted sideways.
  // This only snaps that back to 0; it never touches zoom level itself.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const resetHorizontalDrift = () => {
      if (window.scrollX !== 0) window.scrollTo(0, window.scrollY)
    }
    viewport.addEventListener('resize', resetHorizontalDrift)
    return () => viewport.removeEventListener('resize', resetHorizontalDrift)
  }, [])

  const currentMatch = resumed ? (hasMeaningfulProgress(state) ? state : null) : savedState

  if (view === 'archive') {
    return (
      <ArchiveScreen
        onBack={() => setView('home')}
        onDelete={(id) => {
          deleteArchivedMatch(id)
          setArchiveCount(loadArchive().length)
          // The working slot may still hold this very match (finished, then
          // deleted). Clear it too, or it would be archived again on the
          // next load.
          if (state.matchId === id && resumed) {
            clearMatchState()
            setState(createInitialAppState())
          } else if (savedState?.matchId === id) {
            clearMatchState()
            setSavedState(null)
          }
        }}
      />
    )
  }

  if (view === 'home') {
    return (
      <HomeScreen
        current={currentMatch}
        onResume={() => {
          if (!resumed && savedState) {
            setState(savedState)
            setResumed(true)
          }
          setView('app')
        }}
        onStartNew={() => {
          if (currentMatch !== null) {
            clearMatchState()
            setSavedState(null)
            setState(createInitialAppState())
            setResumed(true)
          }
          setView('app')
        }}
        onOpenArchive={() => setView('archive')}
      />
    )
  }

  if (state.phase === 'PRE_MATCH') {
    return (
      <SetupScreen
        state={state}
        onUpdateSettings={(partial) => setState((s) => updateSettings(s, partial))}
        onAddPlayers={(teamId: TeamId, rawInput: string) => {
          const { state: next, errors } = addPlayers(state, teamId, rawInput)
          if (errors.length === 0) setState(next)
          return errors
        }}
        onRemovePlayer={(playerId) => setState((s) => removePlayer(s, playerId))}
        onSetStarter={(playerId, isStarter) => {
          const { state: next, errors } = setStarter(state, playerId, isStarter)
          if (errors.length === 0) setState(next)
          return errors
        }}
        onSetRegisteredGK={(playerId, isRegisteredGK) =>
          setState((s) => setRegisteredGK(s, playerId, isRegisteredGK))
        }
        onStartMatch={() => setState((s) => startFirstHalfPhase(s, Date.now()))}
        onOpenHome={archiveCount > 0 || hasMeaningfulProgress(state) ? () => setView('home') : undefined}
      />
    )
  }

  return (
    <MatchScreen
      state={state}
      onEndFirstHalf={() => setState((s) => endFirstHalfPhase(s, Date.now()))}
      onStartSecondHalf={() => setState((s) => startSecondHalfPhase(s, Date.now()))}
      onEndMatch={() => setState((s) => endMatchPhase(s, Date.now()))}
      onStartHydrationPause={() => setState((s) => startHydrationPausePhase(s, Date.now()))}
      onEndHydrationPause={() => setState((s) => endHydrationPausePhase(s, Date.now()))}
      onCorrectHalfStart={(half: HalfKey, correctedAt: number) =>
        setState((s) => correctHalfStart(s, half, correctedAt))
      }
      onCorrectStarters={(teamId, starterIds) => {
        const { state: next, errors } = correctStarters(state, teamId, starterIds)
        if (errors.length === 0) setState(next)
        return errors
      }}
      onSetDraftPair={(teamId, pairIndex, role, playerId) =>
        setState((s) => setDraftPair(s, teamId, pairIndex, role, playerId))
      }
      onAddDraftPair={(teamId) => setState((s) => addDraftPair(s, teamId))}
      onRemoveDraftPair={(teamId, pairIndex) => setState((s) => removeDraftPair(s, teamId, pairIndex))}
      onClearDraft={(teamId) => setState((s) => clearDraft(s, teamId))}
      onConfirmDraft={(teamId) => {
        const result = confirmDraft(state, teamId, Date.now())
        if (result.errors.length === 0) setState(result.state)
        return result.errors
      }}
      onDeleteSubstitutionEvent={(eventId) => setState((s) => deleteSubstitutionEvent(s, eventId))}
      onUpdateSubstitutionEventPairs={(eventId, pairs) =>
        setState((s) => updateSubstitutionEventPairs(s, eventId, pairs))
      }
      onLinkStoppage={(eventId) => setState((s) => linkToNearestOpposingEvent(s, eventId))}
      onUnlinkStoppage={(eventId) => setState((s) => unlinkStoppageEvent(s, eventId))}
      onMoveSubstitutionToHalfTime={(eventId) => setState((s) => moveSubstitutionToHalfTime(s, eventId))}
      onMoveSubstitutionToSecondHalf={(eventId, moves) => {
        const result = moveSubstitutionPairsToSecondHalf(state, eventId, moves)
        if (result.errors.length === 0) setState(result.state)
        return result.errors
      }}
      onMarkHydrationCompleted={(half, elapsedMs) => setState((s) => markHydrationCompleted(s, half, elapsedMs))}
      onRecordGoal={(draft: GoalDraft, phase: RecordablePhase, elapsedMs: number) =>
        setState((s) => recordGoal(s, draft, phase, elapsedMs))
      }
      onUpdateGoal={(goalId, draft, time) => setState((s) => updateGoalEvent(s, goalId, draft, time))}
      onDeleteGoal={(goalId) => setState((s) => deleteGoalEvent(s, goalId))}
      onRecordCard={(draft: CardDraft, phase: RecordablePhase, elapsedMs: number) =>
        setState((s) => recordCard(s, draft, phase, elapsedMs))
      }
      onUpdateCard={(cardId, draft) => setState((s) => updateCardEvent(s, cardId, draft))}
      onDeleteCard={(cardId) => setState((s) => deleteCardEvent(s, cardId))}
      onOpenHome={() => setView('home')}
      onStartNewMatch={() => {
        clearMatchState()
        setState(createInitialAppState())
      }}
    />
  )
}

export default App
