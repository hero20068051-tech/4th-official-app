import { formatElapsed } from './clock'
import type { ClockState, HalfKey } from './matchTypes'
import type { CardEvent, GoalEvent, RecordablePhase, SubstitutionEvent, TeamId } from './types'

// Human label for a recorded moment. HALF_TIME / FULL_TIME show no clock
// time (it would be the frozen end-of-half value and read as confusing).
export function formatTimelineMoment(phase: RecordablePhase, elapsedMs: number): string {
  if (phase === 'HALF_TIME') return 'ハーフタイム'
  if (phase === 'FULL_TIME') return '試合終了後'
  const half = phase === 'FIRST_HALF' ? '前半' : '後半'
  return `${half} ${formatElapsed(elapsedMs)}`
}

// --- Phase 2 v0.1 derivations ---
// Goals and cards never touch engine.ts. Everything a caller needs about
// them (score, "何枚目", timeline order) is recomputed from the raw event
// arrays here, so an edit or a delete always leaves derived values correct.

const PHASE_ORDER: Record<RecordablePhase, number> = {
  FIRST_HALF: 0,
  HALF_TIME: 1,
  SECOND_HALF: 2,
  FULL_TIME: 3,
}

export function deriveScore(goalEvents: GoalEvent[]): Record<TeamId, number> {
  const score: Record<TeamId, number> = { HOME: 0, AWAY: 0 }
  for (const goal of goalEvents) {
    score[goal.teamId] += 1
  }
  return score
}

function cardTimelineKey(card: CardEvent): number {
  return PHASE_ORDER[card.phase] * 1e12 + card.elapsedMs
}

// How many yellow cards this player already has recorded (used to warn the
// operator at entry time — never to auto-decide a send-off).
export function countPlayerYellows(cardEvents: CardEvent[], teamId: TeamId, playerNumber: number): number {
  return cardEvents.filter(
    (c) =>
      c.card === 'YELLOW' && c.targetType === 'PLAYER' && c.teamId === teamId && c.playerNumber === playerNumber,
  ).length
}

// 1-based ordinal of a given yellow among that player's yellows, in timeline
// order — or null if the card is not a player yellow. Recomputed every
// render, so deleting an earlier yellow renumbers the rest automatically.
export function playerYellowOrdinal(cardEvents: CardEvent[], cardEventId: string): number | null {
  const target = cardEvents.find((c) => c.id === cardEventId)
  if (!target || target.card !== 'YELLOW' || target.targetType !== 'PLAYER') return null
  const siblings = cardEvents
    .filter(
      (c) =>
        c.card === 'YELLOW' &&
        c.targetType === 'PLAYER' &&
        c.teamId === target.teamId &&
        c.playerNumber === target.playerNumber,
    )
    .sort((a, b) => cardTimelineKey(a) - cardTimelineKey(b) || (a.id < b.id ? -1 : 1))
  return siblings.findIndex((c) => c.id === cardEventId) + 1
}

// --- Unified match timeline ---

export type TimelineEntry = {
  key: string
  phase: RecordablePhase
  elapsedMs: number // -1 for phase markers (they anchor to the start of their phase bucket)
} & (
  | { kind: 'MARKER'; label: string }
  | { kind: 'HYDRATION'; half: HalfKey }
  | { kind: 'GOAL'; goal: GoalEvent }
  | { kind: 'CARD'; card: CardEvent }
  | { kind: 'SUB_SINGLE'; event: SubstitutionEvent }
  | { kind: 'SUB_GROUP'; events: SubstitutionEvent[] }
)

interface BuildTimelineArgs {
  substitutionEvents: SubstitutionEvent[]
  goalEvents: GoalEvent[]
  cardEvents: CardEvent[]
  clock: ClockState
  hydrationCompletionElapsedMsByHalf: Record<HalfKey, number | null>
}

const KIND_RANK: Record<TimelineEntry['kind'], number> = {
  MARKER: 0,
  GOAL: 1,
  CARD: 2,
  SUB_SINGLE: 3,
  SUB_GROUP: 3,
  HYDRATION: 4,
}

