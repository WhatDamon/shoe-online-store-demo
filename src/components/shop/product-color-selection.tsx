'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import type { ProductView } from '@/domain/product'

interface ProductColorSelectionValue {
  colorIndex: number
  setColorIndex: (index: number) => void
  imagesFollowColors: boolean
}

const ProductColorSelectionContext = createContext<ProductColorSelectionValue | null>(null)

export function ProductColorSelectionProvider({
  product,
  children,
}: {
  product: ProductView
  children: ReactNode
}) {
  const [colorIndex, setColorIndex] = useState(0)
  const colorCount = product.colors?.length ?? 0
  const imageCount = product.images?.length ?? 0
  const imagesFollowColors = colorCount > 1 && colorCount === imageCount

  const value = useMemo<ProductColorSelectionValue>(
    () => ({
      colorIndex,
      setColorIndex: (index) => {
        if (index >= 0 && index < colorCount) setColorIndex(index)
      },
      imagesFollowColors,
    }),
    [colorCount, colorIndex, imagesFollowColors],
  )

  return (
    <ProductColorSelectionContext.Provider value={value}>
      {children}
    </ProductColorSelectionContext.Provider>
  )
}

export function useOptionalProductColorSelection() {
  return useContext(ProductColorSelectionContext)
}
