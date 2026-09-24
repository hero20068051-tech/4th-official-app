import { useState } from 'react'
import { parseElapsedInput } from '../domain/clock'
import type { MoveToSecondHalfPreview, SecondHalfMove } from '../domain/matchStore'

export type MoveToSecondHalfPreviewView = MoveToSecondHalfPreview & { opportunitiesConsumed: number }

interface MoveToSecondHalfFormProps {
  pairLabels: string[]
  preview: (moves: SecondHalfMove[]) => MoveToSecondHalfPreviewView
  // Returns error messages; empty means it was applied.
  onApply: (moves: SecondHalfMove[]) => string[]
  onCancel: () => void
}

interface MinSec {
  m: string
  s: string
}
const EMPTY: MinSec = { m: '', s: '' }

function parseMinSec(t: MinSec): { ok: true; ms: number } | { ok: false; error: string } {
  if (t.m.trim() === '' && t.s.trim() === '') return { ok: false, error: '後半の経過時間を入力してください' }
  // Same "m:s" parsing and safety cap as the other minute/second inputs.
  return parseElapsedInput(`${t.m.trim() === '' ? '0' : t.m.trim()}:${t.s.trim() === '' ? '0' : t.s.trim()}`)
}

function TimeInput({ value, onChange }: { value: MinSec; onChange: (v: MinSec) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value.m}
        onChange={(e) => onChange({ ...value, m: e.target.value })}
        placeholder="2"
        aria-label="分"
        className="w-16 rounded border border-gray-300 px-2 py-2 text-center text-base"
      />
      <span className="text-sm">分</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={59}
        value={value.s}
        onChange={(e) => onChange({ ...value, s: e.target.value })}
        placeholder="15"
        aria-label="秒"
        className="w-16 rounded border border-gray-300 px-2 py-2 text-center text-base"
      />
      <span className="text-sm">秒</span>
    </div>
  )
}

// Re-files half-time pairs as second-half substitutions. Everything the app
// can't know is asked, never guessed: which pairs, whether they were one
// occasion or several (that decides how many of the 3 second-half
// opportunities are used), and the real second-half time.
export function MoveToSecondHalfForm({ pairLabels, preview, onApply, onCancel }: MoveToSecondHalfFormProps) {
  const single = pairLabels.length === 1
  const [checked, setChecked] = useState<boolean[]>(() => pairLabels.map(() => single))
  const [mode, setMode] = useState<'same' | 'separate' | null>(null)
  const [sharedTime, setSharedTime] = useState<MinSec>(EMPTY)
  const [pairTimes, setPairTimes] = useState<MinSec[]>(() => pairLabels.map(() => EMPTY))
  const [applyErrors, setApplyErrors] = useState<string[]>([])

  const selected = checked.flatMap((c, i) => (c ? [i] : []))
  const needsMode = selected.length >= 2
  const perPairTimes = needsMode && mode === 'separate'

  // Build the moves (or the reason they can't be built yet).
  let moves: SecondHalfMove[] = []
  let problem: string | null = null
  if (selected.length === 0) {
    problem = '後半へ移す交代を選んでください'
  } else if (needsMode && mode === null) {
    problem = '同じタイミングか、別々かを選んでください'
  } else if (perPairTimes) {
    for (const i of selected) {
      const r = parseMinSec(pairTimes[i])
      if (!r.ok) {
        problem = `${pairLabels[i]} の${r.error}`
        break
      }
      moves.push({ pairIndexes: [i], elapsedMs: r.ms })
    }
    if (problem) moves = []
  } else {
    const r = parseMinSec(sharedTime)
    if (!r.ok) problem = r.error
    else moves = [{ pairIndexes: selected, elapsedMs: r.ms }]
  }

  const result = problem ? null : preview(moves)
  const occasions = result ? result.opportunitiesConsumed : 0

  function toggle(i: number) {
    setChecked((prev) => prev.map((c, k) => (k === i ? !c : c)))
    setApplyErrors([])
  }

  function apply() {
    if (problem) {
      setApplyErrors([problem])
      return
    }
    const errors = onApply(moves)
    if (errors.length > 0) setApplyErrors(errors)
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-gray-900">この交代を「ハーフタイム」から「後半」の記録に変更します</p>

      <div>
        <p className="text-xs font-medium text-gray-600">後半に行った交代を選ぶ</p>
        <div className="mt-1 flex flex-col gap-2">
          {pairLabels.map((label, i) => (
            <button
              key={label + i}
              type="button"
              aria-pressed={checked[i]}
              onClick={() => toggle(i)}
              className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-base font-semibold ${
                checked[i] ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-800'
              }`}
            >
              <span aria-hidden>{checked[i] ? '✔' : '□'}</span>
              {label}
              {!checked[i] && <span className="ml-auto text-xs font-normal text-gray-400">ハーフタイムのまま</span>}
            </button>
          ))}
        </div>
      </div>

      {needsMode && (
        <div>
          <p className="text-xs font-medium text-gray-600">実際のタイミングは？</p>
          <div className="mt-1 flex flex-col gap-2">
            {(
              [
                ['same', `同じタイミング（後半の交代機会 1回）`],
                ['separate', `別々のタイミング（後半の交代機会 ${selected.length}回）`],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value)
                  setApplyErrors([])
                }}
                className={`min-h-11 rounded-lg border px-3 py-2 text-left text-base font-medium ${
                  mode === value ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-800'
                }`}
              >
                {mode === value ? '● ' : '○ '}
                {text}
              </button>
            ))}
          </div>
        </div>
      )}

      {selected.length > 0 && (!needsMode || mode !== null) && (
        <div>
          <p className="text-xs font-medium text-gray-600">実際の後半の経過時間</p>
          {perPairTimes ? (
            <div className="mt-1 space-y-2">
              {selected.map((i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="w-20 text-base font-semibold text-gray-800">{pairLabels[i]}</span>
                  <TimeInput
                    value={pairTimes[i]}
                    onChange={(v) => {
                      setPairTimes((prev) => prev.map((t, k) => (k === i ? v : t)))
                      setApplyErrors([])
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-1">
              <TimeInput
                value={sharedTime}
                onChange={(v) => {
                  setSharedTime(v)
                  setApplyErrors([])
                }}
              />
            </div>
          )}
          <p className="mt-1 text-xs text-gray-500">例：後半2分15秒なら「2」分「15」秒</p>
        </div>
      )}

      {result && result.errors.length === 0 && (
        <div className="rounded-lg bg-white p-2 text-xs text-gray-700">
          {result.secondHalfRemaining !== null && (
            <p>
              後半の交代機会：この変更で{occasions}回分を使い、
              <span className="font-bold">あと{result.secondHalfRemaining}回</span>になります
            </p>
          )}
          {result.newlyNeedingReview > 0 && (
            <p className="mt-1 font-medium text-amber-800">
              ⚠ この変更で、確認が必要になる交代が{result.newlyNeedingReview}件あります（記録は削除されません）。
            </p>
          )}
        </div>
      )}

      {applyErrors.length > 0 && (
        <ul className="space-y-1 font-medium text-red-600">
          {applyErrors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={apply}
          disabled={problem !== null}
          className="rounded-lg bg-gray-900 px-3 py-2 font-medium text-white disabled:bg-gray-300"
        >
          後半に変更する
        </button>
        <button type="button" onClick={onCancel} className="px-2 text-gray-500 underline">
          やめる
        </button>
      </div>
    </div>
  )
}
