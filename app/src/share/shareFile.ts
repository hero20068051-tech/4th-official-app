// Handing the finished picture to the phone. Prefers the OS share sheet (the
// operator picks LINE or anything else there); saving the file is always
// available as the fallback.

export function canShareImageFile(file: File): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

export type ShareOutcome = 'shared' | 'cancelled' | 'failed'

export async function shareImageFile(file: File, title: string): Promise<ShareOutcome> {
  try {
    await navigator.share({ files: [file], title })
    return 'shared'
  } catch (e) {
    // Closing the share sheet is not an error.
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a moment to start the download before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
