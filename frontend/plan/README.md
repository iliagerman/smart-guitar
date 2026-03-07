# Frontend Implementation Plan

## Overview

React 19 + Vite + TypeScript web app with Capacitor for iOS/Android.
Fire-themed guitar learning app that connects to the FastAPI backend.

**Key design change**: Audio plays one track at a time based on user selection
(not multi-stem mixing). The user picks which stem to listen to (vocals, drums,
bass, guitar, piano, other, or the full mix).

---

## Tech Stack

| Category | Choice |
|----------|--------|
| Framework | React 19 + TypeScript (strict) |
| Build | Vite 6 |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Server state | TanStack Query v5 |
| Client state | Zustand v5 |
| Auth | `@aws-amplify/auth` (standalone) for Google OAuth, direct API calls for email/password |
| Audio | wavesurfer.js (waveform), HTML5 `<audio>` (playback) |
| Mobile | Capacitor 6 (iOS + Android) |
| Testing | vitest + RTL + MSW v2 (unit/integration), Playwright (E2E) |
| Icons | lucide-react |

---

## Audio Playback Architecture

### Single-Track Playback

The player plays **one audio track at a time**. The user selects from:
- Full mix (original audio)
- Vocals
- Drums
- Bass
- Guitar
- Piano
- Other

Switching tracks loads the corresponding presigned URL (or local stream)
into the same `<audio>` element. wavesurfer.js renders the waveform and
syncs with playback position.

### Streaming

| Environment | How audio is delivered |
|-------------|----------------------|
| **Local** (`localhost:8002`) | Backend streams the file via a new `GET /api/v1/songs/{id}/stream?stem={name}` endpoint. The frontend sets the `<audio>` src to this URL. |
| **AWS** (`api.smart-guitar.com`) | Backend returns presigned S3 URLs in the `SongDetailResponse`. The frontend sets the `<audio>` src to the presigned URL directly. |

The frontend checks `VITE_APP_ENV` to decide:
- `local` → use `/api/v1/songs/{id}/stream?stem=vocals` as the audio src
- `production` → use the presigned URL from `stems.vocals`

### Component Structure

```
PlayerPage
  ├── SongHeader          (thumbnail, title, artist, favorite button)
  ├── WaveformDisplay     (wavesurfer.js canvas)
  ├── TransportControls   (play/pause, seek bar, time display)
  ├── TrackSelector       (radio group: full mix, vocals, drums, bass, guitar, piano, other)
  ├── ChordTimeline       (scrollable chord badges synced to playback)
  └── ProcessButton       (trigger stem separation if not processed yet)
```

### TrackSelector Component

A radio group of track options. Each option shows:
- Stem icon (fire-outlined)
- Stem name
- Active indicator (fire glow when selected)

When the user switches tracks:
1. Pause current playback
2. Note the current playback position
3. Load the new track URL into the `<audio>` element
4. Seek to the saved position
5. Resume playback (if was playing)

---

## Project Structure

See `structure.md` in this folder.

---

## Pages & Routes

| Route | Page | Auth |
|-------|------|------|
| `/login` | LoginPage | Public |
| `/register` | RegisterPage | Public |
| `/confirm-email` | ConfirmEmailPage | Public |
| `/callback` | CallbackPage (OAuth) | Public |
| `/search` | SearchPage | Protected |
| `/library` | LibraryPage | Protected |
| `/favorites` | FavoritesPage | Protected |
| `/songs/:songId` | PlayerPage | Protected |
| `/profile` | ProfilePage | Protected |

---

## Auth Flow

### Email/Password
1. Register → backend `POST /auth/register` → Cognito sends verification email
2. Confirm → backend `POST /auth/confirm` with code from email
3. Login → backend `POST /auth/login` → returns JWT tokens
4. Store tokens in Zustand (refresh token persisted to localStorage)
5. Axios interceptor attaches Bearer token, auto-refreshes on 401

### Google OAuth
1. Click "Sign in with Google"
2. `@aws-amplify/auth` `signInWithRedirect({ provider: 'Google' })`
3. Redirects through Cognito Hosted UI → Google consent → back to `/callback`
4. CallbackPage extracts tokens via `fetchAuthSession()`
5. Store in Zustand, redirect to `/search`

---

## Environment Config

| Variable | Local | Production |
|----------|-------|------------|
| `VITE_API_BASE_URL` | `http://localhost:8002` | `https://api.smart-guitar.com` |
| `VITE_APP_ENV` | `local` | `production` |
| `VITE_COGNITO_USER_POOL_ID` | `us-east-1_HE4CcXwss` | same |
| `VITE_COGNITO_CLIENT_ID` | `6md6g1htlr1jmr62d8o47n9q6m` | same |
| `VITE_COGNITO_DOMAIN` | `auth.smart-guitar.com` | same |

---

## Design System

See `design.md` in this folder and the generated demo images in `demos/`.

**Theme**: Dark background (charcoal) with fire colors (orange, red, amber, yellow).
Not generic — custom art generated with Nano Banana Pro.

---

## Testing Strategy

### data-testid Convention

Pattern: `{feature}-{element}` or `{feature}-{element}-{id}`

Examples: `search-input`, `track-selector-vocals`, `player-play-button`,
`song-card-{id}`, `favorite-toggle-{id}`

### Unit/Integration (vitest + RTL + MSW v2)

- Co-located test files: `Component.test.tsx` next to `Component.tsx`
- MSW handlers mirror backend API (one file per domain)
- Test factories for songs, jobs, favorites
- Custom render with providers (QueryClient, Router, Auth)

### E2E (Playwright)

- Desktop Chrome (1280x720), iPhone 14, Pixel 7
- Page Object Model pattern
- Auth fixture (pre-authenticated storage state)
- Run against local backend with `SKIP_AUTH=1`

---

## Implementation Sequence

1. Scaffolding (Vite, TS, Tailwind, shadcn, ESLint, Prettier)
2. Auth (stores, API client, login/register, AuthGuard)
3. Layout (AppShell, routing, BottomNav, Header)
4. Search (SearchPage, results, song selection)
5. Library (song list, recent songs)
6. Player (wavesurfer, single-track playback, track selector, chords)
7. Jobs (process button, polling)
8. Favorites (CRUD, optimistic updates)
9. Design (fire theme, Nano Banana art assets)
10. Testing (MSW, unit tests, Playwright E2E)
11. Google OAuth (after Terraform applied)
12. Capacitor (iOS/Android builds)
