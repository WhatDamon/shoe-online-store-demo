import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// vitest 未开启 globals，RTL 不会自动 cleanup；显式注册，避免跨用例 DOM 泄漏。
afterEach(() => {
  cleanup()
})
