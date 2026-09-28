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
  SETLIST: '/setlists/:setlistId',
  TUNER: '/tuner',
  METRONOME: '/metronome',
  PROFILE: '/profile',
  SUBSCRIPTION_SUCCESS: '/subscription/success',
  SUBSCRIPTION_FAIL: '/subscription/fail',
} as const

export function songDetailPath(songId: string) {
  return `/songs/${songId}`
}

export function setlistPath(setlistId: string) {
  return `/setlists/${setlistId}`
}
