import { describe, expect, it } from 'vitest'
import { computeElapsedMs } from './clock'
import { deriveScore } from './matchRecord'
import {
  addDraftPair,
  addPlayers,
  clearDraft,
  confirmDraft,
  createInitialAppState,
  deleteCardEvent,
  deleteGoalEvent,
  deleteSubstitutionEvent,
  endFirstHalfPhase,
  endHydrationPausePhase,
  getDerivedMatchState,
  linkToNearestOpposingEvent,
  markHydrationCompleted,
  recordCard,
  recordGoal,
  removeDraftPair,
  removePlayer,
  setDraftPair,
  setStarter,
  startFirstHalfPhase,
  startHydrationPausePhase,
  startSecondHalfPhase,
  unlinkStoppageEvent,
  updateCardEvent,
  updateGoalEvent,
  updateSettings,
  updateSubstitutionEventPairs,
} from './matchStore'

describe('addPlayers', () => {
  it('registers a bulk numeric list sorted, scoped to one team', () => {
    const state = createInitialAppState()
    const { state: next, errors } = addPlayers(state, 'HOME', '10, 4, 7')
    expect(errors).toEqual([])
    expect(next.roster.map((p) => p.number)).toEqual([4, 7, 10])
    expect(next.roster.every((p) => p.teamId === 'HOME')).toBe(true)
  })

  it('rejects a number already registered on that team (T19)', () => {
    const state = createInitialAppState()
    const { state: withPlayer } = addPlayers(state, 'HOME', '15')
    const { errors } = addPlayers(withPlayer, 'HOME', '15')
    expect(errors[0]).toContain('重複')
  })

  it('allows the same number on the other team', () => {
    const state = createInitialAppState()
    const { state: withHome } = addPlayers(state, 'HOME', '15')
    const { errors } = addPlayers(withHome, 'AWAY', '15')
    expect(errors).toEqual([])
  })

  it('is rejected once the match has kicked off', () => {
    let state = createInitialAppState()
    state = addPlayers(state, 'HOME', '1,2,3,4,5,6,7,8,9,10,11').state
    for (const p of state.roster) {
      state = setStarter(state, p.id, true).state
    }
    state = startFirstHalfPhase(state, 0)
    const { errors } = addPlayers(state, 'HOME', '20')
    expect(errors).toEqual(['試合開始後は選手登録を変更できません'])
  })
})

describe('setStarter', () => {
  it('caps starters at 11 per team', () => {
    let state = createInitialAppState()
    state = addPlayers(state, 'HOME', '1,2,3,4,5,6,7,8,9,10,11,12').state
    for (const p of state.roster.slice(0, 11)) {
      state = setStarter(state, p.id, true).state
    }
    const twelfth = state.roster[11]
    const result = setStarter(state, twelfth.id, true)
    expect(result.errors).toEqual(['先発は11人までです'])
  })
})

describe('removePlayer', () => {
  it('removes a registered player before kickoff', () => {
    let state = createInitialAppState()
    state = addPlayers(state, 'HOME', '15').state
    const id = state.roster[0].id
    state = removePlayer(state, id)
    expect(state.roster).toHaveLength(0)
  })
})

function startedMatch() {
  let state = createInitialAppState()
  state = addPlayers(state, 'HOME', '1,2,3,4,5,6,7,8,9,10,11,15,16').state
  for (const p of state.roster.filter((p) => p.number <= 11)) {
    state = setStarter(state, p.id, true).state
  }
  state = startFirstHalfPhase(state, 0)
  return state
}

describe('substitution drafts', () => {
  it('does not affect match state until confirmed (T13/T16)', () => {
    let state = startedMatch()
    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:10')
    state = setDraftPair(state, 'HOME', 0, 'in', 'HOME:15')
    expect(getDerivedMatchState(state).state.players['HOME:15'].location).toBe('bench')

    state = clearDraft(state, 'HOME')
    expect(state.drafts.HOME.pairs).toEqual([{}])
    expect(getDerivedMatchState(state).state.players['HOME:15'].location).toBe('bench')
  })

  it('keeps HOME and AWAY drafts independent when switching teams (T15)', () => {
    let state = startedMatch()
    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:10')
    state = setDraftPair(state, 'AWAY', 0, 'out', undefined)
    expect(state.drafts.HOME.pairs[0].outPlayerId).toBe('HOME:10')
  })

  it('supports adding and removing individual pairs (T14)', () => {
    let state = startedMatch()
    state = addDraftPair(state, 'HOME')
    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:10')
    state = setDraftPair(state, 'HOME', 1, 'out', 'HOME:9')
    state = removeDraftPair(state, 'HOME', 1)
    expect(state.drafts.HOME.pairs).toHaveLength(1)
    expect(state.drafts.HOME.pairs[0].outPlayerId).toBe('HOME:10')
  })
})

