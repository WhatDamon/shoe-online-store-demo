import { describe, expect, it } from 'vitest'
import { site } from './site'
import { baseMetadata, pageMetadata } from './seo'

describe('seo metadata helpers', () => {
  it('baseMetadata defaults to the site brand and print-to-order promise', () => {
    expect(baseMetadata.title).toMatchObject({ default: site.name })
    expect(String((baseMetadata.title as { template?: string }).template)).toContain(site.name)
    expect(baseMetadata.description).toContain('printed to order')
  })

  it('pageMetadata keeps the brand title template when nothing overrides it', () => {
    const merged = pageMetadata({})
    expect(typeof merged.title).toBe('object')
    expect(String((merged.title as { template?: string }).template)).toContain(site.name)
    expect(merged.openGraph).toMatchObject({
      images: ['/og'],
      siteName: site.name,
    })
  })

  it('pageMetadata shallow-merges a page override onto the base', () => {
    const merged = pageMetadata({
      title: 'Shop',
      description: 'All styles, printed to order.',
    })
    expect(merged.title).toBe('Shop')
    expect(merged.description).toBe('All styles, printed to order.')
    // openGraph from base is inherited when the page does not set its own
    expect(merged.openGraph).toMatchObject({ siteName: site.name })
  })
})
