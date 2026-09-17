import { describe, expect, it } from 'vitest'
import { MockProvider } from './mock'
import { systemFor } from './prompts'

describe('MockProvider streamed text', () => {
  it('preserves whitespace between streamed chunks', async () => {
    const provider = new MockProvider()
    const chunks: string[] = []
    for await (const chunk of provider.stream({
      system: systemFor('find-shoes', {
        catalogDigest: '- Urban Bloom (Sneaker): everyday comfort\n- Daily Drift (Sneaker): light',
      }),
      messages: [{ role: 'user', content: 'sneakers' }],
      maxTokens: 500,
    }))
      chunks.push(chunk)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe('Here are two matches: the Urban Bloom and the Daily Drift.')
  })

  it('references the anchored product when the catalog digest is empty', async () => {
    const provider = new MockProvider()
    const chunks: string[] = []
    for await (const chunk of provider.stream({
      system: systemFor('shopping', { product: 'Product: Urban Bloom. Code: DC-1001.' }),
      messages: [{ role: 'user', content: '防水吗？' }],
      maxTokens: 500,
    }))
      chunks.push(chunk)
    const reply = chunks.join('')
    expect(reply).toContain('Urban Bloom')
    expect(reply).not.toContain('could not find')
  })
})