describe('confirmDraft', () => {
  it('appends a legal substitution to the event log and clears the draft', () => {
    let state = startedMatch()
    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:10')
    state = setDraftPair(state, 'HOME', 0, 'in', 'HOME:15')
    const result = confirmDraft(state, 'HOME', 5_000)
    expect(result.errors).toEqual([])
    expect(result.state.substitutionEvents).toHaveLength(1)
    expect(result.state.drafts.HOME.pairs).toEqual([{}])
    expect(getDerivedMatchState(result.state).state.players['HOME:15'].location).toBe('pitch')
  })

  it('rejects an illegal draft without touching the log (T03-style)', () => {
    let state = startedMatch()
    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:10')
    state = setDraftPair(state, 'HOME', 0, 'in', 'HOME:10') // same player
    const result = confirmDraft(state, 'HOME', 0)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.state.substitutionEvents).toHaveLength(0)
  })
})

describe('history edit and delete trigger full replay (T17/T18)', () => {
  it('recomputes state after editing a confirmed event', () => {
    let state = startedMatch()
    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:10')
    state = setDraftPair(state, 'HOME', 0, 'in', 'HOME:15')
    state = confirmDraft(state, 'HOME', 0).state
    const eventId = state.substitutionEvents[0].id

    state = updateSubstitutionEventPairs(state, eventId, [{ outPlayerId: 'HOME:10', inPlayerId: 'HOME:16' }])
    const derived = getDerivedMatchState(state)
    expect(derived.needsReview).toEqual([])
    expect(derived.state.players['HOME:16'].location).toBe('pitch')
    expect(derived.state.players['HOME:15'].location).toBe('bench')
  })

  it('flags, not silently drops or re-legalizes, a later event invalidated by an edit', () => {
    let state = startedMatch()
    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:10')
    state = setDraftPair(state, 'HOME', 0, 'in', 'HOME:15')
    state = confirmDraft(state, 'HOME', 0).state
    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:15')
    state = setDraftPair(state, 'HOME', 0, 'in', 'HOME:16')
    state = confirmDraft(state, 'HOME', 1_000).state

    const firstEventId = state.substitutionEvents[0].id
    state = updateSubstitutionEventPairs(state, firstEventId, [{ outPlayerId: 'HOME:10', inPlayerId: 'HOME:16' }])

    const derived = getDerivedMatchState(state)
    expect(derived.needsReview).toHaveLength(1)
    expect(derived.needsReview[0].eventId).toBe(state.substitutionEvents[1].id)
  })

  it('deleting an event removes it from the log and re-derives state', () => {
    let state = startedMatch()
    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:10')
    state = setDraftPair(state, 'HOME', 0, 'in', 'HOME:15')
    state = confirmDraft(state, 'HOME', 0).state
    const eventId = state.substitutionEvents[0].id

    state = deleteSubstitutionEvent(state, eventId)
    expect(state.substitutionEvents).toHaveLength(0)
    expect(getDerivedMatchState(state).state.players['HOME:10'].location).toBe('pitch')
  })
})

describe('second-half opportunity counter surfaces through derived state', () => {
  it('reflects one consumed opportunity after a second-half substitution (T08)', () => {
    let state = startedMatch()
    state = endFirstHalfPhase(state, 1_800_000)
    state = startSecondHalfPhase(state, 1_800_000)
    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:10')
    state = setDraftPair(state, 'HOME', 0, 'in', 'HOME:15')
    state = confirmDraft(state, 'HOME', 1_900_000).state
    expect(getDerivedMatchState(state).state.teamCounters.HOME.secondHalfOpportunitiesUsed).toBe(1)
  })
})

