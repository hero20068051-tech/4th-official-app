import type { AppState } from './matchStore'

const STORAGE_KEY = 'fourth-official-app:match:v1'

// SPEC/Phase1_Spec_v0.2.md section 15: save on every meaningful change so a
// reload or closed tab can offer "continue where you left off". A full-time
// match record is kept until the operator explicitly chooses to start a new
// one, never cleared just because a new match screen is opened.
export function saveMatchState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage can be unavailable (private browsing, quota); losing
    // auto-save is not fatal to the current session.
  }
}

export function loadMatchState(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.phase || !Array.isArray(parsed.roster)) {
      return null
    }
    // Matches saved by an earlier version won't have every field. Default
    // each missing one so a resume never crashes and Phase 1 data keeps
    // working unchanged.
    if (!parsed.hydrationCompletedByHalf) {
      parsed.hydrationCompletedByHalf = { firstHalf: false, secondHalf: false }
    }
    if (!parsed.hydrationCompletionElapsedMsByHalf) {
      parsed.hydrationCompletionElapsedMsByHalf = { firstHalf: null, secondHalf: null }
    }
    if (!Array.isArray(parsed.goalEvents)) {
      parsed.goalEvents = []
    }
    if (!Array.isArray(parsed.cardEvents)) {
      parsed.cardEvents = []
    }
    return parsed as AppState
  } catch {
    return null
  }
}

export function clearMatchState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
