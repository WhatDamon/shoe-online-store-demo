const messages: Record<string, string> = {
  insufficient_stock: 'Not enough stock. Update the quantity in your cart.',
  empty_cart: 'Your cart is empty. Choose a product first.',
  order_not_found: "We couldn't find this order for the current session.",
  backend_unavailable: 'The shopping service is temporarily unavailable. Please try again.',
}
export async function commerceRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/commerce/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(
      messages[data.detail] ??
        "We couldn't complete that action. Check the quantity and try again.",
    )
  }
  return data as T
}
