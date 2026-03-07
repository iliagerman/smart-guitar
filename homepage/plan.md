# Smart Guitar - Fire-Themed Landing Page

## Context

The project has an empty `homepage/` folder at the root and dedicated infrastructure (S3 bucket + CloudFront distribution) for a landing/marketing page at `smart-guitar.com`. The React SPA lives separately at `app.smart-guitar.com`. This plan creates a visually striking, fire-themed landing page with premium animations that showcases what Smart Guitar does and drives users to sign up.

## Tech Stack

**Vanilla HTML + CSS + minimal JS** — no build tools, no frameworks.

Rationale: The CloudFront config expects a plain `index.html`. A landing page should be a fast-loading static document. CSS keyframes, Intersection Observer, and a small `<canvas>` particle system handle all the animations. Total JS < 8KB. Deployment = copy files to S3.

## File Structure

```
homepage/
├── index.html                # Single-page landing
├── plan.md                   # Implementation plan
├── css/
│   ├── variables.css         # Fire theme tokens (mirrored from frontend/src/index.css)
│   ├── base.css              # Reset, typography, global styles
│   ├── layout.css            # Section layouts, grid, responsive breakpoints
│   ├── components.css        # Buttons, cards, nav, badges
│   └── animations.css        # All @keyframes, scroll-reveal, glow, reduced-motion
├── js/
│   ├── particles.js          # Canvas ember/spark particle system
│   ├── scroll-reveal.js      # Intersection Observer scroll animations
│   └── nav.js                # Sticky nav transition + mobile menu
└── assets/
    ├── logo.png              # Copied from frontend/public/logo.png
    └── hero-bg.jpg           # Copied from frontend/public/hero-bg.jpg
```

## Page Sections

### 1. Navigation (sticky)
- Transparent initially, transitions to `charcoal-900/90 + backdrop-blur` on scroll
- Left: Logo (48px) + "SMART GUITAR" fire gradient text (Bebas Neue)
- Right: "Features" | "How It Works" anchor links + **Login** (ghost btn) + **Sign Up** (solid fire btn)
- Mobile: hamburger menu overlay
- Links: Login → `https://app.smart-guitar.com/login`, Sign Up → `https://app.smart-guitar.com/register`

### 2. Hero (full viewport)
- **Background layers**: hero-bg.jpg → dark overlay gradient → radial ember glow → canvas particle layer
- **Logo**: 120–200px, animated `fire-pulse` glow, fade-in with scale on load
- **Headline**: `"MASTER ANY SONG"` — Bebas Neue, fire gradient text, letters stagger in one by one
- **Subheadline**: "AI-powered stem separation. Isolate vocals, guitar, bass, drums, and piano. Extract chords. Practice smarter."
- **CTA**: "Get Started Free" (solid fire) + "Sign In" (ghost)
- **Scroll indicator**: bouncing chevron at bottom

### 3. Features — "HEAR EVERY LAYER"
- 3-column grid (1-col on mobile), scroll-reveal stagger
- **AI Stem Separation**: waveform icon, stem badge pills (Vocals, Guitar, Bass, Drums, Piano)
- **Chord Extraction**: music note icon, animated horizontal chord ticker (Am, F, C, G)
- **Smart Library**: collection icon, mini search bar mockup
- Cards: `charcoal-800` bg, hover → fire border glow + lift

### 4. How It Works — "THREE STEPS TO MASTERY"
- Vertical timeline with numbered fire-circle badges connected by gradient line
- **1. Search** — "Find your song" + magnifying glass icon
- **2. Process** — "AI does the magic" + splitting waveform animation
- **3. Practice** — "Play your way" + play button with fire-pulse
- Timeline line fills on scroll (clip-path animation)

### 5. Showcase — "SEE IT IN ACTION"
- CSS-drawn device mockup frame containing a static recreation of the app's player UI (waveform, stem selector chips, chord badges)
- Frame has fire-pulse glow border + sweeping shine effect

### 6. Tagline
- `"STOP WATCHING TUTORIALS. START PLAYING."` — fire gradient shimmer text
- Subtle diagonal highlight sweeps across every 4s

### 7. Final CTA
- `"READY TO IGNITE YOUR PRACTICE?"` + "Free to use. No credit card required."
- Large "Start Playing Now" button with permanent fire-pulse glow

### 8. Footer
- Logo + copyright + nav links + "Built with fire"

## Key Animations & Effects

| Effect | Tech | Where |
|--------|------|-------|
| Ember particle system | Canvas 2D + requestAnimationFrame | Hero background |
| Letter stagger reveal | CSS animation-delay per `<span>` | Hero headline |
| Fire-pulse glow | CSS keyframe (box-shadow breathing) | Logo, CTA buttons |
| Gradient text | `background-clip: text` + fire gradient | All headings |
| Text shimmer | Animated `background-position` on gradient | Tagline section |
| Scroll reveal | IntersectionObserver + CSS transitions | All sections |
| Timeline fill | CSS clip-path animated on scroll | How-it-works line |
| Card hover glow | CSS transition (border-color + box-shadow) | Feature cards |
| Bounce | CSS translateY keyframe | Scroll indicator |
| Chord ticker | CSS translateX infinite animation | Feature card |

## Design Tokens (mirrored from existing theme)

Colors: `fire-*` (orange), `ember-*` (red), `flame-*` (yellow), `charcoal-*` (dark bg), `smoke-*` (text)
Fonts: Bebas Neue (display), Inter (body), JetBrains Mono (code/chords)
— All sourced from `frontend/src/index.css`

## Responsive Strategy

- Mobile-first CSS, breakpoints at 640px / 1024px / 1280px
- Particles: 30 mobile → 60 desktop
- Hero headline: 2.5rem → 6rem
- Feature grid: 1 col → 3 col
- CTA buttons: full-width stacked → inline
- Nav: hamburger → full links

## Accessibility

- `prefers-reduced-motion`: all animations disabled, canvas hidden
- Semantic HTML: `<header>`, `<main>`, `<section aria-labelledby>`, `<footer>`, single `<h1>`
- Skip-to-content link
- Focus rings on all interactive elements (`outline: 2px solid fire-500`)
- Decorative elements get `aria-hidden="true"`
- Mobile menu: `aria-expanded` + `aria-controls`

## Implementation Order

1. Create file structure + copy assets (logo.png, hero-bg.jpg)
2. `variables.css` + `base.css` — theme tokens, fonts, reset
3. Hero section — background layers, logo, headline letter stagger, CTAs
4. `particles.js` — ember canvas particle system
5. Features section — grid, cards, stem badges, chord ticker
6. How It Works section — timeline, steps, line-fill animation
7. Showcase section — device mockup with app UI recreation
8. `scroll-reveal.js` — IntersectionObserver for all sections
9. `nav.js` — sticky nav transition + mobile hamburger
10. Tagline + Final CTA + Footer — shimmer text, glow button
11. `animations.css` — all keyframes + reduced-motion overrides
12. Responsive polish — test all breakpoints, particle counts
13. Performance — optimize images, verify Lighthouse scores

## Verification

1. Open `homepage/index.html` in browser via local server (`python3 -m http.server 8080`)
2. Verify all sections render correctly at mobile (375px), tablet (768px), desktop (1440px)
3. Verify ember particles animate in the hero
4. Verify scroll-reveal triggers on each section
5. Verify nav transitions from transparent to solid on scroll
6. Verify Login/Sign Up buttons link to correct app URLs
7. Test with `prefers-reduced-motion: reduce` — all animations should be disabled
8. Lighthouse audit: target 90+ on Performance, 100 on Accessibility
