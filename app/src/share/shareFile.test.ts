import { afterEach, describe, expect, it } from 'vitest'
import { canShareImageFile, shareImageFile } from './shareFile'

const file = new File([new Uint8Array([1, 2, 3])], 'r.png', { type: 'image/png' })

function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
}
const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'navigator', original)
})

describe('canShareImageFile', () => {
  it('true only when the browser says it can share this file', () => {
    setNavigator({ canShare: (d: { files: File[] }) => d.files.length === 1 })
    expect(canShareImageFile(file)).toBe(true)
    setNavigator({ canShare: () => false })
    expect(canShareImageFile(file)).toBe(false)
  })
  it('false when the API is missing or throws', () => {
    setNavigator({})
    expect(canShareImageFile(file)).toBe(false)
    setNavigator({ canShare: () => { throw new Error('boom') } })
    expect(canShareImageFile(file)).toBe(false)
  })
})

describe('shareImageFile', () => {
  it('passes the image file (and a title, no other data) to the OS share sheet', async () => {
    let received: unknown
    setNavigator({ share: async (d: unknown) => { received = d } })
    expect(await shareImageFile(file, '試合結果')).toBe('shared')
    expect(received).toEqual({ files: [file], title: '試合結果' })
  })
  it('closing the sheet is "cancelled", not a failure', async () => {
    setNavigator({ share: async () => { throw new DOMException('cancelled', 'AbortError') } })
    expect(await shareImageFile(file, 't')).toBe('cancelled')
  })
  it('any other error is a failure the screen can explain', async () => {
    setNavigator({ share: async () => { throw new Error('nope') } })
    expect(await shareImageFile(file, 't')).toBe('failed')
  })
})
