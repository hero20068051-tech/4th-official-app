import { DEFAULT_RULESET_ID, type RuleSetId } from './ids'
import { saitamaWomenRules } from './saitamaWomen'
import { u13DevelopmentRules } from './u13Development'
import type { RuleSet } from './types'

export { DEFAULT_RULESET_ID } from './ids'
export type { RuleSetId } from './ids'
export type { RuleSet } from './types'

const RULESETS: Record<RuleSetId, RuleSet> = {
  'saitama-women': saitamaWomenRules,
  'u13-development': u13DevelopmentRules,
}

export function getRuleSet(id: RuleSetId): RuleSet {
  return RULESETS[id]
}

export function listRuleSets(): RuleSet[] {
  return Object.values(RULESETS)
}

// The rules a match is played under. Matches saved before rule sets existed
// (or with an id this version does not know) read as the Saitama women's
// league — the rules they were played under.
export function ruleSetOf(settings: { rulesetId?: string }): RuleSet {
  const id = settings.rulesetId
  return id !== undefined && Object.hasOwn(RULESETS, id) ? RULESETS[id as RuleSetId] : RULESETS[DEFAULT_RULESET_ID]
}
