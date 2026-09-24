// Which tournament's rules a match is played under. Stored in the match
// settings; a match saved before rule sets existed has none, and reads as the
// Saitama women's league (the only rules the app had).
export type RuleSetId = 'saitama-women'

export const DEFAULT_RULESET_ID: RuleSetId = 'saitama-women'
