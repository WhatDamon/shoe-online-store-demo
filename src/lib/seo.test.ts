import { afterEach, describe, expect, it, vi } from 'vitest'
import { site } from './site'

const ENV_KEY = 'NEXT_PUBLIC_SITE_URL'

afterEach(() => {
  delete process.env[ENV_KEY]
  vi.resetModules()
})

describe('seo metadata helpers', () => {
  it('baseMetadata defaults to the site brand and print-to-order promise', async () => {
    const { baseMetadata } = await import('./seo')
    expect(baseMetadata.title).toMatchObject({ default: site.name })
    expect(String((baseMetadata.title as { template?: string }).template)).toContain(site.name)
    expect(baseMetadata.description).toContain('printed to order')
  })

  it('pageMetadata keeps the brand title template when nothing overrides it', async () => {
    const { pageMetadata } = await import('./seo')
    const merged = pageMetadata({})
    expect(typeof merged.title).toBe('object')
    expect(String((merged.title as { template?: string }).template)).toContain(site.name)
    expect(merged.openGraph).toMatchObject({
      images: ['/og'],
      siteName: site.name,
    })
  })

  it('pageMetadata shallow-merges a page override onto the base', async () => {
    const { pageMetadata } = await import('./seo')
    const merged = pageMetadata({
      title: 'Shop',
      description: 'All styles, printed to order.',
    })
    expect(merged.title).toBe('Shop')
    expect(merged.description).toBe('All styles, printed to order.')
    // openGraph from base is inherited when the page does not set its own
    expect(merged.openGraph).toMatchObject({ siteName: site.name })
  })

  it('metadataBase honours NEXT_PUBLIC_SITE_URL and falls back for bad values', async () => {
    process.env[ENV_KEY] = 'https://evoloop.example'
    const { baseMetadata: b1 } = await import('./seo')
    expect(String(b1.metadataBase)).toBe('https://evoloop.example/')

    delete process.env[ENV_KEY]
    vi.resetModules()
    const { baseMetadata: b2 } = await import('./seo')
    expect(String(b2.metadataBase)).toBe('http://localhost:3000/')

    process.env[ENV_KEY] = 'not a url'
    vi.resetModules()
    const { baseMetadata: b3 } = await import('./seo')
    expect(String(b3.metadataBase)).toBe('http://localhost:3000/')

    process.env[ENV_KEY] = 'ftp://files.example'
    vi.resetModules()
    const { baseMetadata: b4 } = await import('./seo')
    expect(String(b4.metadataBase)).toBe('http://localhost:3000/')
  })
})
