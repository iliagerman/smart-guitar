# E2E Test Coverage Gap Analysis

> Generated: 2026-04-29

## Executive Summary

The application has:
- **15 routed entry points** if you include `/` and the wildcard redirect
- **9 backend routers** with ~40 API endpoints
- **7 frontend feature modules**
- a very large **player/song-detail** surface area that contains most of the product value

### Important correction to the original plan

The current Playwright suite is **not full E2E coverage**.
Most existing Playwright specs are **UI-contract tests** because they heavily mock network requests with `page.route()`.

That means the app currently has:
- **reasonable smoke coverage for a few UI contracts**
- **strong backend integration coverage in pytest**
- **very limited true full-stack browser coverage**

If the goal is **full E2E coverage of the application**, the plan needs to distinguish between:

1. **Unit tests** — pure logic
2. **UI-contract/browser tests** — browser + mocked backend
3. **Full-stack E2E** — browser + real frontend + real backend + seeded test data

Right now, the repo is strongest in layers 1 and 2, and weak in layer 3.

---

## Current Test Inventory

### Frontend E2E (Playwright) — 6 spec files, ~20 tests

| Spec | What it covers | Test type |
|---|---|---|
| `auth.spec.ts` | Login page renders, form elements present, register nav, auth redirects | UI-contract / smoke |
| `search.spec.ts` | Search page loads, input accepts text, mocked API results render, sidebar visible | UI-contract |
| `tabs.spec.ts` | Song detail page doesn't crash when tabs payload is present | UI-contract |
| `mobile-nav.spec.ts` | Bottom nav navigation, favorites renders with mock data, profile/logout | UI-contract |
| `recommendations-prefetch.spec.ts` | Recommendations are prefetched during playback and appear when playback ends | UI-contract |
| `processing-resume.spec.ts` | Job polling resumes on refresh, job created when none exists, other-user progress shown | UI-contract |

### Frontend Unit Tests (Vitest) — 3 files, ~30 tests

| File | What it covers |
|---|---|
| `sheet-versions.test.ts` | `lyricsModeForActiveVersion()` |
| `strum-pattern.test.ts` | `getStrumPattern()` |
| `normalize-words.test.ts` | `normalizeWords()` |

### Backend Integration Tests (Pytest) — 22 files, ~200+ tests

Cover: auth, search/download/parse, song selection, favorites, jobs, recommendations, subscription router, processing lock, tabs/chords/lyrics pipelines, telegram, tutorial links, etc.

---

## What “Full E2E Coverage” Should Mean Here

For this app, “full E2E coverage” should mean:

- a browser test can start from a realistic auth state,
- hit the real frontend,
- hit the real backend for the critical flows,
- use deterministic seeded songs/users/jobs/subscriptions,
- verify user-visible behavior, not just API contracts,
- and cover both **mobile-first UX** and **desktop layout differences**.

### Recommended test pyramid for this repo

| Layer | Purpose | Current state | Target |
|---|---|---|---|
| Unit | Pure logic / data transforms | Good in a few libs; sparse overall | Keep focused |
| UI-contract Playwright | Deterministic component/page behavior with mocks | Moderate | Expand for edge cases |
| Full-stack Playwright | Real browser + real backend + seeded data | Weak | Build for critical paths |
| Backend integration pytest | Service/router confidence | Strong | Keep as is |

### Minimum bar for “covered”

A feature should only be called **covered** when it has:
- at least one **full-stack happy-path E2E** test for the primary user journey
- and, where needed, one **UI-contract** test for edge/error states that are hard to reproduce end-to-end

---

## Route-Level Coverage Map

