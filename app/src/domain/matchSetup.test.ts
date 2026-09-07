import { describe, expect, it } from 'vitest'
import {
  evaluateStartEligibility,
  findDuplicateNumbers,
  isNearHydrationTarget,
  isPastHydrationTarget,
  parseHydrationTargetMinutes,
  parseNumberList,
} from './matchSetup'

describe('parseNumberList', () => {
  it('parses comma-separated bulk input and sorts numerically (T20)', () => {
    const { numbers, errors } = parseNumberList('4, 60, 11, 45, 6, 53, 8')
    expect(errors).toEqual([])
    expect(numbers).toEqual([4, 6, 8, 11, 45, 53, 60])
  })

  it('accepts non-sequential numbers within 1-99', () => {
    const { numbers, errors } = parseNumberList('1 99')
    expect(errors).toEqual([])
    expect(numbers).toEqual([1, 99])
  })

  it('rejects out-of-range numbers', () => {
    const { errors } = parseNumberList('0, 100')
    expect(errors).toHaveLength(2)
  })

  it('rejects duplicates within the same batch', () => {
    const { errors, numbers } = parseNumberList('5, 5')
    expect(numbers).toEqual([5])
    expect(errors[0]).toContain('重複')
  })

  it('accepts half-width comma, ideographic comma, full-width comma, and space as equivalent separators', () => {
    const expected = [1, 2, 3, 4, 5]
    expect(parseNumberList('1,2,3,4,5')).toEqual({ numbers: expected, errors: [] })
    expect(parseNumberList('1、2、3、4、5')).toEqual({ numbers: expected, errors: [] })
    expect(parseNumberList('1，2，3，4，5')).toEqual({ numbers: expected, errors: [] })
    expect(parseNumberList('1 2 3 4 5')).toEqual({ numbers: expected, errors: [] })
  })

  it('accepts full-width digits typed by an IME in full-width mode', () => {
    // "１，２，３" — full-width digits with a full-width comma, as an IME in
    // zenkaku mode commonly produces alongside "、"/"，".
    const { numbers, errors } = parseNumberList('１，２，３')
    expect(errors).toEqual([])
    expect(numbers).toEqual([1, 2, 3])
  })

  it('accepts mixed separators and full-width/half-width digits in one input', () => {
    const { numbers, errors } = parseNumberList('1、２ 3，4')
    expect(errors).toEqual([])
    expect(numbers).toEqual([1, 2, 3, 4])
  })

  it('still rejects out-of-range and duplicate numbers after full-width normalization', () => {
    expect(parseNumberList('１００').errors[0]).toContain('範囲外')
    const dup = parseNumberList('５、5')
    expect(dup.numbers).toEqual([5])
    expect(dup.errors[0]).toContain('重複')
  })
})

describe('findDuplicateNumbers', () => {
  it('flags a number already registered on the team (T19)', () => {
    expect(findDuplicateNumbers([1, 15, 20], [15])).toEqual([15])
    expect(findDuplicateNumbers([1, 15, 20], [16])).toEqual([])
  })
})

describe('evaluateStartEligibility', () => {
  it('allows a normal start with 11 starters', () => {
    expect(evaluateStartEligibility(11)).toEqual({ level: 'OK' })
  })

  it('warns for 7-10 starters (T21)', () => {
    const result = evaluateStartEligibility(9)
    expect(result.level).toBe('WARN')
  })

  it('blocks for 6 or fewer starters (T22)', () => {
    expect(evaluateStartEligibility(6)).toEqual({
      level: 'BLOCK',
      message: '7人未満のため開始できません',
    })
  })
})

describe('parseHydrationTargetMinutes', () => {
  it('reads the first number out of a free-text memo', () => {
    expect(parseHydrationTargetMinutes('15分頃')).toBe(15)
    expect(parseHydrationTargetMinutes('だいたい 20 分くらい')).toBe(20)
  })

  it('returns null for memos with no number, without inventing a decision', () => {
    expect(parseHydrationTargetMinutes('ハーフタイム前')).toBeNull()
    expect(parseHydrationTargetMinutes('')).toBeNull()
  })
})

describe('isNearHydrationTarget', () => {
  it('is true only from about 1 minute before the target up to the target itself', () => {
    expect(isNearHydrationTarget(4 * 60_000, 5)).toBe(true)
    expect(isNearHydrationTarget(4.5 * 60_000, 5)).toBe(true)
  })

  it('is false well before the target (e.g. 1:40 for a 5-minute target)', () => {
    expect(isNearHydrationTarget(100_000, 5)).toBe(false)
  })

  it('is false once the target itself has passed', () => {
    expect(isNearHydrationTarget(5 * 60_000, 5)).toBe(false)
    expect(isNearHydrationTarget(6 * 60_000, 5)).toBe(false)
  })
})

describe('isPastHydrationTarget', () => {
  it('is true at and after the target', () => {
    expect(isPastHydrationTarget(5 * 60_000, 5)).toBe(true)
    expect(isPastHydrationTarget(6 * 60_000, 5)).toBe(true)
  })

  it('is false before the target', () => {
    expect(isPastHydrationTarget(4 * 60_000, 5)).toBe(false)
  })
})
