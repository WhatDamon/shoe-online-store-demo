'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { ProductView } from '@/domain/product'

interface ProductColorSelectionValue {
  imageFocus: { url: string | null }
  focusImage: (url: string | null) => void
}

const ProductColorSelectionContext = createContext<ProductColorSelectionValue | null>(null)

// Only purchase actions publish image focus. Browsing the gallery never changes a variant.
export function ProductColorSelectionProvider({
  children,
}: {
  product: ProductView
  children: ReactNode
}) {
  const [imageFocus, setImageFocus] = useState<{ url: string | null }>({ url: null })
  const focusImage = useCallback((url: string | null) => setImageFocus({ url }), [])
  const value = useMemo(() => ({ imageFocus, focusImage }), [imageFocus, focusImage])

  return (
    <ProductColorSelectionContext.Provider value={value}>
      {children}
    </ProductColorSelectionContext.Provider>
  )
}

export function useOptionalProductColorSelection() {
  return useContext(ProductColorSelectionContext)
}
