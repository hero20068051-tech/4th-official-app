import { layoutShareImage, type Measure } from '../domain/shareLayout'
import type { ShareSummary } from '../domain/shareSummary'

// Draws the share picture with the browser's own Canvas 2D: no library, no
// server, no downloaded font or image — so it works offline and the match
// data never leaves the device. Only system fonts are used (Android/Chrome
// has Noto Sans CJK), listed with sensible fallbacks.
const FONT_FAMILY =
  '"Noto Sans JP", "Noto Sans CJK JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif'

const fontOf = (size: number, weight: number) => `${weight} ${size}px ${FONT_FAMILY}`

export function createCanvasMeasure(): Measure {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) throw new Error('canvas is not available')
  return (text, size, weight) => {
    ctx.font = fontOf(size, weight)
    return ctx.measureText(text).width
  }
}

export async function renderShareImage(summary: ShareSummary): Promise<Blob> {
  const layout = layoutShareImage(summary, createCanvasMeasure())
  const canvas = document.createElement('canvas')
  canvas.width = layout.width
  canvas.height = layout.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas is not available')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, layout.width, layout.height)

  for (const item of layout.items) {
    if (item.type === 'rect') {
      ctx.fillStyle = item.fill
      ctx.fillRect(item.x, item.y, item.w, item.h)
      if (item.stroke) {
        ctx.strokeStyle = item.stroke
        ctx.lineWidth = 3
        ctx.strokeRect(item.x, item.y, item.w, item.h)
      }
    } else {
      ctx.font = fontOf(item.size, item.weight)
      ctx.fillStyle = item.color
      ctx.textAlign = item.align
      ctx.textBaseline = 'middle'
      ctx.fillText(item.text, item.x, item.y + item.lineHeight / 2)
    }
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not encode the image'))), 'image/png')
  })
}