| Route | Page | Current browser coverage | Status |
|---|---|---|---|
| `/` | default redirect | ❌ none | **GAP** |
| `/login` | LoginPage | ✅ render + redirects | **Partial** |
| `/register` | RegisterPage | ✅ navigation only | **Partial** |
| `/confirm-email` | ConfirmEmailPage | ❌ none | **GAP** |
| `/callback` | CallbackPage | ❌ none | **GAP** |
| `/search` | SearchPage | ✅ basic mocked render | **Partial** |
| `/library` | LibraryPage | ❌ none | **GAP** |
| `/favorites` | FavoritesPage | ✅ render-only | **Partial** |
| `/songs/:songId` | SongDetailPage | ✅ a few mocked slices | **Partial** |
| `/tuner` | TunerPage | ❌ none | **GAP** |
| `/profile` | ProfilePage | ✅ logout only | **Partial** |
| `/analytics` | AnalyticsDashboardPage | ❌ none | **GAP** |
| `/subscription/success` | SubscriptionSuccessPage | ❌ none | **GAP** |
| `/subscription/fail` | SubscriptionFailPage | ❌ none | **GAP** |
| `*` | wildcard redirect | ❌ none | **GAP** |

---

## Feature-Level Gap Analysis

## 1. 🔴 Auth Flow — HIGH PRIORITY

**Current**: login page smoke coverage only.

**Missing browser coverage**:
- [ ] Register form submission
- [ ] Register password mismatch validation
- [ ] Register backend error rendering
- [ ] Confirm email submission
- [ ] Confirm-email page loads email from query string / session storage
- [ ] Resend verification code from confirm page
- [ ] Login form submission
- [ ] Login invalid credentials error
- [ ] Login unconfirmed-user flow + resend confirmation
- [ ] Password visibility toggles on login/register
- [ ] Auth persistence after refresh
- [ ] OAuth callback page behavior
- [ ] Google sign-in button flow starts correctly
- [ ] Root redirect behavior for authenticated vs unauthenticated states

## 2. 🔴 Song Detail / Player — HIGH PRIORITY

This is the biggest untested area and should be treated as the main E2E priority.

**Current**: tabs payload contract, recommendations prefetch, processing resume.

**Missing browser coverage**:
- [ ] Search result opens song detail
- [ ] Existing local song path vs download-on-select path
- [ ] Full page render: header, controls, sheet/content, process area
- [ ] Blocking error state + retry button when song detail fails
- [ ] Download-pending state in `ProcessButton`
- [ ] Failed processing state + retry action
- [ ] Processing checklist stages update correctly
- [ ] Play / pause interaction
- [ ] Seek interaction
- [ ] Full mix vs stem playback selection
- [ ] Stem volume controls
- [ ] Playback rate changes
- [ ] Sheet mode switching (chords vs tabs)
- [ ] Lyrics source switching
- [ ] Highlight mode toggle
- [ ] Scroll mode toggle
- [ ] Chord display mode controls (normal / beginner / capo)
- [ ] Chord map dialog opens
- [ ] Tutorial overlay opens/closes
- [ ] Current chord panel updates during playback
- [ ] Chord sheet renders and syncs
- [ ] Tabs sheet renders and syncs
- [ ] Word highlighting during playback
- [ ] Auto-scroll behavior during playback
- [ ] Fullscreen mode on mobile
- [ ] Fullscreen controls: play/pause, speed up/down, exit
- [ ] Favorite toggle on song detail
- [ ] Chord edit mode open
- [ ] Add chord via word click in edit mode
- [ ] Rename / move / delete chord in edit mode
- [ ] Save chord edits
- [ ] Delete user chord version
- [ ] Chord version selector
- [ ] Background processing card for lyrics/tabs follow-up work
- [ ] Recommendations section appears after playback
- [ ] Share / record flow
- [ ] Onboarding tour shows and dismisses
- [ ] Wake-lock-related UX on mobile where relevant

## 3. 🟡 Search — MEDIUM PRIORITY

**Current**: page render, text input, mocked results.

**Missing browser coverage**:
- [ ] Real search happy path against backend
- [ ] Empty results state
- [ ] Loading state while searching
- [ ] Result card click for `exists_locally=true`
- [ ] Result card click for `exists_locally=false` download path
- [ ] Download failure banner
- [ ] Repeated searches update result list correctly
- [ ] Desktop sidebar navigation from search

## 4. 🟡 Library — MEDIUM PRIORITY

**Current**: none.

