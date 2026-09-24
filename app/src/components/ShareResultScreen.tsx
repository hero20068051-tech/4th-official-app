import { useEffect, useMemo, useState } from 'react'
import type { ArchivedMatch } from '../domain/matchArchive'
import { archivedNeedsReview, buildShareSummary, shareFileName } from '../domain/shareSummary'
import { renderShareImage } from '../share/renderShareImage'
import { canShareImageFile, downloadBlob, shareImageFile } from '../share/shareFile'

interface ShareResultScreenProps {
  entry: ArchivedMatch
  onBack: () => void
}

type Generated = { status: 'loading' } | { status: 'error' } | { status: 'ready'; blob: Blob; url: string; file: File }

// Preview + share for one archived match. Read-only: it derives a picture
// from the archived record and never writes anything back.
export function ShareResultScreen({ entry, onBack }: ShareResultScreenProps) {
  const issues = useMemo(() => archivedNeedsReview(entry), [entry])
  const blocked = issues.length > 0
  const [generated, setGenerated] = useState<Generated>({ status: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (blocked) return
    let cancelled = false
    let objectUrl: string | null = null
    renderShareImage(buildShareSummary(entry))
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setGenerated({ status: 'ready', blob, url: objectUrl, file: new File([blob], shareFileName(entry), { type: 'image/png' }) })
      })
      .catch(() => {
        if (!cancelled) setGenerated({ status: 'error' })
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [entry, blocked])

  const ready = generated.status === 'ready' ? generated : null
  const canShare = ready ? canShareImageFile(ready.file) : false

  async function handleShare() {
    if (!ready) return
    const outcome = await shareImageFile(ready.file, '試合結果')
    setNotice(outcome === 'failed' ? '共有できませんでした。「画像を保存」から保存して共有してください。' : null)
  }

  function handleSave() {
    if (!ready) return
    downloadBlob(ready.blob, ready.file.name)
    setNotice('画像を保存しました。')
  }

  return (
    <div className="mx-auto max-w-md space-y-3 p-4 pb-10">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 shrink-0 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 active:bg-gray-100"
        >
          ← 戻る
        </button>
        <h1 className="min-w-0 truncate text-lg font-bold text-gray-900">結果を共有</h1>
      </div>

      {blocked ? (
        <div role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-4">
          <p className="text-base font-bold text-red-800">⚠ 確認が必要な記録があります</p>
          <p className="mt-2 text-sm text-gray-800">共有する前に試合記録を確認してください。</p>
        </div>
      ) : (
        <>
          {generated.status === 'loading' && <p className="py-10 text-center text-sm text-gray-500">画像を作成しています…</p>}
          {generated.status === 'error' && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              画像を作成できませんでした。戻ってもう一度お試しください。
            </p>
          )}
          {ready && (
            <>
              <img
                src={ready.url}
                alt="試合結果の共有画像"
                className="block w-full rounded-xl border border-gray-200 bg-white"
              />
              {canShare ? (
                <button
                  type="button"
                  onClick={handleShare}
                  className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white active:bg-emerald-700"
                >
                  共有する
                </button>
              ) : (
                <p className="text-xs text-gray-500">この端末では直接共有できないため、画像を保存してからお使いください。</p>
              )}
              <button
                type="button"
                onClick={handleSave}
                className={
                  canShare
                    ? 'w-full rounded-xl border border-gray-300 py-3 text-base text-gray-700 active:bg-gray-100'
                    : 'w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white active:bg-emerald-700'
                }
              >
                画像を保存
              </button>
              {notice && (
                <p role="status" className="text-center text-sm text-gray-600">
                  {notice}
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