function startedMatchWithBothTeams() {
  let state = createInitialAppState()
  state = addPlayers(state, 'HOME', '1,2,3,4,5,6,7,8,9,10,11,15,16').state
  state = addPlayers(state, 'AWAY', '1,2,3,4,5,6,7,8,9,10,11,15').state
  for (const p of state.roster.filter((p) => p.number <= 11)) {
    state = setStarter(state, p.id, true).state
  }
  state = startFirstHalfPhase(state, 0)
  return state
}

describe('same-stoppage linking (SPEC has no rule for this — convenience metadata only)', () => {
  it('auto-links two confirms from opposing teams made moments apart', () => {
    let state = startedMatchWithBothTeams()
    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:10')
    state = setDraftPair(state, 'HOME', 0, 'in', 'HOME:15')
    state = confirmDraft(state, 'HOME', 5_000).state // elapsedMs = 5_000

    state = setDraftPair(state, 'AWAY', 0, 'out', 'AWAY:10')
    state = setDraftPair(state, 'AWAY', 0, 'in', 'AWAY:15')
    state = confirmDraft(state, 'AWAY', 10_000).state // elapsedMs = 10_000, 5s later

    const [homeEvent, awayEvent] = state.substitutionEvents
    expect(homeEvent.stoppageGroupId).not.toBeNull()
    expect(homeEvent.stoppageGroupId).toBe(awayEvent.stoppageGroupId)
  })

  it('does not link confirms from opposing teams far apart in match time', () => {
    let state = startedMatchWithBothTeams()
    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:10')
    state = setDraftPair(state, 'HOME', 0, 'in', 'HOME:15')
    state = confirmDraft(state, 'HOME', 5_000).state

    state = setDraftPair(state, 'AWAY', 0, 'out', 'AWAY:10')
    state = setDraftPair(state, 'AWAY', 0, 'in', 'AWAY:15')
    state = confirmDraft(state, 'AWAY', 5 * 60_000).state // 5 minutes later

    const [homeEvent, awayEvent] = state.substitutionEvents
    expect(homeEvent.stoppageGroupId ?? null).toBeNull()
    expect(awayEvent.stoppageGroupId ?? null).toBeNull()
  })

  it('does not link two confirms from the same team', () => {
    let state = startedMatchWithBothTeams()
    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:10')
    state = setDraftPair(state, 'HOME', 0, 'in', 'HOME:15')
    state = confirmDraft(state, 'HOME', 5_000).state

    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:9')
    state = setDraftPair(state, 'HOME', 0, 'in', 'HOME:16')
    state = confirmDraft(state, 'HOME', 8_000).state

    const [first, second] = state.substitutionEvents
    expect(first.stoppageGroupId ?? null).toBeNull()
    expect(second.stoppageGroupId ?? null).toBeNull()
  })

  it('lets the operator manually link and unlink events the auto-guess missed', () => {
    let state = startedMatchWithBothTeams()
    state = setDraftPair(state, 'HOME', 0, 'out', 'HOME:10')
    state = setDraftPair(state, 'HOME', 0, 'in', 'HOME:15')
    state = confirmDraft(state, 'HOME', 5_000).state

    state = setDraftPair(state, 'AWAY', 0, 'out', 'AWAY:10')
    state = setDraftPair(state, 'AWAY', 0, 'in', 'AWAY:15')
    state = confirmDraft(state, 'AWAY', 5 * 60_000).state // too far apart to auto-link

    const [homeEvent, awayEvent] = state.substitutionEvents
    expect(homeEvent.stoppageGroupId ?? null).toBeNull()

    state = linkToNearestOpposingEvent(state, homeEvent.id)
    const linked = state.substitutionEvents
    expect(linked[0].stoppageGroupId).not.toBeNull()
    expect(linked[0].stoppageGroupId).toBe(linked[1].stoppageGroupId)

    state = unlinkStoppageEvent(state, awayEvent.id)
    expect(state.substitutionEvents.find((e) => e.id === awayEvent.id)?.stoppageGroupId ?? null).toBeNull()
    // Unlinking one side does not force-clear the other.
    expect(state.substitutionEvents.find((e) => e.id === homeEvent.id)?.stoppageGroupId ?? null).not.toBeNull()
  })
})

