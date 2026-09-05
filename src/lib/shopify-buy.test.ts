import { afterEach, describe, expect, it } from 'vitest'
import { parseShopifyBuyButton, shopifyBuyButtonForHandle } from './shopify-buy'

const valid = {
  handle: '3d-shoes',
  domain: '03zrk0-2u.myshopify.com',
  productId: 8_123_456_789,
  token: 'public-storefront-token',
}

// 决策 #15 深定制：嵌入码 moneyFormat（¥{{amount}} 解码后）随配置传入 SDK。
const withMoney = { ...valid, moneyFormat: '¥{{amount}}' }

describe('parseShopifyBuyButton', () => {
  it('returns null for empty / missing env', () => {
    expect(parseShopifyBuyButton(undefined)).toBeNull()
    expect(parseShopifyBuyButton('')).toBeNull()
    expect(parseShopifyBuyButton('   ')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseShopifyBuyButton('{not json')).toBeNull()
  })

  it('returns null for structurally invalid configs', () => {
    expect(parseShopifyBuyButton(JSON.stringify({}))).toBeNull()
    expect(parseShopifyBuyButton(JSON.stringify({ ...valid, productId: 'x' }))).toBeNull()
    expect(parseShopifyBuyButton(JSON.stringify({ ...valid, productId: 0 }))).toBeNull()
    expect(parseShopifyBuyButton(JSON.stringify({ ...valid, token: '' }))).toBeNull()
  })

  it('parses a valid config', () => {
    expect(parseShopifyBuyButton(JSON.stringify(valid))).toEqual(valid)
  })

  it('parses optional moneyFormat and rejects empty/non-string ones', () => {
    expect(parseShopifyBuyButton(JSON.stringify(withMoney))).toEqual(withMoney)
    expect(parseShopifyBuyButton(JSON.stringify({ ...withMoney, moneyFormat: '' }))).toEqual(valid)
    expect(parseShopifyBuyButton(JSON.stringify({ ...withMoney, moneyFormat: 42 }))).toBeNull()
  })
})

describe('shopifyBuyButtonForHandle', () => {
  const original = process.env.SHOPIFY_BUY_BUTTON
  afterEach(() => {
    process.env.SHOPIFY_BUY_BUTTON = original
  })

  it('returns the config only when the handle matches', () => {
    process.env.SHOPIFY_BUY_BUTTON = JSON.stringify(valid)
    expect(shopifyBuyButtonForHandle('3d-shoes')).toEqual(valid)
    expect(shopifyBuyButtonForHandle('daily-drift')).toBeNull()
  })

  it('returns null when env is unset', () => {
    process.env.SHOPIFY_BUY_BUTTON = ''
    expect(shopifyBuyButtonForHandle('3d-shoes')).toBeNull()
  })
})
