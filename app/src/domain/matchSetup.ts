import type { HydrationMode, MatchSettings } from './matchTypes'

export const MIN_NUMBER = 1
export const MAX_NUMBER = 99
export const MAX_SQUAD_SIZE = 20
export const MAX_STARTERS = 11

export function defaultMatchSettings(): MatchSettings {
  return {
    homeTeamName: '',
    awayTeamName: '',
    halfLengthMinutes: 30,
    hydrationMode: 'NONE',
    hydrationMemo: '',
  }
}

export function displayTeamName(name: string, fallback: 'HOME' | 'AWAY'): string {
  return name.trim().length > 0 ? name.trim() : fallback
}

export interface ParsedNumberList {
  numbers: number[]
  errors: string[]
}

// Accepts comma-separated (half or full width), Japanese ideographic-comma
// separated, and whitespace-separated bulk entry — e.g. "4, 60, 11",
// "4、60、11", "4，60，11", or "4 60 11" (SPEC/Phase1_Spec_v0.2.md 4.1).
// The operator should not have to remember one exact format: an IME in
// full-width mode commonly produces full-width digits and commas (e.g.
// "１，２，３"), so the input is Unicode-normalized (NFKC) first, which
// folds full-width digits/comma/space to their ASCII equivalents. The
// ideographic comma "、" does not have such a mapping and is matched
// explicitly instead.
export function parseNumberList(input: string): ParsedNumberList {
  const tokens = input
    .normalize('NFKC')
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  const numbers: number[] = []
  const errors: string[] = []
  const seenInBatch = new Set<number>()

  for (const token of tokens) {
    if (!/^\d+$/.test(token)) {
      errors.push(`「${token}」は背番号として認識できません`)
      continue
    }
    const n = Number(token)
    if (n < MIN_NUMBER || n > MAX_NUMBER) {
      errors.push(`${n}番は1〜99の範囲外です`)
      continue
    }
    if (seenInBatch.has(n)) {
      errors.push(`${n}番が重複して入力されています`)
      continue
    }
    seenInBatch.add(n)
    numbers.push(n)
  }

  return { numbers: numbers.sort((a, b) => a - b), errors }
}

export function findDuplicateNumbers(existing: number[], incoming: number[]): number[] {
  const existingSet = new Set(existing)
  return incoming.filter((n) => existingSet.has(n)).sort((a, b) => a - b)
}

export type StartEligibility =
  | { level: 'OK' }
  | { level: 'WARN'; message: string }
  | { level: 'BLOCK'; message: string }

// 03_PHASE1_SCOPE.md section 3 / 02_CONFIRMED_RULES.md section D (CONFIRMED,
// do not reinterpret): 11 starters = normal start, 7-10 = warn-then-allow,
// 6 or fewer = cannot start.
export function evaluateStartEligibility(starterCount: number): StartEligibility {
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

export function isValidHalfLength(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes > 0
}

export const HYDRATION_MODE_LABELS: Record<HydrationMode, string> = {
  NONE: 'なし',
  RUNNING_CLOCK: 'あり・ランニング（時計は止めない）',
  STOP_CLOCK: 'あり・時計停止',
}

// The hydration memo stays free text (e.g. "15分頃", "前半半ば") — the
// timing is the match commissioner/referee's call, not the app's. This only
// pulls out the first number, if any, so the match screen can show a
// reminder near that point; memos with no number just display as-is.
export function parseHydrationTargetMinutes(memo: string): number | null {
  const match = memo.match(/\d+/)
  if (!match) return null
  const n = Number(match[0])
  return Number.isFinite(n) && n > 0 ? n : null
}

// "まもなく" should read as imminent, not merely upcoming — from about 1
// minute before the target until the target itself. This is a passive
// on-screen reminder only; the referee/match commissioner still decide when
// hydration actually happens.
export function isNearHydrationTarget(elapsedMs: number, targetMinutes: number): boolean {
  const elapsedMinutes = elapsedMs / 60000
  return elapsedMinutes >= targetMinutes - 1 && elapsedMinutes < targetMinutes
}

export function isPastHydrationTarget(elapsedMs: number, targetMinutes: number): boolean {
  return elapsedMs / 60000 >= targetMinutes
}
