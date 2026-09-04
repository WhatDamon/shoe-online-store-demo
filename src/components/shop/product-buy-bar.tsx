import { Button, buttonVariants } from '@/components/ui/button'

interface ProductBuyBarProps {
  /** 服务端已算好的 Shopify 结算 URL；无 store 时为 null（占位 + 适配器就绪） */
  buyUrl: string | null
  /** 无 store 阶段语义标记：未来有 URL 时是否仍处 "即将上线" */
  availableSoon: boolean
  /** 已选尺码的市场标签（如 "US 9"）；未选为 null，用于 aria-live 说明 */
  selectedLabel: string | null
}

// 无 store 阶段（决策：购物端在 Shopify，本期不实现）：
// buyUrl 为 null → 禁用态 "Available soon" 占位 + 消费者文案；
// 选尺码后仍禁用 → role="status"（aria-live polite）向读屏说明原因。
// 未来配置 Shopify 后 buyUrl 非空 → 直接渲染 <a href>。
export function ProductBuyBar({ buyUrl, availableSoon, selectedLabel }: ProductBuyBarProps) {
  if (buyUrl && !availableSoon) {
    return (
      <a
        href={buyUrl}
        className={buttonVariants({ className: 'w-full py-2.5 text-base' })}
      >
        Add to bag
      </a>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button disabled className="w-full py-2.5 text-base">
        Available soon
      </Button>
      <p className="text-xs leading-5 text-neutral-500">
        Checkout lands on our Shopify store.
      </p>
      <p role="status" className="min-h-4 text-xs leading-5 text-neutral-500">
        {selectedLabel
          ? `${selectedLabel} selected — we open checkout once our store is live.`
          : ''}
      </p>
    </div>
  )
}
