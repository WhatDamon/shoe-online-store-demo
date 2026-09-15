'use client'

// 模态框通用行为：打开时把焦点移入、Tab/Shift+Tab 在框内环形、Escape 关闭、关闭后焦点还给
// 触发元素（WCAG 2.1.2 无键盘陷阱 / 2.4.3 焦点顺序）。三处弹窗此前各自逐字复制了同一段实现。
//
// 返回 dismiss() 而不是只关状态：三条关闭路径（Escape / 关闭按钮 / 点遮罩）都必须还原焦点，
// 把「关状态 + 还焦点」绑成一个动作，调用方就不可能只做对一半。
import { useCallback, useEffect, useRef, type RefObject } from 'react'

/** 可聚焦元素（无依赖的轻量 selector，覆盖按钮/链接/表单控件）。 */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

export interface ModalDismissOptions {
  open: boolean
  /** 弹窗根节点（含遮罩）：焦点圈闭在其内部。 */
  dialogRef: RefObject<HTMLElement | null>
  /** 关闭后焦点归还的元素。灯箱这类多入口弹窗可不传（无可归属的单一触发元素）。 */
  triggerRef?: RefObject<HTMLElement | null>
  onClose: () => void
  /** Escape/Tab 之外的额外按键（如灯箱的左右方向键）。 */
  onKeyDown?: (e: KeyboardEvent) => void
}

export function useModalDismiss({
  open,
  dialogRef,
  triggerRef,
  onClose,
  onKeyDown,
}: ModalDismissOptions): () => void {
  // 最新回调模式：调用方通常以箭头函数传入（每次渲染换身份），若进依赖数组会让监听每次
  // 渲染重挂 —— 副作用是「打开期间每次重渲染都把焦点抢回第一个元素」。
  const latest = useRef({ onClose, onKeyDown })
  useEffect(() => {
    latest.current = { onClose, onKeyDown }
  })

  const dismiss = useCallback(() => {
    latest.current.onClose()
    triggerRef?.current?.focus()
  }, [triggerRef])

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    // 直接 focus：effect 在 React 提交后运行，dialog 已挂载；rAF 在 jsdom 不触发，测试不可靠。
    focusableIn(dialog)[0]?.focus()

    const onKey = (e: KeyboardEvent) => {
      latest.current.onKeyDown?.(e)
      if (e.key === 'Escape') {
        e.preventDefault()
        dismiss()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusableIn(dialog)
      if (items.length === 0) return
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const idx = active ? items.indexOf(active) : -1
      if (e.shiftKey && (idx <= 0 || idx === -1)) {
        e.preventDefault()
        items[items.length - 1]?.focus()
      } else if (!e.shiftKey && (idx === items.length - 1 || idx === -1)) {
        e.preventDefault()
        items[0]?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dialogRef, dismiss])

  return dismiss
}
