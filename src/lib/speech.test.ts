import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chunkForSpeech,
  isSpeechSupported,
  readAloud,
  stopSpeaking,
  toSpeechText,
} from '@/lib/speech'

/** jsdom 无 speechSynthesis：默认 unsupported；需注入 mock 的测试自行安装。 */
class FakeUtterance {
  text: string
  lang = ''
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

let synth: {
  spoken: FakeUtterance[]
  cancelCalls: number
  speak: (u: FakeUtterance) => void
  cancel: () => void
}

const installSpeech = () => {
  synth = {
    spoken: [],
    cancelCalls: 0,
    speak(u: FakeUtterance) {
      this.spoken.push(u)
    },
    cancel() {
      this.cancelCalls += 1
    },
  }
  vi.stubGlobal('speechSynthesis', synth)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
}

const uninstallSpeech = () => {
  vi.unstubAllGlobals()
}

beforeEach(() => {
  vi.restoreAllMocks()
  uninstallSpeech()
})

afterEach(() => {
  uninstallSpeech()
})

describe('isSpeechSupported', () => {
  it('false in jsdom/SSR without speechSynthesis', () => {
    expect(isSpeechSupported()).toBe(false)
  })

  it('false when only speechSynthesis exists but no Utterance ctor', () => {
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() })
    expect(isSpeechSupported()).toBe(false)
  })

  it('true when both exist', () => {
    installSpeech()
    expect(isSpeechSupported()).toBe(true)
  })
})

describe('toSpeechText', () => {
  it('strips bold, inline code and link syntax', () => {
    expect(toSpeechText('Try **Daily Drift** in `US 9` — see [the guide](https://x.test/g).')).toBe(
      'Try Daily Drift in US 9 — see the guide.',
    )
  })

  it('strips heading markers and list prefixes from line starts', () => {
    expect(toSpeechText('# Sizes\n- US 7\n- US 8\n3. done')).toBe('Sizes\nUS 7\nUS 8\ndone')
  })

  it('flattens excess blank lines and trims', () => {
    expect(toSpeechText('a\n\n\n\nb  ')).toBe('a\n\nb')
  })

  it('returns empty for empty input', () => {
    expect(toSpeechText('')).toBe('')
    expect(toSpeechText('  \n  ')).toBe('')
  })
})

describe('chunkForSpeech', () => {
  it('short text stays one chunk', () => {
    expect(chunkForSpeech('short reply')).toEqual(['short reply'])
  })

  it('empty input produces no chunks', () => {
    expect(chunkForSpeech('   ')).toEqual([])
  })

  it('long text breaks at sentence boundaries below the cap', () => {
    const long =
      'First sentence with several words here. Second sentence also fairly long. ' +
      'Third sentence rounds things out nicely for testing.'.repeat(2)
    const chunks = chunkForSpeech(long, 60)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(70)
    // 拼接不回丢文字（忽略分块消耗的空白）
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' ').trim())
  })

  it('a single over-cap sentence is hard-split without losing content', () => {
    const one = 'word '.repeat(200) + 'end'
    const chunks = chunkForSpeech(one, 100)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(one.trim())
  })

  it('a short paragraph split stays a single chunk but long text breaks at paragraph breaks', () => {
    // 低于硬上限：整段保留为一块（含空行，朗读自然停顿）
    expect(chunkForSpeech('para one here.\n\npara two here.', 50)).toEqual([
      'para one here.\n\npara two here.',
    ])
    // 超上限：段落边界成为断点，空行被丢弃
    const long = 'para one here. '.repeat(10) + '\n\n' + 'para two here. '.repeat(10)
    const chunks = chunkForSpeech(long, 60)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' ').trim())
  })
})

describe('readAloud / stopSpeaking', () => {
  it('no-ops when unsupported', () => {
    // jsdom 无 speechSynthesis；调用不抛即可
    expect(() => readAloud('hi')).not.toThrow()
    expect(() => stopSpeaking()).not.toThrow()
  })

  it('speaks chunks sequentially as each onend fires', () => {
    installSpeech()
    const long = 'sentence one here. '.repeat(8) // >200 chars
    readAloud(long)
    // 未触发 onend：只发了首块
    expect(synth.spoken.length).toBe(1)
    expect(synth.cancelCalls).toBe(1)
    const totalChunks = chunkForSpeech(long).length
    for (let i = 0; i < totalChunks - 1; i++) {
      const u = synth.spoken[i]
      expect(u.lang).toBe('en-US')
      u.onend?.()
    }
    expect(synth.spoken.length).toBe(totalChunks)
    const text = synth.spoken.map((u) => u.text).join(' ')
    expect(text.replace(/\s+/g, ' ')).toBe(toSpeechText(long).replace(/\s+/g, ' '))
  })

  it('a new readAloud cancels the previous run (old onend ignored)', () => {
    installSpeech()
    readAloud('first long sentence. '.repeat(6))
    const firstRunChunks = synth.spoken.length
    readAloud('second')
    // 旧队列已被代际失效：只发第二段，不再续旧块
    expect(synth.spoken.at(-1)?.text).toBe('second')
    // 触发旧 onend 也不应继续发旧块
    for (const u of synth.spoken) u.onend?.()
    expect(synth.spoken.length).toBe(firstRunChunks + 1)
  })

  it('stopSpeaking cancels and voids the queue', () => {
    installSpeech()
    readAloud('long enough to chunk. '.repeat(6))
    const spoken = synth.spoken.length
    stopSpeaking()
    expect(synth.cancelCalls).toBeGreaterThanOrEqual(2)
    // 队列失效：触发遗留 onend 不应再发声
    for (const u of synth.spoken) u.onend?.()
    expect(synth.spoken.length).toBe(spoken)
  })
})
