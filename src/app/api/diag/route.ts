import { NextResponse } from 'next/server'
import { appendFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LOG = join(tmpdir(), 'evoloop-diag.ndjson')

/**
 * 临时诊断端点（根因排查后移除）：接收客户端信标脚本上报的 JS 错误，
 * 追加到系统临时目录的 NDJSON 日志，便于真机（无法连 devtools）复现
 * React 水合失败时读取真实错误文本。POST=写入 GET=回读尾部。
 */
export async function POST(req: Request) {
  try {
    const body = await req.text()
    appendFileSync(LOG, body + '\n')
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function GET() {
  try {
    const lines = readFileSync(LOG, 'utf8').trim().split('\n')
    return NextResponse.json({ lines: lines.slice(-60) })
  } catch {
    return NextResponse.json({ lines: [] })
  }
}
