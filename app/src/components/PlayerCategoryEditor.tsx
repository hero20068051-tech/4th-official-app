import { useState } from 'react'
import type { RuleSet } from '../domain/rulesets'
import type { Player, PlayerCategory } from '../domain/types'

interface PlayerCategoryEditorProps {
  rules: RuleSet
  players: Player[]
  onAssign: (playerIds: string[], category: PlayerCategory) => string[]
  onAssignUnset: (category: PlayerCategory) => string[]
}

// Setting each player's category by tapping numbers (like the number picker),
// not by a drop-down per player: tap the numbers, then tap the category
// button. "未設定の残りを小学生に" is an explicit bulk action; nothing is ever
// defaulted silently.
export function PlayerCategoryEditor({ rules, players, onAssign, onAssignUnset }: PlayerCategoryEditorProps) {
  const options = rules.playerCategories
  const [selected, setSelected] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  if (options === null || players.length === 0) return null

  const sorted = [...players].sort((a, b) => a.number - b.number)
  const unsetCount = sorted.filter((p) => p.category === undefined).length
  const selectedSet = new Set(selected)

  function toggle(id: string) {
    setErrors([])
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function assign(category: PlayerCategory) {
    const result = onAssign(selected, category)
    setErrors(result)
    if (result.length === 0) setSelected([])
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-300 bg-white p-3">
      <p className="text-sm font-medium text-gray-700">選手区分</p>
      <p className="mt-0.5 text-xs text-gray-500">番号をタップして選び、下のボタンで区分を決めます。</p>

      <div className="mt-2 grid grid-cols-5 gap-2">
        {sorted.map((p) => {
          const option = options.find((o) => o.id === p.category)
          const on = selectedSet.has(p.id)
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              aria-label={`${p.number}番（${option ? option.label : '未設定'}）`}
              onClick={() => toggle(p.id)}
              className={`flex h-12 flex-col items-center justify-center rounded-lg border leading-none ${
                on
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : option
                    ? 'border-gray-300 bg-white text-gray-800 active:bg-gray-100'
                    : 'border-dashed border-red-400 bg-red-50 text-gray-800 active:bg-red-100'
              }`}
            >
              <span className="text-lg font-bold tabular-nums">{p.number}</span>
              <span className="mt-0.5 text-[10px] font-medium opacity-80">{option ? option.shortLabel : '未設定'}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={selected.length === 0}
            onClick={() => assign(o.id)}
            className="rounded-lg bg-gray-900 py-3 text-sm font-medium text-white active:bg-gray-700 disabled:bg-gray-300"
          >
            {o.label}にする
          </button>
        ))}
      </div>

      {unsetCount > 0 && (
        <button
          type="button"
          onClick={() => setErrors(onAssignUnset('ELEMENTARY'))}
          className="mt-2 w-full rounded-lg border border-gray-300 py-2 text-sm text-gray-700 active:bg-gray-100"
        >
          未設定の{unsetCount}名を小学生にする
        </button>
      )}

      {errors.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm font-medium text-red-600">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
