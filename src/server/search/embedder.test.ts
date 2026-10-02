// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { embeddingsAvailable } from './embedder'

afterEach(() => vi.unstubAllEnvs())

describe('embedding capability probe', () => {
  it('preserves a budget refusal from its request wrapper', async () => {
    vi.stubEnv('AI_BASE_URL', 'https://embedding.example.test/v1')
    vi.stubEnv('AI_EMBEDDING_MODEL', 'test-embedding')
    const refusal = Object.assign(new Error('daily cap'), { code: 'budget' })

    await expect(
      embeddingsAvailable({
        run: async () => {
          throw refusal
        },
      }),
    ).rejects.toMatchObject({ code: 'budget' })
  })
})
