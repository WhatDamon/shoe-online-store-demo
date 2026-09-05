'use client'

/**
 * 临时诊断信标（真机 React 水合失败排查用，定位后移除）。
 *
 * 背景：用户的安卓 Chrome（148）在 http 局域网生产预览上始终无法水合——
 * 顶栏磨砂、搜索、PDP 交互、AI 导购全部失效，而原生 HTML（links/details）
 * 正常；桌面与无头 Chromium 同一构建完全正常，且无痕/非安全上下文都排除后
 * 仍复现。需要真机上的真实报错文本才能定位，但手机无法连 devtools。
 *
 * 机制：模块顶层副作用在客户端包求值阶段（早于 ReactDOM.hydrateRoot）注册
 * window error / unhandledrejection / 水合相关 console.error 监听，捕获后经
 * navigator.sendBeacon 上报 /api/diag（落入系统临时目录 NDJSON 日志）。
 * 本组件渲染 null，不产生任何 UI 或水合差异。
 */

function post(t: string, m: string, s: string) {
  try {
    const record = JSON.stringify({
      t,
      m: m.slice(0, 600),
      s: s.slice(0, 1800),
      h: window.location.href,
      u: navigator.userAgent.slice(0, 140),
      ts: Date.now(),
    })
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/diag', new Blob([record], { type: 'application/json' }))
    }
  } catch {
    return // 信标尽力而为：失败静默，不影响页面
  }
}

function interesting(message: string): boolean {
  return /Minified React error|Hydration|hydration|hydrat/i.test(message)
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    post(
      'error',
      String(e.message),
      String((e.error && e.error.stack) || `${e.filename} ${e.lineno}`),
    )
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | null | undefined
    post('rejection', String((r && (r.message || r)) || e.reason), String((r && r.stack) || ''))
  })
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    // 格式化失败时静默降级为原文透传，不吞原始 console.error 调用
    const message = (() => {
      try {
        return args.map((a) => String(a)).join(' ')
      } catch {
        return ''
      }
    })()
    if (interesting(message)) post('console', message, '')
    originalError.apply(console, args)
  }
}

export function DiagBeacon() {
  return null
}
