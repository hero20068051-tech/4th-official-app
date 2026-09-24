import type { ShareSummary } from './shareSummary'

// Turns a ShareSummary into positioned drawing items for a tall image. Pure:
// text width comes from an injected `measure`, so the same code is tested
// without a canvas. The height simply grows with the content — nothing is
// cut, and font sizes never shrink to make things fit.

export const SHARE_WIDTH = 1080
const M = 72 // side margin
const CONTENT_W = SHARE_WIDTH - M * 2
const COLUMN_W = CONTENT_W / 2
const MIN_HEIGHT = 1280

export const COLORS = {
  ink: '#111827',
  sub: '#4b5563',
  faint: '#6b7280',
  line: '#e5e7eb',
  bg: '#ffffff',
  home: '#2563eb',
  away: '#ea580c',
  yellow: '#facc15',
  red: '#dc2626',
}

export type Measure = (text: string, size: number, weight: number) => number

export type DrawItem =
  | { type: 'rect'; x: number; y: number; w: number; h: number; fill: string; stroke?: string }
  | {
      type: 'text'
      x: number // left edge, or the centre when align = 'center'
      y: number // top of the line box
      text: string
      size: number
      weight: number
      color: string
      align: 'left' | 'center'
      lineHeight: number
    }

export interface ShareLayout {
  width: number
  height: number
  items: DrawItem[]
}

