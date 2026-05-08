export const ROUTES = {
  LOGIN: '/login',
  REGISTER: '/register',
  CONFIRM_EMAIL: '/confirm-email',
  CALLBACK: '/callback',
  SONGS: '/songs',
  SEARCH: '/search',
  LIBRARY: '/library',
  FAVORITES: '/favorites',
  ANALYTICS: '/analytics',
  SONG_DETAIL: '/songs/:songId',
  TUNER: '/tuner',
  PROFILE: '/profile',
  SUBSCRIPTION_SUCCESS: '/subscription/success',
  SUBSCRIPTION_FAIL: '/subscription/fail',
} as const

export function songDetailPath(songId: string) {
  return `/songs/${songId}`
}
