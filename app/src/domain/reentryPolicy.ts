import type { Player, PlayerRuntimeState } from './types'

/**
 * Whether the same player may re-enter more than once in a match is
 * PENDING per PROJECT_RULES/04_PENDING.md — it is under confirmation with
 * the tournament organizer and must not be guessed at (allowed or
 * disallowed) by this codebase.
 *
 * This module isolates that single unresolved question so the rest of the
 * substitution engine never encodes an opinion about it. Once an answer is
 * confirmed, only this file (and its tests) should need to change.
 *
 * Current behavior: a player's *second* re-entry attempt is blocked with a
 * message explaining the rule is not yet confirmed, rather than silently
 * allowed or silently denied as a permanent ruling.
 */
export interface ReentryPolicyDecision {
  allowed: boolean
  message?: string
}

export interface ReentryPolicy {
  checkRepeatReentry(player: Player, runtime: PlayerRuntimeState): ReentryPolicyDecision
}

export const pendingConfirmationReentryPolicy: ReentryPolicy = {
  checkRepeatReentry(player, runtime) {
    if (runtime.reentryCount >= 1) {
      return {
        allowed: false,
        message: `${player.number}番はすでに一度再出場しています。2回目以降の再出場は大会ルール未確定のため、現時点では行えません。`,
      }
    }
    return { allowed: true }
  },
}
