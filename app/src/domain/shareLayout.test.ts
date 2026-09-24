import { describe, expect, it } from 'vitest'
import { layoutShareImage, SHARE_WIDTH, wrapText, type DrawItem, type Measure } from './shareLayout'
import type { ShareSummary } from './shareSummary'

// Worst case for Japanese: every character is one full em wide.
const measure: Measure = (text, size) => Array.from(text).length * size

function summary(over: Partial<ShareSummary> = {}): ShareSummary {
  return {
    title: '試合結果',
    dateLabel: '2026.09.24',
    homeName: 'HOME',
    awayName: 'AWAY',
    homeCaption: null,
    awayCaption: null,
    homeScore: 2,
    awayScore: 1,
    goals: [
      { moment: '前半 12:35', teamId: 'HOME', text: 'HOME　#10' },
      { moment: '後半 08:20', teamId: 'AWAY', text: 'AWAY　#7' },
    ],
    cards: [{ moment: '後半 15:40', teamId: 'AWAY', kind: 'YELLOW', text: 'AWAY　#6　イエローカード' }],
    ...over,
  }
}

type Text = Extract<DrawItem, { type: 'text' }>
const texts = (items: DrawItem[]) => items.filter((i): i is Text => i.type === 'text')

function width(t: Text) {
  return measure(t.text, t.size, t.weight)
}
function bounds(t: Text) {
  const w = width(t)
  const left = t.align === 'center' ? t.x - w / 2 : t.x
  return { left, right: left + w, top: t.y, bottom: t.y + t.lineHeight }
}

function checkLayout(l: ReturnType<typeof layoutShareImage>) {
  const ts = texts(l.items)
  // nothing outside the picture
  for (const t of ts) {
    const b = bounds(t)
    expect(b.left).toBeGreaterThanOrEqual(0)
    expect(b.right).toBeLessThanOrEqual(l.width)
    expect(b.bottom).toBeLessThanOrEqual(l.height)
  }
  // no two text lines overlap
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      const a = bounds(ts[i])
      const b = bounds(ts[j])
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
      // the hyphen sits between the two big scores by design (its box is taller than the glyph)
      if (ts[i].text === '-' || ts[j].text === '-') continue
      expect(overlap, `"${ts[i].text}" overlaps "${ts[j].text}"`).toBe(false)
    }
  }
  // never shrunk to fit
  for (const t of ts) expect(t.size).toBeGreaterThanOrEqual(30)
}

