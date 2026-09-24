interface StartBlockedDialogProps {
  problems: { label: string; messages: string[] }[]
  onBack: () => void
}

// The match cannot start yet because of a rule-specific problem (e.g. players
// whose category is not set). Same loud style as the headcount dialog; the
// only way out is to go back and fix it.
export function StartBlockedDialog({ problems, onBack }: StartBlockedDialogProps) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="start-blocked-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-xl border-2 border-red-700 bg-white shadow-2xl">
        <div className="bg-red-100 px-4 py-3">
          <h2 id="start-blocked-title" className="text-xl font-extrabold text-red-800">
            ⚠ まだ試合を開始できません
          </h2>
        </div>
        <ul className="space-y-2 px-4 py-4 text-gray-900">
          {problems.map((p) => (
            <li key={p.label}>
              <p className="text-base font-bold">{p.label}</p>
              <ul className="mt-1 space-y-1 text-base">
                {p.messages.map((m) => (
                  <li key={m}>・{m}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={onBack}
            className="w-full rounded-xl bg-gray-900 py-4 text-lg font-bold text-white active:bg-gray-700"
          >
            戻って修正する
          </button>
        </div>
      </div>
    </div>
  )
}
