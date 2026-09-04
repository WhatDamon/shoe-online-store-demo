import { describe, expect, it } from 'vitest'
import { cosine, parseVector } from './vector'

describe('cosine', () => {
  it('returns 0 when either vector is empty (corrupt-row safe)', () => {
    expect(cosine([], [1, 2])).toBe(0)
    expect(cosine([1, 2], [])).toBe(0)
  })
})

describe('parseVector (corrupt embedding-row guard)', () => {
  it('parses a JSON number array', () => {
    expect(parseVector('[1,2,3]')).toEqual([1, 2, 3])
  })
  it('returns [] on non-array JSON instead of throwing', () => {
    expect(parseVector('{"a":1}')).toEqual([])
  })
  it('returns [] on invalid JSON instead of throwing', () => {
    expect(parseVector('{not json')).toEqual([])
  })
  it('filters non-finite and non-number items', () => {
    expect(parseVector('[1, "x", null, 2.5]')).toEqual([1, 2.5])
  })
})