describe('wrapText', () => {
  it('breaks long Japanese text by width and loses no characters', () => {
    const lines = wrapText('あいうえおかきくけこ', 45, 10, 400, measure)
    expect(lines).toEqual(['あいうえ', 'おかきく', 'けこ'])
    expect(lines.join('')).toBe('あいうえおかきくけこ')
  })
  it('keeps short text on one line and handles empty text', () => {
    expect(wrapText('HOME', 1000, 40, 700, measure)).toEqual(['HOME'])
    expect(wrapText('', 100, 40, 700, measure)).toEqual([''])
  })
  it('breaks at the full-width spaces first, so a phrase moves down whole', () => {
    expect(wrapText('AWAY\u3000得点者未確認', 100, 10, 700, measure)).toEqual(['AWAY', '得点者未確認'])
  })
  it('never splits "#12" (or any letters/digits) apart when breaking a long piece', () => {
    const club = 'とても長い名前のフットボールクラブ'
    const lines = wrapText(`${club}\u3000#12\u3000イエローカード`, 200, 10, 700, measure)
    for (const ln of lines) expect(ln).not.toMatch(/#$/)
    expect(lines.some((l) => l.includes('#12'))).toBe(true)
    expect(lines.join('').replaceAll('\u3000', '')).toBe(`${club}#12イエローカード`)
  })
  it('a piece wider than a line is still broken by character rather than overflowing', () => {
    const lines = wrapText('ABCDEFGHIJKLMNOP', 50, 10, 400, measure)
    for (const ln of lines) expect(measure(ln, 10, 400)).toBeLessThanOrEqual(50)
    expect(lines.join('')).toBe('ABCDEFGHIJKLMNOP')
  })
  it('drops a full-width space at a break but keeps every other character', () => {
    const t = 'ABCD\u3000EFGH'
    const lines = wrapText(t, 45, 10, 400, measure)
    expect(lines).toEqual(['ABCD', 'EFGH'])
  })
})

describe('layoutShareImage', () => {
  it('draws the title, date, both scores and both sections', () => {
    const l = layoutShareImage(summary(), measure)
    const all = texts(l.items).map((t) => t.text)
    for (const want of ['試合結果', '2026.09.24', '2', '1', '得点', '警告・退場', '前半 12:35', 'HOME　#10', 'AWAY　#7', '後半 15:40']) {
      expect(all).toContain(want)
    }
    expect(l.width).toBe(SHARE_WIDTH)
    checkLayout(l)
  })

  it('HOME is drawn left of AWAY (score and team bar)', () => {
    const l = layoutShareImage(summary(), measure)
    const scores = texts(l.items).filter((t) => t.size === 220)
    expect(scores.map((t) => t.text)).toEqual(['2', '1'])
    expect(scores[0].x).toBeLessThan(scores[1].x)
  })

  it('empty sections say so instead of leaving a hole', () => {
    const l = layoutShareImage(summary({ goals: [], cards: [] }), measure)
    const all = texts(l.items).map((t) => t.text)
    expect(all).toContain('得点なし')
    expect(all).toContain('警告・退場なし')
    checkLayout(l)
  })

  it('a busy match grows taller instead of shrinking or dropping records', () => {
    const goals = Array.from({ length: 40 }, (_, i) => ({ moment: `前半 ${String(i).padStart(2, '0')}:00`, teamId: (i % 2 ? 'AWAY' : 'HOME') as 'HOME' | 'AWAY', text: `HOME　#${i + 1}` }))
    const cards = Array.from({ length: 30 }, (_, i) => ({ moment: `後半 ${String(i).padStart(2, '0')}:10`, teamId: 'HOME' as const, kind: (i % 2 ? 'RED' : 'YELLOW') as 'RED' | 'YELLOW', text: `HOME　#${i + 1}　イエローカード` }))
    const small = layoutShareImage(summary(), measure)
    const big = layoutShareImage(summary({ goals, cards }), measure)
    expect(big.height).toBeGreaterThan(small.height * 3)
    checkLayout(big)
    const all = texts(big.items).map((t) => t.text)
    for (const g of goals) expect(all).toContain(g.text)
    for (const c of cards) expect(all).toContain(c.text)
  })

  it('a long team name wraps inside its own column and is fully shown', () => {
    const name = 'とても長い名前のフットボールクラブジュニアユース'
    const l = layoutShareImage(summary({ homeName: name, homeCaption: 'HOME' }), measure)
    checkLayout(l)
    const shown = texts(l.items)
      .filter((t) => t.size === 46 && t.align === 'center' && t.x < SHARE_WIDTH / 2)
      .map((t) => t.text)
      .join('')
    expect(shown).toBe(name)
  })

  it('a very long card line wraps rather than running off the picture', () => {
    const c = { moment: '後半 01:00', teamId: 'HOME' as const, kind: 'YELLOW' as const, text: 'とても長いチーム名のクラブ　#12　イエローカード（2枚目）' }
    const l = layoutShareImage(summary({ cards: [c] }), measure)
    checkLayout(l)
    expect(texts(l.items).filter((t) => t.size === 44).map((t) => t.text).join('')).toContain(c.text.slice(-8))
  })

  it('card colour is only a marker: each card line carries the card name in words', () => {
    const l = layoutShareImage(summary(), measure)
    expect(texts(l.items).some((t) => t.text.includes('イエローカード'))).toBe(true)
  })

  it('is pure: the same input gives the same picture and the input is not touched', () => {
    const s = summary()
    const before = JSON.stringify(s)
    expect(layoutShareImage(s, measure)).toEqual(layoutShareImage(s, measure))
    expect(JSON.stringify(s)).toBe(before)
  })
})
