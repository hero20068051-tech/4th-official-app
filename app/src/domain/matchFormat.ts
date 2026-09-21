import type { CardEvent, GoalEvent, TeamId, TeamOfficialRole } from './types'

// Plain-text wording for recorded events, shared by the live timeline and the
// read-only past-match view (and reusable by a future "share result" feature).

export const OFFICIAL_ROLE_LABELS: Record<TeamOfficialRole, string> = {
  MANAGER: '監督',
  COACH: 'コーチ',
  STAFF: 'スタッフ',
  OTHER: 'その他',
}

export function goalSummary(goal: GoalEvent, teamLabels: Record<TeamId, string>): string {
  if (goal.ownGoal) {
    const other = goal.teamId === 'HOME' ? 'AWAY' : 'HOME'
    return goal.ownGoalByNumber !== null
      ? `⚽ OG（${teamLabels[other]} #${goal.ownGoalByNumber}）`
      : '⚽ OG'
  }
  return goal.scorerNumber !== null ? `⚽ 得点 #${goal.scorerNumber}` : '⚽ 得点（得点者未確認）'
}

export function cardSummary(card: CardEvent, ordinal: number | null): string {
  const mark = card.card === 'YELLOW' ? '🟨 警告' : '🟥 退場'
  if (card.targetType === 'OFFICIAL') {
    const role = card.officialRole ? OFFICIAL_ROLE_LABELS[card.officialRole] : '役員'
    return card.officialName ? `${mark} ${role}（${card.officialName}）` : `${mark} ${role}`
  }
  const base = `${mark} #${card.playerNumber ?? '?'}`
  return ordinal !== null && ordinal >= 2 ? `${base}（${ordinal}枚目）` : base
}
