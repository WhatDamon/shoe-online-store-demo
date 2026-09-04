'use client'

// 极轻 markdown 渲染子集（零依赖、无 dangerouslySetInnerHTML → 天然 XSS 安全）：
// 粗体 **x**、行内代码 `x`、保留换行，并把 "- " 开头的行前缀换成 "• "。
// 解析产物全部是 React 文本/元素节点，React 会自行转义任何字面量内容。
import type { ReactNode } from 'react'
import { Fragment } from 'react'
import { cn } from 'cn'

function renderInline(text: string, keyBase: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((p) => p !== '')
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="rounded bg-neutral-200/60 px-1 py-0.5 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <Fragment key={key}>{part}</Fragment>
  })
}

export function MarkdownLite({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  // 项目符号行统一成 "• "（简报：• 前缀替换 -）
  const normalized = text
    .split('\n')
    .map((line) =>
      line.trimStart().startsWith('- ')
        ? `• ${line.trimStart().slice(2)}`
        : line,
    )
    .join('\n')

  return (
    <div className={cn('whitespace-pre-wrap break-words', className)}>
      {renderInline(normalized, 'md')}
    </div>
  )
}
