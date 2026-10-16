import { describe, expect, it } from 'vitest'
import { POLICY_CARE, POLICY_PRODUCTION, POLICY_RETURNS, STORE_POLICY_FACTS } from './store-policy'

describe('store policy wording', () => {
  it('keeps the refund exception for an order that was paid but not yet made', () => {
    // Without this exception a customer who has paid for a pair we have not started reading
    // "custom-printed items can't be returned or refunded" has been told their money is gone.
    expect(POLICY_RETURNS).toMatch(/have not made or shipped it yet/i)
    expect(POLICY_RETURNS).toMatch(/refund you in full/i)
  })

  it('still states the no-returns rule for made items', () => {
    expect(POLICY_RETURNS).toMatch(/printed to order/i)
    expect(POLICY_RETURNS).toMatch(/can't be returned or refunded/i)
  })

  it('keeps the faulty-fit remedy and stays consistent with the care sheet', () => {
    expect(POLICY_RETURNS).toMatch(/faulty/)
    expect(POLICY_CARE).toMatch(/non-returnable and non-exchangeable except for quality defects/)
  })

  it('injects exactly the same facts into the AI assistant as the page shows', () => {
    expect(STORE_POLICY_FACTS).toEqual([POLICY_PRODUCTION, POLICY_RETURNS, POLICY_CARE])
  })
})
