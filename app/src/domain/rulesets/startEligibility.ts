import type { StartEligibility } from './types'

// 03_PHASE1_SCOPE.md section 3 / 02_CONFIRMED_RULES.md section D (CONFIRMED,
// do not reinterpret): 11 starters = normal start, 7-10 = warn-then-allow,
// 6 or fewer = cannot start. Shared by every rule set that uses this
// eleven-a-side kick-off rule.
export function standardStartEligibility(starterCount: number): StartEligibility {
  if (starterCount <= 6) {
    return { level: 'BLOCK', message: '7人未満のため開始できません' }
  }
  if (starterCount <= 10) {
    return {
      level: 'WARN',
      message: `先発が${starterCount}人です。この人数のまま開始しますか？`,
    }
  }
  return { level: 'OK' }
}
