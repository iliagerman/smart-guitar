export interface SubscriptionDetail {
  status: 'active' | 'trialing' | 'past_due' | 'paused' | 'canceled'
  plan_type: 'monthly' | 'yearly'
  current_period_end: string | null
  canceled_at: string | null
}

export type SubscriptionTier = 'trial' | 'pro' | 'free'

export interface SubscriptionStatus {
  /** True for Pro access: an active trial or a paid subscription. */
  has_access: boolean
  tier: SubscriptionTier
  trial_ends_at: string | null
  trial_active: boolean
  subscription: SubscriptionDetail | null
  has_seen_onboarding: boolean
  is_admin: boolean
  onboarding_song_id: string | null
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

export interface CancelSubscriptionResponse {
  message: string
  effective_date: string | null
}
