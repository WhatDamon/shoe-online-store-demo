import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useModalDismiss } from './use-modal'

/** 三段式 harness：触发按钮 + 两个可聚焦元素 + 关闭按钮，足以验证环形与否。 */
function Harness({
  onKeyDown,
  withTrigger = true,
  empty = false,
}: {
  onKeyDown?: (e: KeyboardEvent) => void
  withTrigger?: boolean
  empty?: boolean
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const dismiss = useModalDismiss({
    open,
    dialogRef,
    triggerRef: withTrigger ? triggerRef : undefined,
    onClose: () => setOpen(false),
    onKeyDown,
  })
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        open
      </button>
      {open ? (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="test dialog">
          {empty ? null : (
            <>
              <button type="button">first</button>
              <button type="button">second</button>
              <button type="button" onClick={dismiss}>
                close
              </button>
            </>
          )}
        </div>
      ) : null}
    </>
  )
}

const openDialog = () => fireEvent.click(screen.getByRole('button', { name: 'open' }))

describe('useModalDismiss', () => {
  it('打开时把焦点移到首个可聚焦元素', () => {
    render(<Harness />)
    openDialog()
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus()
  })

  it('Tab 在末元素上回环到首个元素（不外逃到页面）', () => {
    render(<Harness />)
    openDialog()
    screen.getByRole('button', { name: 'close' }).focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus()
  })

  it('Shift+Tab 在首元素上回环到末元素', () => {
    render(<Harness />)
    openDialog()
    screen.getByRole('button', { name: 'first' }).focus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'close' })).toHaveFocus()
  })

  it('中间元素上的 Tab 不被劫持（交给浏览器自然推进）', () => {
    render(<Harness />)
    openDialog()
    screen.getByRole('button', { name: 'first' }).focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus() // 未被手动移动
  })

  it('Escape 关闭并把焦点还给触发元素', () => {
    render(<Harness />)
    openDialog()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'open' })).toHaveFocus()
  })

  // dismiss 存在的理由：关闭按钮 / 点遮罩也必须还原焦点，而不是只有 Escape 会。
  it('经 dismiss 关闭的路径同样还原焦点', () => {
    render(<Harness />)
    openDialog()
    fireEvent.click(screen.getByRole('button', { name: 'close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'open' })).toHaveFocus()
  })

  it('无触发元素（灯箱这类多入口弹窗）时不还原焦点也不崩', () => {
    render(<Harness withTrigger={false} />)
    openDialog()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('弹窗内没有可聚焦元素时 Tab 不崩', () => {
    render(<Harness empty />)
    openDialog()
    expect(() => fireEvent.keyDown(window, { key: 'Tab' })).not.toThrow()
  })

  it('额外按键透传给 onKeyDown', () => {
    const onKeyDown = vi.fn()
    render(<Harness onKeyDown={onKeyDown} />)
    openDialog()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: 'ArrowRight' }))
  })

  it('关闭后不再响应按键（监听已卸载）', () => {
    const onKeyDown = vi.fn()
    render(<Harness onKeyDown={onKeyDown} />)
    openDialog()
    fireEvent.keyDown(window, { key: 'Escape' })
    onKeyDown.mockClear()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onKeyDown).not.toHaveBeenCalled()
  })
})
