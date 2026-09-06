import { describe, expect, it } from 'vitest'
import { getPageProductSnapshot, registerPageProduct } from './page-product'

describe('page-product anchor store', () => {
  it('初始为空；register 后可读', () => {
    expect(getPageProductSnapshot()).toBeNull()
    registerPageProduct({ handle: 'dc-1001', title: 'Urban Bloom' })
    expect(getPageProductSnapshot()).toEqual({ handle: 'dc-1001', title: 'Urban Bloom' })
  })

  it('换款覆盖旧锚点（跟随当前 PDP）', () => {
    registerPageProduct({ handle: 'jx119-x', title: 'Noir Stealth' })
    expect(getPageProductSnapshot()).toEqual({ handle: 'jx119-x', title: 'Noir Stealth' })
  })

  it('register(null) 清空（离开 PDP）', () => {
    registerPageProduct(null)
    expect(getPageProductSnapshot()).toBeNull()
  })
})
