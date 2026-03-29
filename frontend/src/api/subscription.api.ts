import { api } from '../config/api'
import type { MessageResponse } from '../types/api'
import type { SubscriptionStatus, Prices, CheckoutData, CancelSubscriptionResponse } from '../types/subscription'

export const subscriptionApi = {
  getStatus: () =>
    api.get<SubscriptionStatus>('/api/v1/subscription/status').then((r) => r.data),

  getPrices: () =>
    api.get<Prices>('/api/v1/subscription/prices').then((r) => r.data),

  checkout: (planType: 'monthly' | 'yearly') =>
    api
      .post<CheckoutData>('/api/v1/subscription/checkout', { plan_type: planType })
      .then((r) => r.data),

  cancel: () =>
    api
      .post<CancelSubscriptionResponse>('/api/v1/subscription/cancel')
      .then((r) => r.data),

  markOnboardingSeen: () =>
    api.post<MessageResponse>('/api/v1/subscription/onboarding-seen').then((r) => r.data),

  resetOnboarding: () =>
    api.post<MessageResponse>('/api/v1/subscription/onboarding-reset').then((r) => r.data),
}
