import type { Player, PlayerRuntimeState } from './types'

/**
 * Whether the same player may re-enter more than once in a match is
 * PENDING per PROJECT_RULES/04_PENDING.md — see the Saitama women's league
 * rule set (rulesets/saitamaWomen.ts), where this single unresolved question
 * is isolated.
 */
export interface ReentryPolicyDecision {
  allowed: boolean
  message?: string
}

export interface ReentryPolicy {
  checkRepeatReentry(player: Player, runtime: PlayerRuntimeState): ReentryPolicyDecision
}

// Backward-compatible name used by the existing tests, which pass "the policy"
// to the engine: what they meant is the Saitama women's league rules, which
// is now a complete rule set. The app itself asks ruleSetOf(match settings).
export { saitamaWomenRules as pendingConfirmationReentryPolicy } from './rulesets/saitamaWomen'