describe('hydration completion (independent of the clock and per-half)', () => {
  it('RUNNING_CLOCK: markHydrationCompleted flags the half without touching the clock', () => {
    let state = createInitialAppState()
    state = updateSettings(state, { hydrationMode: 'RUNNING_CLOCK' })
    state = startFirstHalfPhase(state, 0)
    const clockBefore = state.clock

    state = markHydrationCompleted(state, 'firstHalf')
    expect(state.hydrationCompletedByHalf.firstHalf).toBe(true)
    expect(state.hydrationCompletedByHalf.secondHalf).toBe(false)
    expect(state.clock).toBe(clockBefore)
  })

  it('STOP_CLOCK: completing a pause/resume cycle marks that half done automatically', () => {
    let state = createInitialAppState()
    state = updateSettings(state, { hydrationMode: 'STOP_CLOCK' })
    state = startFirstHalfPhase(state, 0)
    expect(state.hydrationCompletedByHalf.firstHalf).toBe(false)

    state = startHydrationPausePhase(state, 10_000)
    expect(state.hydrationCompletedByHalf.firstHalf).toBe(false) // not yet — only on resume

    state = endHydrationPausePhase(state, 15_000)
    expect(state.hydrationCompletedByHalf.firstHalf).toBe(true)
    // The existing pause/resume clock behavior is unaffected.
    expect(state.clock.pausedAccumulatedMsByHalf.firstHalf).toBe(5_000)
  })

  it('tracks first and second half independently', () => {
    let state = createInitialAppState()
    state = updateSettings(state, { hydrationMode: 'RUNNING_CLOCK' })
    state = startFirstHalfPhase(state, 0)
    state = markHydrationCompleted(state, 'firstHalf')
    state = endFirstHalfPhase(state, 1_800_000)
    state = startSecondHalfPhase(state, 1_800_000)

    expect(state.hydrationCompletedByHalf.firstHalf).toBe(true)
    expect(state.hydrationCompletedByHalf.secondHalf).toBe(false)
  })
})

describe('Phase 2 v0.1: goals do not touch the substitution engine', () => {
  const g = { teamId: 'HOME' as const, scorerNumber: 10, ownGoal: false, ownGoalByNumber: null }

  it('records a goal and the score is derived from the event list', () => {
    let state = startedMatch()
    state = recordGoal(state, g, 'FIRST_HALF', 5 * 60_000)
    state = recordGoal(state, { ...g, teamId: 'AWAY', scorerNumber: 7 }, 'FIRST_HALF', 12 * 60_000)
    expect(state.goalEvents).toHaveLength(2)
    expect(deriveScore(state.goalEvents)).toEqual({ HOME: 1, AWAY: 1 })
    // The substitution state is completely untouched by a goal.
    expect(getDerivedMatchState(state).state.players['HOME:10'].location).toBe('pitch')
  })

  it('supports 得点者未確認 and later editing the scorer', () => {
    let state = startedMatch()
    state = recordGoal(state, { ...g, scorerNumber: null }, 'FIRST_HALF', 3 * 60_000)
    const id = state.goalEvents[0].id
    expect(state.goalEvents[0].scorerNumber).toBeNull()
    expect(deriveScore(state.goalEvents)).toEqual({ HOME: 1, AWAY: 0 })

    state = updateGoalEvent(state, id, { ...g, scorerNumber: 10 })
    expect(state.goalEvents[0].scorerNumber).toBe(10)
  })

  it('records an own goal credited to the beneficiary, with an optional opponent number', () => {
    let state = startedMatch()
    state = recordGoal(state, { teamId: 'HOME', scorerNumber: 99, ownGoal: true, ownGoalByNumber: 4 }, 'SECOND_HALF', 18 * 60_000)
    const og = state.goalEvents[0]
    expect(og.ownGoal).toBe(true)
    expect(og.scorerNumber).toBeNull() // an own goal has no "our" scorer
    expect(og.ownGoalByNumber).toBe(4)
    expect(deriveScore(state.goalEvents)).toEqual({ HOME: 1, AWAY: 0 })
  })

  it('deleting a goal recalculates the score', () => {
    let state = startedMatch()
    state = recordGoal(state, g, 'FIRST_HALF', 5 * 60_000)
    state = recordGoal(state, g, 'SECOND_HALF', 5 * 60_000)
    expect(deriveScore(state.goalEvents)).toEqual({ HOME: 2, AWAY: 0 })
    state = deleteGoalEvent(state, state.goalEvents[0].id)
    expect(deriveScore(state.goalEvents)).toEqual({ HOME: 1, AWAY: 0 })
  })
})