export function buildTimeline(args: BuildTimelineArgs): TimelineEntry[] {
  const { substitutionEvents, goalEvents, cardEvents, clock, hydrationCompletionElapsedMsByHalf } = args
  const staged: Array<{ entry: TimelineEntry; order: number }> = []
  let order = 0
  const add = (entry: TimelineEntry) => staged.push({ entry, order: order++ })

  // Phase boundary markers, derived from the clock (not stored as events).
  if (clock.firstHalfStartedAt !== null) {
    add({ key: 'marker:first-start', kind: 'MARKER', label: '前半開始', phase: 'FIRST_HALF', elapsedMs: -1 })
  }
  if (clock.firstHalfEndedAt !== null) {
    add({ key: 'marker:first-end', kind: 'MARKER', label: '前半終了', phase: 'HALF_TIME', elapsedMs: -1 })
  }
  if (clock.secondHalfStartedAt !== null) {
    add({ key: 'marker:second-start', kind: 'MARKER', label: '後半開始', phase: 'SECOND_HALF', elapsedMs: -1 })
  }
  if (clock.secondHalfEndedAt !== null) {
    add({ key: 'marker:second-end', kind: 'MARKER', label: '試合終了', phase: 'FULL_TIME', elapsedMs: -1 })
  }

  // Hydration markers (one per half, at the moment it was marked done).
  const firstHydration = hydrationCompletionElapsedMsByHalf.firstHalf
  if (firstHydration !== null) {
    add({ key: 'hydration:firstHalf', kind: 'HYDRATION', half: 'firstHalf', phase: 'FIRST_HALF', elapsedMs: firstHydration })
  }
  const secondHydration = hydrationCompletionElapsedMsByHalf.secondHalf
  if (secondHydration !== null) {
    add({ key: 'hydration:secondHalf', kind: 'HYDRATION', half: 'secondHalf', phase: 'SECOND_HALF', elapsedMs: secondHydration })
  }

  for (const goal of goalEvents) {
    add({ key: goal.id, kind: 'GOAL', goal, phase: goal.phase, elapsedMs: goal.elapsedMs })
  }
  for (const card of cardEvents) {
    add({ key: card.id, kind: 'CARD', card, phase: card.phase, elapsedMs: card.elapsedMs })
  }

  // Substitutions — the existing "same play stoppage" grouping is preserved:
  // linked pairs become one entry anchored at the earlier member.
  const consumed = new Set<string>()
  for (const event of substitutionEvents) {
    if (consumed.has(event.id)) continue
    const partner = event.stoppageGroupId
      ? substitutionEvents.find((e) => e.id !== event.id && e.stoppageGroupId === event.stoppageGroupId)
      : undefined
    if (partner) {
      consumed.add(event.id)
      consumed.add(partner.id)
      const members = [event, partner].sort(
        (a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || a.elapsedMs - b.elapsedMs,
      )
      add({
        key: `group:${event.stoppageGroupId}`,
        kind: 'SUB_GROUP',
        events: members,
        phase: members[0].phase,
        elapsedMs: members[0].elapsedMs,
      })
    } else {
      consumed.add(event.id)
      add({ key: event.id, kind: 'SUB_SINGLE', event, phase: event.phase, elapsedMs: event.elapsedMs })
    }
  }

  staged.sort((a, b) => {
    const pa = PHASE_ORDER[a.entry.phase]
    const pb = PHASE_ORDER[b.entry.phase]
    if (pa !== pb) return pa - pb
    if (a.entry.elapsedMs !== b.entry.elapsedMs) return a.entry.elapsedMs - b.entry.elapsedMs
    const ra = KIND_RANK[a.entry.kind]
    const rb = KIND_RANK[b.entry.kind]
    if (ra !== rb) return ra - rb
    return a.order - b.order
  })

  return staged.map((s) => s.entry)
}
