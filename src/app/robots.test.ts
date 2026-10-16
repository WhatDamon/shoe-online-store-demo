import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOCALES } from '@/i18n/locales'
import { site } from '@/lib/site'
import robots from './robots'

const ENV_KEY = 'NEXT_PUBLIC_SITE_URL'

beforeEach(() => {
  process.env[ENV_KEY] = site.url
})

afterEach(() => {
  delete process.env[ENV_KEY]
})

describe('robots', () => {
  it('每种语言下的交易/私有路径都被禁（带前缀形态）', () => {
    const rules = robots().rules as { disallow: string[] }
    for (const locale of LOCALES) {
      expect(rules.disallow).toContain(`/${locale}/cart`)
      expect(rules.disallow).toContain(`/${locale}/checkout`)
      expect(rules.disallow).toContain(`/${locale}/saved`)
      expect(rules.disallow).toContain(`/${locale}/orders/`)
    }
  })

  it('无前缀的旧路径仍在禁列（跳转来源同样不该被抓取）', () => {
    const rules = robots().rules as { disallow: string[] }
    expect(rules.disallow).toContain('/cart')
    expect(rules.disallow).toContain('/checkout')
    expect(rules.disallow).toContain('/saved')
    expect(rules.disallow).toContain('/orders/')
  })

  it('api 前缀与全站放行规则不变', () => {
    const rules = robots().rules as { userAgent: string; allow: string; disallow: string[] }
    expect(rules.userAgent).toBe('*')
    expect(rules.allow).toBe('/')
    expect(rules.disallow).toContain('/api/')
  })

  it('sitemap 指向绝对地址', () => {
    expect(robots().sitemap).toBe(`${site.url}/sitemap.xml`)
  })
})