// Wraps by whole pieces first so a record reads naturally: the text is split at
// the full-width spaces ("TEAM", "#10", "イエローカード（2枚目）" stay intact)
// and a piece that cannot fit on any line is then broken by character
// (Japanese has no spaces), keeping a run of ASCII letters/digits such as
// "#12" together. Full-width spaces at a line break are dropped; every other
// character is kept.
export function wrapText(text: string, maxWidth: number, size: number, weight: number, measure: Measure): string[] {
  const lines: string[] = []
  let line = ''
  const w = (t: string) => measure(t, size, weight)
  const flush = () => {
    lines.push(line.replace(/\u3000+$/, ''))
    line = ''
  }

  const placeByCharacter = (piece: string) => {
    for (const unit of piece.match(/[#\w.:'-]+|[\s\S]/gu) ?? []) {
      const parts = w(unit) > maxWidth ? Array.from(unit) : [unit]
      for (const part of parts) {
        if (line !== '' && w(line + part) > maxWidth) flush()
        line += part
      }
    }
  }

  for (const part of text.split(/(\u3000)/)) {
    if (part === '') continue
    if (part === '\u3000') {
      if (line === '') continue
      if (w(line + part) > maxWidth) flush()
      else line += part
      continue
    }
    if (w(line + part) <= maxWidth) line += part
    else if (w(part) <= maxWidth) {
      flush()
      line = part
    } else placeByCharacter(part)
  }
  if (line !== '' || lines.length === 0) flush()
  return lines
}

export function layoutShareImage(summary: ShareSummary, measure: Measure): ShareLayout {
  const items: DrawItem[] = []
  let y = 88

  const text = (
    x: number,
    top: number,
    t: string,
    size: number,
    weight: number,
    color: string,
    align: 'left' | 'center',
    lineHeight: number,
  ) => items.push({ type: 'text', x, y: top, text: t, size, weight, color, align, lineHeight })

  // --- Title and date
  text(SHARE_WIDTH / 2, y, summary.title, 56, 700, COLORS.ink, 'center', 72)
  y += 72 + 8
  text(SHARE_WIDTH / 2, y, summary.dateLabel, 42, 400, COLORS.sub, 'center', 56)
  y += 56 + 56

  // --- Teams (HOME left, AWAY right, each under its own colour bar)
  const cols = [
    { x: M, color: COLORS.home, name: summary.homeName, caption: summary.homeCaption, score: summary.homeScore },
    { x: M + COLUMN_W, color: COLORS.away, name: summary.awayName, caption: summary.awayCaption, score: summary.awayScore },
  ]
  const NAME_SIZE = 46
  const NAME_LH = 58
  const inner = COLUMN_W - 48 // breathing room between the two columns
  const wrapped = cols.map((c) => wrapText(c.name, inner, NAME_SIZE, 700, measure))
  const anyCaption = cols.some((c) => c.caption)
  const headTop = y
  for (const c of cols) items.push({ type: 'rect', x: c.x + 12, y: headTop, w: COLUMN_W - 24, h: 12, fill: c.color })
  y += 12 + 24
  if (anyCaption) {
    for (const c of cols) if (c.caption) text(c.x + COLUMN_W / 2, y, c.caption, 30, 400, COLORS.faint, 'center', 40)
    y += 40 + 4
  }
  const nameTop = y
  cols.forEach((c, i) => {
    wrapped[i].forEach((ln, k) => text(c.x + COLUMN_W / 2, nameTop + k * NAME_LH, ln, NAME_SIZE, 700, COLORS.ink, 'center', NAME_LH))
  })
  y += Math.max(...wrapped.map((w) => w.length)) * NAME_LH + 8

  // --- Big score, each number under its own team
  const SCORE_SIZE = 220
  const SCORE_LH = 256
  cols.forEach((c) => text(c.x + COLUMN_W / 2, y, String(c.score), SCORE_SIZE, 700, COLORS.ink, 'center', SCORE_LH))
  text(SHARE_WIDTH / 2, y + 40, '-', 120, 400, COLORS.faint, 'center', 150)
  y += SCORE_LH + 40

  // --- Sections
  const section = (title: string) => {
    items.push({ type: 'rect', x: M, y, w: CONTENT_W, h: 3, fill: COLORS.line })
    y += 3 + 40
    text(M, y, title, 46, 700, COLORS.ink, 'left', 60)
    y += 60 + 24
  }
  const empty = (label: string) => {
    text(M, y, label, 38, 400, COLORS.faint, 'left', 52)
    y += 52 + 40
  }

  const DETAIL_SIZE = 44
  const DETAIL_LH = 58
  const MOMENT_LH = 44

  section('得点')
  if (summary.goals.length === 0) empty('得点なし')
  for (const g of summary.goals) {
    const lines = wrapText(g.text, CONTENT_W - 40, DETAIL_SIZE, 700, measure)
    const h = MOMENT_LH + lines.length * DETAIL_LH
    items.push({ type: 'rect', x: M, y: y + 4, w: 12, h: h - 4, fill: g.teamId === 'HOME' ? COLORS.home : COLORS.away })
    text(M + 40, y, g.moment, 34, 400, COLORS.sub, 'left', MOMENT_LH)
    lines.forEach((ln, k) => text(M + 40, y + MOMENT_LH + k * DETAIL_LH, ln, DETAIL_SIZE, 700, COLORS.ink, 'left', DETAIL_LH))
    y += h + 32
  }
  y += 8

  section('警告・退場')
  if (summary.cards.length === 0) empty('警告・退場なし')
  for (const c of summary.cards) {
    const textX = M + 40 + 44
    const lines = wrapText(c.text, SHARE_WIDTH - M - textX, DETAIL_SIZE, 700, measure)
    const h = MOMENT_LH + lines.length * DETAIL_LH
    text(M + 40, y, c.moment, 34, 400, COLORS.sub, 'left', MOMENT_LH)
    // The card colour is only a marker; the words "イエローカード"/"レッドカード" are in the text.
    items.push({ type: 'rect', x: M + 40, y: y + MOMENT_LH + 8, w: 30, h: 40, fill: c.kind === 'YELLOW' ? COLORS.yellow : COLORS.red, stroke: COLORS.ink })
    lines.forEach((ln, k) => text(textX, y + MOMENT_LH + k * DETAIL_LH, ln, DETAIL_SIZE, 700, COLORS.ink, 'left', DETAIL_LH))
    y += h + 32
  }

  y += 40
  return { width: SHARE_WIDTH, height: Math.max(y, MIN_HEIGHT), items }
}