**Missing browser coverage**:
- [ ] Library page loads with seeded songs
- [ ] Recently Added section renders
- [ ] All Songs section renders
- [ ] Filter input filters results
- [ ] Song card click navigates to song detail
- [ ] Empty state when no songs exist
- [ ] Pull-to-refresh behavior
- [ ] Onboarding redirect when `has_seen_onboarding=false`

> Note: the earlier plan said “genre filter”, but the current page uses a **text filter**, not a genre filter.

## 5. 🟡 Favorites — MEDIUM PRIORITY

**Current**: render-only coverage.

**Missing browser coverage**:
- [ ] Add favorite from song detail
- [ ] Remove favorite from song detail
- [ ] Favorites page shows added favorite
- [ ] Favorites empty state
- [ ] Favorite persists after reload
- [ ] Favorite card click navigates to song detail

## 6. 🟡 Subscription / Paywall — MEDIUM PRIORITY

**Current**: effectively bypassed in browser tests by the auth fixture.

**Missing browser coverage**:
- [ ] Subscription guard loading state
- [ ] Subscription guard error state + retry
- [ ] Forced paywall when `has_access=false`
- [ ] User-opened paywall from profile/subscription section
- [ ] Trial state UI
- [ ] No-trial/no-subscription state UI
- [ ] Checkout button triggers API flow
- [ ] Active subscription state UI
- [ ] Cancel subscription confirm flow
- [ ] Keep subscription action in cancel confirm
- [ ] Success page polling + redirect to library
- [ ] Fail page render + back button

## 7. 🟡 Tuner — MEDIUM PRIORITY

**Current**: none.

**Missing browser coverage**:
- [ ] Tuner page render
- [ ] Start listening / stop listening
- [ ] Permission denied state
- [ ] String selection
- [ ] Tuning offset selection
- [ ] Note display render with mocked audio analysis
- [ ] Gauge updates from mocked pitch input

## 8. 🟢 Profile / Settings — LOW PRIORITY

**Current**: logout only.

**Missing browser coverage**:
- [ ] User email renders
- [ ] Subscription section renders inside profile
- [ ] Recording settings section renders
- [ ] Logout clears auth state, not just redirects

## 9. 🟢 Analytics (Admin) — LOW PRIORITY

**Current**: none.

**Missing browser coverage**:
- [ ] Admin guard blocks non-admin users
- [ ] Admin users see analytics nav item in bottom nav/sidebar
- [ ] Dashboard loading skeletons
- [ ] Dashboard happy path render
- [ ] Dashboard error state
- [ ] Date/user filters update queries
- [ ] Charts render with data
- [ ] Top songs table renders
- [ ] User activity table renders
- [ ] Recent events table renders

## 10. 🟢 Global Layout / Background Behavior — LOW PRIORITY

**Current**: lightly touched indirectly.

**Missing browser coverage**:
- [ ] Auth pages render without app shell nav
- [ ] Non-auth pages render with correct shell
- [ ] Desktop sidebar nav links all work
- [ ] Mobile bottom nav links all work, including tuner
- [ ] Admin nav item appears only for admins
- [ ] Legal links render in desktop sidebar
- [ ] Unknown route redirects correctly
- [ ] `JobWatcher` in-app toast for completed jobs
- [ ] `JobWatcher` toast for failed jobs
- [ ] Browser notification flow when tab is hidden
- [ ] Page-level loading spinners and blocking error states are consistent

## 11. 🟢 Non-UI Application Behavior Worth Verifying in Browser — LOW PRIORITY

These are not classic UI tests, but they matter for “application coverage”.

- [ ] Analytics/event tracking starts only when authenticated
- [ ] `page_view` is emitted on navigation changes
- [ ] Player analytics fire when stems / playback rate / sheet mode change
- [ ] Media cache behavior avoids repeated broken thumbnail requests

---

## Existing Test Quality Issues

## 1. The biggest planning gap: mocked tests are being counted as E2E

This is the main issue in the original plan.

