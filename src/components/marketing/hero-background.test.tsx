import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { HeroBackground } from './hero-background'

// jsdom 无 IntersectionObserver / matchMedia；HTMLMediaElement.play/pause/load 未实现 —— 全部注入 stub。
// IO 手动触发（模拟可见/离视口），媒体就绪用 canplaythrough / ended 合成事件。

class IOStub {
  static instance: IOStub | null = null
  cb: (entries: { isIntersecting: boolean }[]) => void
  constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
    this.cb = cb
    IOStub.instance = this
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  fire(isIntersecting: boolean) {
    this.cb([{ isIntersecting }])
  }
}

function stubEnvironment(opts: { reduced?: boolean; saveData?: boolean; slow?: boolean }) {
  const { reduced = false, saveData = false, slow = false } = opts
  // 仅 reduced/saveData/slow 为 true 时才注入，避免跨用例泄漏；afterEach 统一还原
  if (reduced) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  }
  if (saveData || slow) {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData, effectiveType: slow ? '2g' : '4g' },
    })
  }
}

function clearEnvironment() {
  vi.unstubAllGlobals()
  delete (navigator as Navigator & { connection?: unknown }).connection
}

function mediaSpies() {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined as never)
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  return { play, pause, load }
}

describe('HeroBackground (design: static 6s → cached video cross-fade → loop)', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', IOStub)
    IOStub.instance = null
  })
  afterEach(() => {
    clearEnvironment()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders only the static image while no source attaches and nothing plays', () => {
    const { play } = mediaSpies()
    render(<HeroBackground />)
    expect(document.querySelector('img')).not.toBeNull()
    const video = document.querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.getAttribute('src')).toBeNull() // 禁播/未视口：无 src
    expect(play).not.toHaveBeenCalled()
  })

  it('stays on the static image forever under prefers-reduced-motion (src never attaches)', () => {
    stubEnvironment({ reduced: true })
    const { play } = mediaSpies()
    render(<HeroBackground />)
    act(() => IOStub.instance?.fire(true))
    vi.useFakeTimers()
    act(() => {
      vi.advanceTimersByTime(20000)
    })
    const video = document.querySelector('video')
    expect(video?.getAttribute('src')).toBeNull()
    expect(play).not.toHaveBeenCalled()
    const img = document.querySelector('img')
    expect(img?.className).toContain('opacity-55')
  })

  it('never attaches src under saveData, and 2g is treated as slow', () => {
    for (const cfg of [{ saveData: true }, { slow: true }]) {
      stubEnvironment(cfg)
      const { play } = mediaSpies()
      vi.useFakeTimers()
      render(<HeroBackground key={JSON.stringify(cfg)} />)
      act(() => IOStub.instance?.fire(true))
      act(() => {
        vi.advanceTimersByTime(20000)
      })
      expect(document.querySelector('video')?.getAttribute('src')).toBeNull()
      expect(play).not.toHaveBeenCalled()
      vi.restoreAllMocks()
      vi.useRealTimers()
      vi.unstubAllGlobals()
      IOStub.instance = null
    }
  })

  it('attaches src on viewport entry; plays after 6s once cached; fades back after ended', () => {
    const { play } = mediaSpies()
    vi.useFakeTimers()
    render(<HeroBackground />)
    // 进入视口 → 挂 src 并开始 6s 计时
    act(() => IOStub.instance?.fire(true))
    const video = document.querySelector('video')
    expect(video?.getAttribute('src')).toBe('/videos/hero-a.mp4')

    // 视频在 6s 前就绪 → 到时即播
    act(() => {
      fireEvent(video!, new Event('canplaythrough'))
      vi.advanceTimersByTime(6000)
    })
    expect(play).toHaveBeenCalledTimes(1)
    const img = document.querySelector('img')
    expect(img?.className).toContain('opacity-0') // 图片淡出

    // ended → 淡回静态图
    act(() => {
      fireEvent(video!, new Event('ended'))
    })
    expect(img?.className).toContain('opacity-55')
    expect(video?.className).toContain('opacity-0')

    // 循环：再来 6s 又播放一次
    act(() => {
      fireEvent(video!, new Event('canplaythrough'))
      vi.advanceTimersByTime(6000)
    })
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('waits for the video when 6s elapse before it is cached, then plays on ready', () => {
    const { play } = mediaSpies()
    vi.useFakeTimers()
    render(<HeroBackground />)
    act(() => IOStub.instance?.fire(true))
    const video = document.querySelector('video')
    // 6s 到点但视频未就绪 → 不应播放
    act(() => {
      vi.advanceTimersByTime(6000)
    })
    expect(play).not.toHaveBeenCalled()
    // 就绪到达 → 立即补播
    act(() => {
      fireEvent(video!, new Event('canplaythrough'))
    })
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('leaving the viewport stops playback and resets to the image; re-entering re-times', () => {
    const { play, pause, load } = mediaSpies()
    vi.useFakeTimers()
    render(<HeroBackground />)
    act(() => IOStub.instance?.fire(true))
    const video = document.querySelector('video')
    act(() => {
      fireEvent(video!, new Event('canplaythrough'))
      vi.advanceTimersByTime(6000)
    })
    expect(play).toHaveBeenCalledTimes(1)

    // 滑出视口 → pause + load 复位 + 回静态图
    act(() => IOStub.instance?.fire(false))
    expect(pause).toHaveBeenCalled()
    expect(load).toHaveBeenCalled()
    const img = document.querySelector('img')
    expect(img?.className).toContain('opacity-55')

    // 回到视口 → 重新 6s 计时后再播
    act(() => {
      IOStub.instance?.fire(true)
      vi.advanceTimersByTime(6000)
    })
    expect(play).toHaveBeenCalledTimes(2)
  })
})
