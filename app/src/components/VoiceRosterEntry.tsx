import { useState } from 'react'
import { compareVoiceRosterTakes, parseNumberListFromTranscript } from '../domain/matchSetup'
import type { TeamId } from '../domain/types'

type Step = 'first' | 'second' | 'result'

interface VoiceRosterEntryProps {
  teamId: TeamId
  onAddPlayers: (teamId: TeamId, rawInput: string) => string[]
  onClose: () => void
}

// This never lets a single dictated take register players on its own: the
// same roster sheet is read aloud twice, independently, and only numbers
// that agree in both takes can be registered (see the "result" step below).
// A take that produces no numbers at all (silence, or dictation that failed
// to pick anything up) is treated as an error rather than an empty roster,
// so a recognition failure can't silently wipe out a take.
function confirmTake(text: string): { numbers: number[]; errors: string[] } {
  const { numbers, errors } = parseNumberListFromTranscript(text)
  if (errors.length === 0 && numbers.length === 0) {
    return { numbers: [], errors: ['番号を読み取れませんでした。もう一度お試しください。'] }
  }
  return { numbers, errors }
}

export function VoiceRosterEntry({ teamId, onAddPlayers, onClose }: VoiceRosterEntryProps) {
  const [step, setStep] = useState<Step>('first')
  const [firstText, setFirstText] = useState('')
  const [firstNumbers, setFirstNumbers] = useState<number[]>([])
  const [firstErrors, setFirstErrors] = useState<string[]>([])
  const [secondText, setSecondText] = useState('')
  const [secondNumbers, setSecondNumbers] = useState<number[]>([])
  const [secondErrors, setSecondErrors] = useState<string[]>([])
  const [addErrors, setAddErrors] = useState<string[]>([])

  function handleConfirmFirst() {
    const { numbers, errors } = confirmTake(firstText)
    setFirstErrors(errors)
    if (errors.length > 0) return
    setFirstNumbers(numbers)
    setStep('second')
  }

  function handleConfirmSecond() {
    const { numbers, errors } = confirmTake(secondText)
    setSecondErrors(errors)
    if (errors.length > 0) return
    setSecondNumbers(numbers)
    setStep('result')
  }

  function handleRedoFirst() {
    setFirstText('')
    setFirstNumbers([])
    setFirstErrors([])
    setAddErrors([])
    setStep('first')
  }

  function handleRedoSecond() {
    setSecondText('')
    setSecondNumbers([])
    setSecondErrors([])
    setAddErrors([])
    setStep('second')
  }

  function handleRedoAll() {
    setFirstText('')
    setFirstNumbers([])
    setFirstErrors([])
    setSecondText('')
    setSecondNumbers([])
    setSecondErrors([])
    setAddErrors([])
    setStep('first')
  }

  function handleRegister(agreed: number[]) {
    const errors = onAddPlayers(teamId, agreed.join(','))
    if (errors.length === 0) {
      onClose()
      return
    }
    setAddErrors(errors)
  }

  const comparison = step === 'result' ? compareVoiceRosterTakes(firstNumbers, secondNumbers) : null

  return (
    <div className="mt-3 rounded-lg border border-gray-300 bg-white p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">🎤 音声でまとめて登録</p>
        <button type="button" onClick={onClose} className="text-sm text-gray-400">
          閉じる
        </button>
      </div>

      {step === 'first' && (
        <div className="mt-2">
          <p className="text-xs text-gray-500">
            名簿を1回目、最初から声に出して読み上げてください（キーボードのマイクで入力）。
          </p>
          <textarea
            value={firstText}
            onChange={(e) => setFirstText(e.target.value)}
            placeholder="例: 1番、2番、3番"
            rows={3}
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
          />
          {firstErrors.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-red-600">
              {firstErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={handleConfirmFirst}
            className="mt-2 w-full rounded-lg bg-gray-900 px-4 py-3 text-base font-medium text-white active:bg-gray-700"
          >
            1回目を確定
          </button>
        </div>
      )}

      {step === 'second' && (
        <div className="mt-2">
          <p className="text-xs text-gray-500">
            続けて2回目、同じ名簿をもう一度最初から読み上げてください。
          </p>
          <textarea
            value={secondText}
            onChange={(e) => setSecondText(e.target.value)}
            placeholder="例: 1番、2番、3番"
            rows={3}
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
          />
          {secondErrors.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-red-600">
              {secondErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={handleConfirmSecond}
            className="mt-2 w-full rounded-lg bg-gray-900 px-4 py-3 text-base font-medium text-white active:bg-gray-700"
          >
            2回目を確定
          </button>
        </div>
      )}

      {step === 'result' && comparison && (
        <div className="mt-2">
          {comparison.matched ? (
            <div>
              <p className="text-sm font-medium text-green-700">✓ 1回目と2回目が一致しました</p>
              <p className="mt-1 text-sm text-gray-700">登録選手 {comparison.agreed.length}名</p>
              <p className="mt-1 font-mono text-sm text-gray-900">{comparison.agreed.join(' / ')}</p>
              {addErrors.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-red-600">
                  {addErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => handleRegister(comparison.agreed)}
                className="mt-2 w-full rounded-lg bg-blue-600 px-4 py-3 text-base font-medium text-white active:bg-blue-800"
              >
                この内容で登録する
              </button>
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium text-red-600">⚠ 1回目と2回目が一致しません</p>
              {comparison.onlyInFirst.length > 0 && (
                <p className="mt-2 text-sm text-gray-700">
                  1回目のみ: <span className="font-mono">{comparison.onlyInFirst.join(' / ')}</span>
                </p>
              )}
              {comparison.onlyInSecond.length > 0 && (
                <p className="mt-1 text-sm text-gray-700">
                  2回目のみ: <span className="font-mono">{comparison.onlyInSecond.join(' / ')}</span>
                </p>
              )}
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleRedoFirst}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
                >
                  1回目だけやり直す
                </button>
                <button
                  type="button"
                  onClick={handleRedoSecond}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
                >
                  2回目だけやり直す
                </button>
                <button
                  type="button"
                  onClick={handleRedoAll}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
                >
                  最初からやり直す
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
