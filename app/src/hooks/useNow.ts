import { useEffect, useState } from 'react'

// Re-renders periodically so elapsed time (always derived from stored
// timestamps, never accumulated) stays visually up to date. The tick itself
// carries no state of truth — a reload just recomputes from the clock.
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
