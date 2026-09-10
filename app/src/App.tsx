import { useEffect, useState } from 'react'
import { MatchScreen } from './components/MatchScreen'
import { ResumePrompt } from './components/ResumePrompt'
import { SetupScreen } from './components/SetupScreen'
import type { HalfKey } from './domain/matchTypes'
import {
  addDraftPair,
  addPlayers,
  type CardDraft,
  clearDraft,
  confirmDraft,
  correctHalfStart,
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
import { clearMatchState, loadMatchState, saveMatchState } from './domain/persistence'
import type { RecordablePhase, TeamId } from './domain/types'

function App() {
  const [savedState] = useState(() => loadMatchState())
  const [resumed, setResumed] = useState(() => savedState === null)
  const [state, setState] = useState(createInitialAppState)

  useEffect(() => {
    if (!resumed) return
    saveMatchState(state)
  }, [state, resumed])

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

  if (!resumed && savedState) {
    return (
      <ResumePrompt
        savedState={savedState}
        onResume={() => {
          setState(savedState)
          setResumed(true)
        }}
        onStartNew={() => {
          clearMatchState()
          setState(createInitialAppState())
          setResumed(true)
        }}
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
      onMarkHydrationCompleted={(half, elapsedMs) => setState((s) => markHydrationCompleted(s, half, elapsedMs))}
      onRecordGoal={(draft: GoalDraft, phase: RecordablePhase, elapsedMs: number) =>
        setState((s) => recordGoal(s, draft, phase, elapsedMs))
      }
      onUpdateGoal={(goalId, draft) => setState((s) => updateGoalEvent(s, goalId, draft))}
      onDeleteGoal={(goalId) => setState((s) => deleteGoalEvent(s, goalId))}
      onRecordCard={(draft: CardDraft, phase: RecordablePhase, elapsedMs: number) =>
        setState((s) => recordCard(s, draft, phase, elapsedMs))
      }
      onUpdateCard={(cardId, draft) => setState((s) => updateCardEvent(s, cardId, draft))}
      onDeleteCard={(cardId) => setState((s) => deleteCardEvent(s, cardId))}
      onStartNewMatch={() => {
        clearMatchState()
        setState(createInitialAppState())
      }}
    />
  )
}

export default App