describe('Phase 2 v0.1: cards do not touch the substitution engine', () => {
  const yellow = {
    teamId: 'HOME' as const,
    card: 'YELLOW' as const,
    targetType: 'PLAYER' as const,
    playerNumber: 6,
    officialRole: null,
    officialName: '',
  }

  it('records a player yellow without affecting substitution state', () => {
    let state = startedMatch()
    state = recordCard(state, yellow, 'FIRST_HALF', 21 * 60_000)
    expect(state.cardEvents).toHaveLength(1)
    expect(getDerivedMatchState(state).state.players['HOME:6']?.location ?? 'pitch').toBe('pitch')
  })

  it('records a red card with no effect on the 9/3/3 counters or reentry', () => {
    let state = startedMatch()
    state = endFirstHalfPhase(state, 1_800_000)
    state = startSecondHalfPhase(state, 1_800_000)
    state = recordCard(state, { ...yellow, card: 'RED', playerNumber: 3 }, 'SECOND_HALF', 27 * 60_000)
    const derived = getDerivedMatchState(state)
    expect(derived.state.teamCounters.HOME.secondHalfOpportunitiesUsed).toBe(0)
    expect(derived.state.teamCounters.HOME.reentryPlayerIds).toEqual([])
  })

  it('records a team official card with role and optional name', () => {
    let state = startedMatch()
    state = recordCard(
      state,
      { teamId: 'AWAY', card: 'YELLOW', targetType: 'OFFICIAL', playerNumber: null, officialRole: 'MANAGER', officialName: ' 山田 ' },
      'SECOND_HALF',
      35 * 60_000,
    )
    const c = state.cardEvents[0]
    expect(c.targetType).toBe('OFFICIAL')
    expect(c.officialRole).toBe('MANAGER')
    expect(c.officialName).toBe('山田') // trimmed
    expect(c.playerNumber).toBeNull()
  })

  it('editing then deleting a card leaves the list consistent', () => {
    let state = startedMatch()
    state = recordCard(state, yellow, 'FIRST_HALF', 10 * 60_000)
    const id = state.cardEvents[0].id
    state = updateCardEvent(state, id, { ...yellow, card: 'RED' })
    expect(state.cardEvents[0].card).toBe('RED')
    state = deleteCardEvent(state, id)
    expect(state.cardEvents).toHaveLength(0)
  })
})

describe('hydration completion records a timeline elapsed time', () => {
  it('RUNNING_CLOCK: markHydrationCompleted stores the given elapsed once', () => {
    let state = createInitialAppState()
    state = updateSettings(state, { hydrationMode: 'RUNNING_CLOCK' })
    state = startFirstHalfPhase(state, 0)
    state = markHydrationCompleted(state, 'firstHalf', 5 * 60_000)
    expect(state.hydrationCompletionElapsedMsByHalf.firstHalf).toBe(5 * 60_000)
    // A second call does not overwrite the first hydration time.
    state = markHydrationCompleted(state, 'firstHalf', 9 * 60_000)
    expect(state.hydrationCompletionElapsedMsByHalf.firstHalf).toBe(5 * 60_000)
  })

  it('STOP_CLOCK: ending the pause records the elapsed at pause start', () => {
    let state = createInitialAppState()
    state = updateSettings(state, { hydrationMode: 'STOP_CLOCK' })
    state = startFirstHalfPhase(state, 0)
    state = startHydrationPausePhase(state, 10 * 60_000)
    state = endHydrationPausePhase(state, 12 * 60_000)
    expect(state.hydrationCompletionElapsedMsByHalf.firstHalf).toBe(10 * 60_000)
  })
})

describe('phase transitions drive the clock', () => {
  it('starting the first half timestamps the clock, and elapsed time is derivable later', () => {
    let state = createInitialAppState()
    state = startFirstHalfPhase(state, 1_000)
    expect(state.phase).toBe('FIRST_HALF')
    expect(computeElapsedMs(state.clock, 'FIRST_HALF', 61_000)).toBe(60_000)
  })

  it('ending the first half moves to HALF_TIME', () => {
    let state = createInitialAppState()
    state = startFirstHalfPhase(state, 0)
    state = endFirstHalfPhase(state, 1_800_000)
    expect(state.phase).toBe('HALF_TIME')
  })
})
