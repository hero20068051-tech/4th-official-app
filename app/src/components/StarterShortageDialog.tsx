interface ShortageTeam {
  label: string
  count: number
}

interface StarterShortageDialogProps {
  // CONFIRM = 7-10 starters, may proceed after reading. BLOCK = 6 or fewer,
  // there is no proceed button at all.
  mode: 'CONFIRM' | 'BLOCK'
  // What "proceed" does, only used for the wording of the two buttons.
  action: 'start' | 'correct'
  teams: ShortageTeam[]
  onBack: () => void
  onProceed?: () => void
}

// Deliberately loud and shared by "start the match" and "correct starters":
// a short lineup must never be something the operator clicks past without
// reading. The meaning is carried by the ⚠ mark and the words, not by the
// red alone. The safe action (go back) is the big primary button; proceeding
// is a small, outlined, visually cautious one.
export function StarterShortageDialog({ mode, action, teams, onBack, onProceed }: StarterShortageDialogProps) {
  const single = teams.length === 1
  const verb = action === 'start' ? '試合を開始' : '先発を修正'

  const title =
    mode === 'BLOCK'
      ? single
        ? `⚠ ${teams[0].label}のスタメンが${teams[0].count}名です`
        : '⚠ スタメンが7名に足りません'
      : single
        ? `⚠ ${teams[0].label}のスタメンが${teams[0].count}名です`
        : '⚠ スタメンが11名ではありません'

  const proceedLabel = single
    ? `${teams[0].count}名で${action === 'start' ? '試合開始' : '修正する'}`
    : `この人数で${action === 'start' ? '試合開始' : '修正する'}`

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="starter-shortage-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-xl border-2 border-red-700 bg-white shadow-2xl">
        <div className="bg-red-100 px-4 py-3">
          <h2 id="starter-shortage-title" className="text-xl font-extrabold text-red-800">
            {title}
          </h2>
        </div>

        <div className="space-y-3 px-4 py-4 text-gray-900">
          {!single && (
            <ul className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-base font-bold">
              {teams.map((t) => (
                <li key={t.label}>
                  ⚠ {t.label}：{t.count}名
                </li>
              ))}
            </ul>
          )}

          {mode === 'CONFIRM' ? (
            <>
              <p className="text-base font-medium">通常の11名ではありません。</p>
              <p className="text-base">
                {single ? `このまま${teams[0].count}名で` : 'このままの人数で'}
                {verb}しますか？
              </p>
              <p className="text-sm text-gray-700">入力ミスの場合は戻って修正してください。</p>
            </>
          ) : (
            <>
              <p className="text-base font-medium">7名未満のため{verb}できません。</p>
              <p className="text-sm text-gray-700">先発を7名以上にしてください。</p>
            </>
          )}
        </div>

        <div className="space-y-3 px-4 pb-4">
          <button
            type="button"
            onClick={onBack}
            className="w-full rounded-xl bg-gray-900 py-4 text-lg font-bold text-white active:bg-gray-700"
          >
            戻って修正する
          </button>
          {mode === 'CONFIRM' && onProceed && (
            <button
              type="button"
              onClick={onProceed}
              className="mx-auto block rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 active:bg-red-50"
            >
              {proceedLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
