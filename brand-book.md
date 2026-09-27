# Smart Guitar Brand Book

---

## 1. Brand Overview

**Brand Name:** Smart Guitar
**Tagline:** "Your smart guitar companion"
**Domain:** smart-guitar.com
**App:** app.smart-guitar.com

**Brand Essence:**
Smart Guitar is an AI-powered music practice tool that transforms any song into an interactive learning experience. It separates audio into individual instrument stems, detects chords in real time, syncs lyrics, and generates guitar tabs -- letting musicians play along as if they're in the band.

**Brand Personality:**
- **Bold** -- unapologetic, direct, confident messaging
- **Fiery** -- passionate, energetic, alive
- **Empowering** -- removes barriers to playing music
- **Modern** -- cutting-edge AI technology, sleek dark interfaces
- **Accessible** -- free to try, no credit card required

**Voice & Tone:**
- Short, punchy, imperative sentences
- Action-oriented: "Start Playing Free", "Stop Watching Tutorials. Start Playing."
- Second person ("You decide", "Play your way")
- No jargon -- speaks to musicians, not engineers

---

## 2. Logo

### Primary Logo
A **black electric guitar engulfed in flames**, rendered in a dramatic, photorealistic illustration style. The guitar silhouette is dark/black, surrounded by vivid orange and yellow fire with floating sparks and ember particles against a pure black background.

**Two logo variants exist:**

| Variant | Description | Use Case |
|---------|-------------|----------|
| **Icon logo** (logo.png) | Electric guitar with realistic fire wrapping around it, more contained composition | App icon, favicon, PWA icon, in-app branding |
| **Homepage logo** (logo-clean.png) | Guitar silhouette fully consumed by a ring of fire, more dramatic and abstract | Hero sections, marketing materials, splash screens |

