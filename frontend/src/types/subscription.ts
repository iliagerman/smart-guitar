export interface SubscriptionDetail {
  status: 'active' | 'trialing' | 'past_due' | 'paused' | 'canceled'
  plan_type: 'monthly' | 'yearly'
  current_period_end: string | null
  canceled_at: string | null
}

export interface SubscriptionStatus {
  has_access: boolean
  trial_ends_at: string | null
  trial_active: boolean
  subscription: SubscriptionDetail | null
}

export interface PriceDetail {
  id: string
  name: string
  amount: string
  currency: string
  interval: string
}

export interface Prices {
  monthly: PriceDetail | null
  yearly: PriceDetail | null
}

export interface CheckoutData {
  payment_url: string
}
