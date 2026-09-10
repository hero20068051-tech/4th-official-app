import type { TeamId } from '../domain/types'

// Color is always paired with the team's own name label, never used alone,
// so HOME/AWAY still read correctly without relying on color vision
// (LOCKED principle: 色だけで状態を伝えない).
const TEAM_DOT_CLASS: Record<TeamId, string> = {
  HOME: 'bg-blue-500',
  AWAY: 'bg-orange-500',
}

export function TeamDot({ teamId }: { teamId: TeamId }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${TEAM_DOT_CLASS[teamId]}`}
      aria-hidden="true"
    />
  )
}

export function TeamBadge({ teamId, label }: { teamId: TeamId; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <TeamDot teamId={teamId} />
      <span className="font-semibold text-gray-700">{label}</span>
    </span>
  )
}