### Logo Usage Rules
- Always place on a **pure black** (#0a0a0a) or very dark background
- Never place on light backgrounds -- the fire effect requires darkness to read
- Minimum clear space: the logo's own width on all sides
- Do not add drop shadows, outlines, or additional effects
- Do not rotate, stretch, or crop the flames

### Favicon / App Icon
- 32x32 favicon and 192x192 / 512x512 PWA icons use the guitar-in-flames motif
- On mobile home screens, the icon reads as a glowing fire shape

---

## 3. Color Palette

The brand uses a **dark-mode-only** aesthetic. All colors are designed for dark backgrounds.

### Primary Colors

| Token | Hex | Role |
|-------|-----|------|
| **Fire 500** | `#f97316` | Primary brand orange -- CTAs, buttons, links, key accents |
| **Fire 400** | `#fb923c` | Lighter orange -- hover states, secondary accents |
| **Fire 600** | `#ea580c` | Deeper orange -- pressed states, active indicators |

### Secondary Colors (Gold/Yellow)

| Token | Hex | Role |
|-------|-----|------|
| **Flame 400** | `#facc15` | Golden yellow -- play button, sign-in button, interactive highlights |
| **Flame 300** | `#fde047` | Light gold -- hover states on golden elements |
| **Flame 500** | `#eab308` | Deep gold -- active states |

### Danger / Alert Colors

| Token | Hex | Role |
|-------|-----|------|
| **Ember 500** | `#ef4444` | Error states, destructive actions |
| **Ember 400** | `#f87171` | Warning highlights |

### Background Colors (Charcoal)

| Token | Hex | Role |
|-------|-----|------|
| **Charcoal 950** | `#0a0a0a` | Page background, deepest black |
| **Charcoal 900** | `#121212` | Card backgrounds, panels |
| **Charcoal 800** | `#1a1a1a` | Elevated surfaces, input fields |
| **Charcoal 700** | `#282828` | Borders, dividers, control backgrounds |
| **Charcoal 600** | `#383838` | Subtle borders, hover states on dark surfaces |

### Text Colors (Smoke)

| Token | Hex | Role |
|-------|-----|------|
| **Smoke 100** | `#f5f5f4` | Primary text (headings, body on dark bg) |
| **Smoke 300** | `#d6d3d1` | Secondary text |
| **Smoke 400** | `#a8a29e` | Muted text (captions, metadata, artist names) |
| **Smoke 500** | `#78716c` | Disabled text, placeholders |
| **Smoke 600** | `#57534e` | Very subtle text, decorative |

### Full Fire Scale (for gradients and extended use)

```
fire-50:  #fff7ed    fire-100: #ffedd5    fire-200: #fed7aa
fire-300: #fdba74    fire-400: #fb923c    fire-500: #f97316
fire-600: #ea580c    fire-700: #c2410c    fire-800: #9a3412
fire-900: #7c2d12    fire-950: #431407
```

### Color Ratios in Compositions
- **90% dark** (charcoal 950/900/800) -- backgrounds dominate
- **7% warm accents** (fire/flame) -- draw attention to key actions
- **3% text** (smoke) -- clean, readable, never competes with accents

---

## 4. Typography

### Font Families

| Font | Weight(s) | Role |
|------|-----------|------|
| **Bebas Neue** | 400 (regular) | Display headlines, section titles, hero text. Always uppercase. Bold, condensed, cinematic. |
| **Inter** | 400, 500, 600, 700, 800, 900 | Body text, UI labels, buttons, descriptions. Clean and highly legible. |
| **JetBrains Mono** | 400, 500, 600 | Chord labels, tab notation, technical/musical data. Monospace precision. |

### CSS Font Stack

```css
--font-sans:    "Inter", ui-sans-serif, system-ui, sans-serif;
--font-display: "Bebas Neue", cursive;
--font-mono:    "JetBrains Mono", ui-monospace, monospace;
```

### Typography Hierarchy

| Level | Font | Size | Weight | Example |
|-------|------|------|--------|---------|
| Hero Headline | Bebas Neue | 48-72px | 400 | "SEE THE CHORDS. FEEL THE RHYTHM." |
| Section Title | Bebas Neue | 32-40px | 400 | "HOW IT WORKS" |
| Card Title | Inter | 18-20px | 700 | "SEARCH FOR ANY SONG" |
| Body Text | Inter | 14-16px | 400 | Descriptions, paragraphs |
| Caption/Meta | Inter | 12-14px | 400 | Artist name, timestamps |
| Chord Label | JetBrains Mono | 14-16px | 500 | "Am", "F", "C", "G" |

### Typography Rules
- **Bebas Neue is always uppercase** -- it's a display font designed for caps
- **Inter handles all readable content** -- never use Bebas Neue for body text
- **JetBrains Mono for musical notation only** -- chords, tabs, technical data
- Line height: 1.5 for body, 1.1-1.2 for Bebas Neue headlines
- Letter spacing: normal for Inter, slight tracking for Bebas Neue at small sizes

---

## 5. Imagery & Photography

### Hero Imagery
- **Guitar on fire** is the central visual motif
- Dark, dramatic backgrounds with warm fire/spark effects
- Cinematic lighting -- the fire is the only light source
- Photos should feel like they belong in a concert or studio setting

### People Photography
- Real musicians (or realistic AI-generated) in natural practice/performance settings
- Warm, inviting environments (living rooms, home studios)
- Subjects are actively playing or enthusiastically talking about music
- Candid, authentic feel -- not stock-photo sterile
- Portrait-oriented framing for testimonial cards

### Image Treatment
- All images sit on dark backgrounds
- Use rounded corners (border-radius 12-16px) on photo containers
- Subtle vignette or dark overlay to blend edges into the dark UI
- Video play buttons use a solid orange (#f97316) circle with white play icon

### Do Not
- Use bright, high-key photography
- Show generic stock photos of hands on keyboards
- Use images with white or light backgrounds
- Add borders or frames around photos (rounded corners only)

---

## 6. UI Components & Patterns

### Buttons

| Type | Style | Use |
|------|-------|-----|
| **Primary CTA** | Solid fire-500 (#f97316) background, white text, rounded-lg | "Start Playing Free", "Sign Up Free" |
| **Secondary CTA** | Dark background with white/smoke border, white text | "Sign In", "Log In" |
| **Golden Action** | Solid flame-400 (#facc15) background, dark text | "Sign In" (auth), play button |
| **Ghost** | Transparent with smoke border, smoke text | Tertiary actions |

### Cards
- Background: charcoal-800 (#1a1a1a) to charcoal-900 (#121212)
- Border: charcoal-600 (#383838) or fire-600 (#ea580c) left accent
- Corner radius: 12-16px
- No drop shadows -- elevation is communicated through background lightness

### Input Fields
- Background: semi-transparent dark (charcoal-800 with opacity)
- Border: charcoal-600, focus: flame-400
- Placeholder text: smoke-500
- Rounded corners matching button radius

### Navigation
- Desktop: sidebar navigation on dark background
- Mobile: bottom tab bar with safe-area padding
- Active state: flame-400 accent color
- Nav background: charcoal-950

---

## 7. Iconography

- **Icon library:** Lucide React (consistent line-icon style)
- **Icon weight:** 1.5-2px stroke, matching Inter's clean aesthetic
- **Colors:** smoke-400 default, fire-500 or flame-400 for active/selected states
- **Stem icons:** Custom illustrated icons (vocals, guitar, drums, bass, piano) with warm tones matching the fire palette
- **Icon-only buttons:** Always include aria-label for accessibility

---

## 8. Animation & Motion

### Signature Animations

| Animation | Description | Use |
|-----------|-------------|-----|
| **Flame Pulse** | Gentle golden glow pulsing (box-shadow oscillation) | Active play button, highlighted elements |
| **Favorite Ignite** | Scale up to 1.3x with brightness boost, then return | Favoriting a song |
| **Slide Up** | Opacity 0 -> 1 with 1rem upward translation, 0.3s ease-out | Content entrance, list items appearing |

### Motion Principles
- Animate only `transform` and `opacity` for performance
- Duration: 200-300ms for UI transitions, 2s for ambient loops (flame pulse)
- Easing: ease-out for entrances, ease-in-out for loops
- Respect `prefers-reduced-motion` -- disable or simplify all animations

---

## 9. Messaging Framework

### Headlines (Bebas Neue, uppercase, punchy)
- "SEE THE CHORDS. FEEL THE RHYTHM."
- "FROM SOLO TO FULL BAND"
- "HOW IT WORKS"
- "REAL PLAYERS. REAL STORIES."
- "STOP WATCHING TUTORIALS. START PLAYING."

### Supporting Copy (Inter, sentence case, conversational)
- "AI splits any song into vocals, guitar, bass, drums, and piano."
- "See every chord. Follow the strumming pattern. Play like you're in the band."
- "Three steps. That's it."
- "Free to try. No credit card required."
- "Hear from musicians who transformed their practice with Smart Guitar."

### Key Value Propositions (for ads)
1. **Stem separation** -- "Solo the guitar to hear the riff. Mute vocals and sing along."
2. **Real-time chords** -- "See every chord as the song plays."
3. **Any song** -- "Search for any song. Our catalog covers millions."
4. **Speed** -- "In seconds, not minutes."
5. **Control** -- "Follow chords in real time. You decide."

### Call-to-Action Phrases
- "Start Playing Free"
- "Start Playing Now"
- "Sign Up Free"
- "Try It Free"

---

## 10. Brand Don'ts

- Never use light/white backgrounds for primary compositions
- Never set Bebas Neue in lowercase or mixed case
- Never use colors outside the defined palette (no blues, greens, purples)
- Never use thin or light font weights for headlines
- Never show the product without the dark theme
- Never use generic music stock photography
- Never add gradients that aren't in the fire/flame color family
- Never use rounded-full on rectangular content (reserve for avatar/icon circles)
- Never compete fire-500 and flame-400 in the same visual hierarchy -- one leads, one supports

---

## 11. Ad Creative Guidelines

### Format Recommendations
- **Dark canvas** (charcoal-950 #0a0a0a) as the base for all ad creatives
- **Hero image or guitar-on-fire motif** as the visual anchor
- **Bebas Neue headline** in smoke-100 or fire-500, centered or left-aligned
- **Inter body copy** in smoke-300, 2-3 lines max
- **Single CTA button** in fire-500 with white text

### Color Ratios for Ads
- Background: 70-80% charcoal
- Visual element (fire, guitar, musician): 15-20%
- Text and CTA: 5-10%
- The fire/orange should feel like a controlled burst of energy, not overwhelming

### Recommended Ad Layouts

**Layout A -- Hero Statement**
```
[Dark background with subtle fire texture]
[Bebas Neue headline in white/orange]
[1-line Inter subtext in smoke-300]
[Fire-500 CTA button]
[Logo mark in corner]
```

**Layout B -- Feature Showcase**
```
[Dark background]
[App screenshot or stem visualization mockup]
[Bebas Neue feature headline]
[Inter benefit description]
[CTA button]
```

**Layout C -- Testimonial**
```
[Dark background]
[Musician photo with rounded corners]
[Quote in Inter italic, smoke-100]
[Name + role in smoke-400]
[CTA button]
```

### Video Ad Guidelines
- Open with the guitar-on-fire logo animation (1-2 seconds)
- Dark backgrounds throughout
- Show the app in action: search -> stems separating -> chords appearing
- Close with Bebas Neue headline + CTA
- Background music: use a stem-separated track to demonstrate the product

---

*Smart Guitar Brand Book v1.0 -- April 2026*
