import { describe, expect, it } from 'vitest'
import { formatNear, parseNear } from './amount'

describe('NEAR amount conversion', () => {
  it('converts decimal NEAR to exact yoctoNEAR', () => {
    expect(parseNear('1.00001')).toBe(1000010000000000000000000n)
    expect(parseNear('0.000000000000000000000001')).toBe(1n)
  })

  it('rejects excess precision and invalid values', () => {
    expect(() => parseNear('0.0000000000000000000000001')).toThrow()
    expect(() => parseNear('-1')).toThrow()
  })

  it('formats without floating point rounding', () => {
    expect(formatNear('1000010000000000000000000')).toBe('1.00001')
    expect(formatNear('10000000000000000000000')).toBe('0.01')
  })
})
