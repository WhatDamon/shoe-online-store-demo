'use client'

import { createContext, useContext, useMemo } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales'
import { messages, type Messages } from '@/i18n/messages'

interface LocaleValue {
  locale: Locale
  messages: Messages
}

/**
 * 默认值就是默认语言，而不是抛错的空值：消费端文案既产自服务端也渲染在客户端组件里，
 * 未挂 Provider 的客户端组件（以及既有的单元测试）必须仍能渲染，而不是整棵子树崩溃。
 */
const DEFAULT_VALUE: LocaleValue = { locale: DEFAULT_LOCALE, messages: messages(DEFAULT_LOCALE) }

const LocaleContext = createContext<LocaleValue>(DEFAULT_VALUE)

export function LocaleProvider({
  locale,
  messages: dictionary,
  children,
}: {
  locale: Locale
  messages: Messages
  children: ReactNode
}): ReactElement {
  const value = useMemo(() => ({ locale, messages: dictionary }), [locale, dictionary])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale
}

export function useMessages(): Messages {
  return useContext(LocaleContext).messages
}
