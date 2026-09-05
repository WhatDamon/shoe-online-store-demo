import { describe, expect, it } from 'vitest'
import { cosine, parseVector } from './vector'

describe('cosine', () => {
  it('parallel vectors → 1, orthogonal → 0, same-direction scaled → ~1', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1)
    expect(cosine([1, 0], [0, 1])).toBe(0)
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1, 10)
  })

  it('zero / empty vectors score 0, never NaN', () => {
    expect(cosine([], [])).toBe(0)
    expect(cosine([0, 0], [1, 1])).toBe(0)
    expect(Number.isNaN(cosine([], [1, 1]))).toBe(false)
  })

  it('dimension mismatch (stale row from an older embedding model) scores 0, never NaN', () => {
    const score = cosine([0.1, 0.2, 0.3], [0.1, 0.2])
    expect(score).toBe(0)
    expect(Number.isNaN(score)).toBe(false)
  })
})

describe('parseVector', () => {
  it('round-trips a valid JSON number array', () => {
    expect(parseVector('[0.1,0.2,0.3]')).toEqual([0.1, 0.2, 0.3])
  })

  it('returns [] for corrupted JSON or non-array rows', () => {
    expect(parseVector('not json')).toEqual([])
    expect(parseVector('{"a":1}')).toEqual([])
    expect(parseVector('null')).toEqual([])
  })

  it('drops non-numeric / non-finite entries instead of poisoning cosine', () => {
    expect(parseVector('[1,"x",null,2]')).toEqual([1, 2])
    expect(parseVector('[NaN,Infinity]')).toEqual([])
  })
})