Examples:
- `search.spec.ts` mocks `/songs/search`
- `tabs.spec.ts` mocks `/songs/:id`
- `mobile-nav.spec.ts` mocks `/favorites`
- `recommendations-prefetch.spec.ts` mocks almost the entire song experience
- `processing-resume.spec.ts` mocks song detail, jobs, polling, and events

These are useful, but they do **not** prove that the frontend and backend work together.

### Recommendation

Track coverage separately:

| Test type | Meaning |
|---|---|
| UI-contract | browser + mocked API |
| Full-stack E2E | browser + real backend + seeded DB/storage |

Do not collapse them into one “E2E” number.

## 2. Potentially unreliable existing tests

| Test | Issue | Risk |
|---|---|---|
| `recommendations-prefetch.spec.ts` | Relies on synthetic WAV playback ending quickly; timing-sensitive | Medium |
| `processing-resume.spec.ts` | Uses `waitForTimeout(1000)` instead of waiting on observable state | Medium |
| `processing-resume.spec.ts` (3rd test) | Checks exact `60%` text | Low |
| `auth.spec.ts` redirect tests | Could hide auth-state leakage if local storage persists unexpectedly | Low |
| `mobile-nav.spec.ts` | Only exercises one mocked favorites scenario | Low |

## 3. Missing browser test infrastructure

| Item | Status |
|---|---|
| Mobile project in Playwright config | ❌ only desktop Chromium configured |
| Cross-browser coverage | ❌ no WebKit / Firefox |
| Real backend Playwright project | ❌ none |
| Seeded test data strategy | ❌ none documented |
| Reusable authenticated fixture with role/subscription variants | ❌ only one happy-path fixture |
| Accessibility checks | ❌ none |
| Visual regression checks | ❌ none |
| Offline / degraded network testing | ❌ none |
| Notification permission mocking strategy | ❌ none |
| Media/microphone mocking strategy | ❌ none |

---

## Additions Needed to the Plan

## A. Add a Phase 0 — Test Infrastructure

Before adding dozens of tests, build the test bed.

### Must-have infra work
- [ ] Create separate Playwright projects for:
  - desktop chromium
  - mobile chrome
  - webkit/mobile safari equivalent
- [ ] Add a **full-stack Playwright mode** that talks to the real backend
- [ ] Create seeded test fixtures for:
  - authenticated standard user
  - authenticated admin user
  - trial user
  - unsubscribed user
  - user with active subscription
- [ ] Seed deterministic songs for:
  - complete song with stems/chords/lyrics/tabs
  - song with active processing job
  - song with failed processing job
  - song with missing lyrics/tabs but completed stems/chords
- [ ] Add helpers for notification permission, audio playback, microphone input, and browser visibility changes
- [ ] Replace `waitForTimeout()` with observable assertions wherever possible

Without this phase, the rest of the plan will grow brittle.

## B. Add a coverage matrix by environment

The original plan grouped everything together. It should explicitly separate:

| Area | UI-contract | Full-stack E2E | Backend integration |
|---|---|---|---|
| Auth | yes | yes | yes |
| Search | yes | yes | yes |
| Player rendering | yes | yes | partial |
| Subscription/paywall | yes | yes | yes |
| Tuner | yes | limited | no |
| Analytics admin UI | yes | yes | yes |

## C. Add reliability standards

Every new Playwright test should aim for:
- no arbitrary sleeps
- stable selectors (`data-testid` preferred)
- deterministic network / seed state
- independence from external network services unless explicitly marked
- one assertion about the visible outcome, not internal implementation details only

---

## Revised Prioritized Test Plan

## Phase 0 — Infrastructure (required first)

| # | Task | Type | Priority |
|---|---|---|---|
| 0.1 | Add mobile + WebKit Playwright projects | Infra | P0 |
| 0.2 | Create seeded full-stack backend test mode | Infra | P0 |
| 0.3 | Add auth fixtures for user/admin/trial/unsubscribed | Infra | P0 |
| 0.4 | Add seeded song/job states | Infra | P0 |
| 0.5 | Add media/notification/microphone helpers | Infra | P0 |

## Phase 1 — True full-stack critical path

These should hit the **real backend** with seeded data.

