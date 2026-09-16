import { useRef, useState } from 'react'
import { MAX_NUMBER, MAX_SQUAD_SIZE, MIN_NUMBER } from '../domain/matchSetup'
import type { TeamId } from '../domain/types'

interface PlayerNumberPickerProps {
  teamId: TeamId
  existingNumbers: number[]
  onAddPlayers: (teamId: TeamId, rawInput: string) => string[]
}

interface DecadeGroup {
  label: string
  numbers: number[]
}

// 1-9, then 10-19, 20-29, ... 90-99 — every decade gets its own labeled
// section so a long, spread-out roster (e.g. 1, 15, 38, 77, 99) stays easy to
// scan, without forcing all 99 buttons onto one screen at a shrunken size.
function buildDecades(): DecadeGroup[] {
  const groups: DecadeGroup[] = []
  // First group is 1-9 (the "ones" before the first full ten); every group
  // after that is a plain ten (10-19, 20-29, ... 90-99), matching how people
  // actually say "10番台" / "20番台".
  groups.push({ label: `${MIN_NUMBER}〜9`, numbers: Array.from({ length: 9 }, (_, i) => MIN_NUMBER + i) })
  for (let start = 10; start <= MAX_NUMBER; start += 10) {
    const end = Math.min(start + 9, MAX_NUMBER)
    groups.push({ label: `${start}〜${end}`, numbers: Array.from({ length: end - start + 1 }, (_, i) => start + i) })
  }
  return groups
}

const DECADES = buildDecades()

export function PlayerNumberPicker({ teamId, existingNumbers, onAddPlayers }: PlayerNumberPickerProps) {
  const [selected, setSelected] = useState<number[]>([])
  const [capError, setCapError] = useState<string | null>(null)
  const [addErrors, setAddErrors] = useState<string[]>([])
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const existingSet = new Set(existingNumbers)
  const selectedSet = new Set(selected)
  const sortedSelected = [...selected].sort((a, b) => a - b)

  function handleTap(n: number) {
    if (existingSet.has(n)) return

    if (selectedSet.has(n)) {
      setSelected((prev) => prev.filter((x) => x !== n))
      setCapError(null)
      return
    }

    if (existingSet.size + selected.length >= MAX_SQUAD_SIZE) {
      setCapError(`登録は${MAX_SQUAD_SIZE}名までです`)
      return
    }

    setCapError(null)
    setSelected((prev) => [...prev, n])
  }

  function handleRegister() {
    if (sortedSelected.length === 0) return
    const errors = onAddPlayers(teamId, sortedSelected.join(','))
    if (errors.length === 0) {
      setSelected([])
      setAddErrors([])
      setCapError(null)
      return
    }
    setAddErrors(errors)
  }

  function scrollToDecade(label: string) {
    sectionRefs.current[label]?.scrollIntoView({ block: 'start' })
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-300 bg-white">
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 bg-white p-2">
        {DECADES.map((d) => (
          <button
            key={d.label}
            type="button"
            onClick={() => scrollToDecade(d.label)}
            className="shrink-0 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 active:bg-gray-100"
          >
            {d.label.split('〜')[0]}
          </button>
        ))}
      </div>

      <div className="max-h-72 overflow-y-auto p-3">
        {DECADES.map((d) => (
          <div key={d.label} ref={(el) => { sectionRefs.current[d.label] = el }} className="mb-3 last:mb-0">
            <p className="sticky top-0 mb-1 bg-white py-0.5 text-xs font-medium text-gray-400">{d.label}</p>
            <div className="grid grid-cols-5 gap-2">
              {d.numbers.map((n) => {
                const isExisting = existingSet.has(n)
                const isSelected = selectedSet.has(n)
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={isExisting}
                    onClick={() => handleTap(n)}
                    aria-label={isExisting ? `${n}番は登録済みです` : `${n}番を選択`}
                    className={`h-12 rounded-lg border text-lg font-bold tabular-nums ${
                      isExisting
                        ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-300'
                        : isSelected
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-gray-300 bg-white text-gray-800 active:bg-gray-100'
                    }`}
                  >
                    {isExisting ? '済' : n}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 p-3">
        <p className="text-sm text-gray-700">選択済み {sortedSelected.length}名</p>
        {sortedSelected.length > 0 && (
          <p className="mt-1 font-mono text-sm text-gray-900">{sortedSelected.join(' / ')}</p>
        )}
        {capError && <p className="mt-2 text-sm font-medium text-red-600">{capError}</p>}
        {addErrors.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-red-600">
            {addErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={handleRegister}
          disabled={sortedSelected.length === 0}
          className="mt-2 w-full rounded-lg bg-gray-900 px-4 py-3 text-base font-medium text-white active:bg-gray-700 disabled:bg-gray-300"
        >
          この内容で登録する
        </button>
      </div>
    </div>
  )
}