| # | Test Name | Feature | Priority |
|---|---|---|---|
| 1 | Login submit → library redirect | Auth | P0 |
| 2 | Register → confirm email → login | Auth | P0 |
| 3 | Search real song → open existing local song | Search/Player | P0 |
| 4 | Search remote song → select/download path → song detail | Search/Player | P0 |
| 5 | Library loads seeded songs and opens detail | Library | P0 |
| 6 | Add favorite on song detail → appears in favorites | Favorites | P0 |
| 7 | Player play/pause/seek on completed seeded song | Player | P0 |
| 8 | Stem selection + volume changes on seeded song | Player | P0 |
| 9 | Processing job resume / progress / completion flow | Player/Jobs | P0 |
| 10 | Unsubscribed user hits guarded page and sees paywall | Subscription | P0 |

## Phase 2 — Deterministic UI-contract coverage

These can stay mocked if that keeps them stable.

| # | Test Name | Feature | Priority |
|---|---|---|---|
| 11 | Register mismatch + backend error states | Auth | P1 |
| 12 | Confirm email resend code flow | Auth | P1 |
| 13 | Login unconfirmed-user flow | Auth | P1 |
| 14 | Song detail blocking error + retry | Player | P1 |
| 15 | Process button failed state + retry | Player | P1 |
| 16 | Chord version selector | Player | P1 |
| 17 | Lyrics source selector | Player | P1 |
| 18 | Sheet mode switch chords ↔ tabs | Player | P1 |
| 19 | Fullscreen player mode on mobile | Player | P1 |
| 20 | Chord edit + save UX | Player | P1 |
| 21 | Background processing card for lyrics/tabs | Player | P1 |
| 22 | Search empty results + download failure | Search | P1 |
| 23 | Subscription success page polling + redirect | Subscription | P1 |
| 24 | Subscription cancel flow in profile | Subscription/Profile | P1 |
| 25 | Tuner permission denied + start/stop | Tuner | P1 |
| 26 | Analytics admin dashboard happy path + guard | Analytics | P1 |

## Phase 3 — Layout, notifications, and polish

| # | Test Name | Feature | Priority |
|---|---|---|---|
| 27 | Desktop sidebar navigation and legal links | Layout | P2 |
| 28 | Mobile bottom nav including tuner/admin variants | Layout | P2 |
| 29 | JobWatcher completion toast | Global | P2 |
| 30 | JobWatcher failure toast | Global | P2 |
| 31 | Browser notification when tab hidden | Global | P2 |
| 32 | Root + wildcard redirects | Router | P2 |
| 33 | Profile rendering + recording settings | Profile | P2 |
| 34 | Analytics loading/error states | Analytics | P2 |
| 35 | A11y smoke checks for major routes | Global | P2 |
| 36 | Visual smoke snapshots for major routes | Global | P2 |

---

## Playwright Config Recommendations

```ts
projects: [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  { name: 'webkit-mobile', use: { ...devices['iPhone 14'] } },
]
```

Also add a way to run:
- `contract` browser tests with mocked APIs
- `full-stack` browser tests against seeded backend

---

## Revised Summary

### Browser coverage today

| Category | Current status |
|---|---|
| UI-contract browser coverage | **Low-to-moderate** |
| True full-stack E2E coverage | **Low** |
| Mobile-specific browser coverage | **Low** |
| Player feature coverage | **Low** |
| Subscription/paywall coverage | **Near zero** |
| Tuner coverage | **Zero** |
| Analytics UI coverage | **Zero** |

### Practical interpretation

If we are strict about “full E2E”, the app is **much less covered than the original plan implied**.
A better estimate is:
- **UI-contract browser coverage:** ~20–25% of major visible flows
- **True full-stack E2E coverage:** likely **under 10%**

### Recommended outcome

To realistically claim strong application E2E coverage, the repo should first complete:
- **Phase 0 infra**, then
- **Phase 1 full-stack critical path**, then
- use **Phase 2 mocked browser tests** to fill the hard edge cases.

That will produce a test suite that is both:
- **credible** for end-to-end confidence
- and **stable** enough to keep in CI
