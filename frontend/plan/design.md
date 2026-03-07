# Fire-Themed Design System

## Color Palette

### Tailwind v4 Custom Tokens (in `src/index.css` `@theme` block)

```
Fire Scale       (primary actions, buttons, focus)
  fire-50:  #fff7ed    fire-500: #f97316    fire-900: #7c2d12
  fire-100: #ffedd5    fire-600: #ea580c    fire-950: #431407
  fire-200: #fed7aa    fire-700: #c2410c
  fire-300: #fdba74    fire-800: #9a3412
  fire-400: #fb923c

Ember Scale      (accent, destructive, favorites heart)
  ember-50:  #fef2f2   ember-500: #ef4444   ember-900: #7f1d1d
  ember-100: #fee2e2   ember-600: #dc2626   ember-950: #450a0a
  ember-400: #f87171   ember-700: #b91c1c

Flame Scale      (highlights, chord labels, inner glow)
  flame-300: #fde047   flame-500: #eab308   flame-800: #854d0e
  flame-400: #facc15   flame-600: #ca8a04   flame-900: #713f12

Charcoal Scale   (backgrounds)
  charcoal-700: #282828   (inputs, secondary surfaces)
  charcoal-800: #1a1a1a   (cards, elevated surfaces)
  charcoal-900: #121212   (primary background)
  charcoal-950: #0a0a0a   (deepest background)

Smoke Scale      (text)
  smoke-100: #f5f5f4   (primary text)
  smoke-300: #d6d3d1   (secondary text)
  smoke-400: #a8a29e   (muted text)
  smoke-500: #78716c   (disabled text)
  smoke-600: #57534e   (placeholder text - use sparingly, contrast issues)
```

### Gradients

- **Fire gradient**: `linear-gradient(180deg, #facc15, #f97316, #ea580c, #dc2626)`
- **Text gradient**: `background-clip: text` with fire gradient
- **Fire glow shadow**: `0 0 20px rgba(249, 115, 22, 0.3)`
- **Ember background**: `radial-gradient(ellipse, rgba(249,115,22,0.15), transparent 70%)`

### WCAG Contrast (all pass AA)

| Combo | Ratio |
|-------|-------|
| smoke-100 on charcoal-900 | 17.7:1 |
| fire-500 on charcoal-900 | 7.1:1 |
| flame-400 on charcoal-900 | 11.7:1 |
| ember-500 on charcoal-900 | 5.1:1 |
| charcoal-950 on fire-500 | 5.5:1 |

---

## Typography

- **Display/Hero**: `Bebas Neue` (tracking-wide, fire gradient)
- **Headings**: `Inter` 700-900
- **Body**: `Inter` 400-500
- **Mono** (chords, timestamps): `JetBrains Mono`, `tabular-nums`

---

## shadcn/ui CSS Variable Mapping

```css
:root {
  color-scheme: dark;
  --background: #0a0a0a;        /* charcoal-950 */
  --foreground: #f5f5f4;        /* smoke-100 */
  --card: #1a1a1a;              /* charcoal-800 */
  --primary: #f97316;           /* fire-500 */
  --primary-foreground: #0a0a0a;
  --accent: #ef4444;            /* ember-500 */
  --muted: #282828;             /* charcoal-700 */
  --muted-foreground: #78716c;  /* smoke-500 */
  --border: #383838;            /* charcoal-600 */
  --ring: #f97316;              /* fire-500 */
}
```

---

## Component Styling

### Song Card
- `bg-charcoal-800 border-charcoal-600 rounded-lg`
- Thumbnail (rounded-md) + title (smoke-100) + artist (smoke-400) + duration badge (fire-500/20)
- Hover: `border-fire-500/40 shadow-fire-sm`
- Favorite heart: smoke-600 (off) → ember-500 (on)

### Player Bar (bottom sticky)
- `bg-charcoal-800 border-t border-charcoal-600`, 64px mobile / 80px desktop
- Thumbnail (40x40) + title + play/pause (circular, bg-fire-500) + progress (fire-500 on charcoal-700)
- Playing state: `fire-pulse` glow animation

### Track Selector
- Horizontal scrollable list of track chips
- Inactive: `bg-charcoal-700 text-smoke-400 border-charcoal-500`
- Active: `bg-fire-500/20 text-fire-400 border-fire-500/40 shadow-fire-sm`
- Each chip: stem icon + label

### Waveform
- `bg-charcoal-900 rounded-lg`
- Played: fire-500 → flame-400 gradient
- Unplayed: charcoal-600
- Cursor: flame-400 2px with glow

### Chord Timeline
- Horizontal scroll of chord badges
- Active chord: `bg-fire-500/20 text-fire-400 border-fire-500/40 scale-110`
- Inactive: `bg-charcoal-700 text-smoke-400`
- Font: JetBrains Mono, text-xs

### Bottom Nav (mobile)
- `bg-charcoal-900 border-t border-charcoal-700`
- Active: `text-fire-500` + dot indicator
- Inactive: `text-smoke-600`
- Safe area padding: `env(safe-area-inset-bottom)`

### Auth Forms
- Full-screen charcoal-950 + hero background image
- Card: `bg-charcoal-800/80 backdrop-blur-lg border-charcoal-600 max-w-sm`
- Inputs: `bg-charcoal-700 focus:ring-fire-500`
- Submit: `bg-fire-500 hover:bg-fire-600 text-charcoal-950 font-bold w-full`

---

## Animations (all respect `prefers-reduced-motion`)

| Animation | Where | CSS |
|-----------|-------|-----|
| Fire pulse | Playing indicator | Breathing glow on play button |
| Button glow | Primary buttons hover | `box-shadow` transition to fire-glow |
| Favorite ignite | Heart toggle | Scale 1→1.3→1 with brightness burst |
| Track switch | TrackSelector | Smooth background/border color transition |
| Page enter | Route transitions | `opacity 0→1, translateY 8→0` over 0.3s |
| Waveform heat | Playback progress | Gradient shift from fire to flame tones |

---

## Art Assets (Nano Banana Pro)

| Asset | Size | Description |
|-------|------|-------------|
| App logo | 512x512 | Flaming electric guitar silhouette |
| App icon | 192+512 | Guitar pick in fire |
| Hero background | 1920x1080 | Dark smoky concert stage with embers |
| Empty: no results | 400x300 | Lonely guitar, dim embers |
| Empty: no favorites | 400x300 | Unlit campfire with guitar |
| Empty: no songs | 400x300 | Match being struck |
| Empty: processing | 400x300 | Guitar forged in fire |
| Loading spinner | 128x128 | Spinning flame ring |
| Onboarding slides x4 | 750x500 | Search/play/mix/chords illustrations |
| Stem icons x6 | 64x64 | Mic/drums/bass/guitar/keys/wave in fire style |
| Error state | 400x300 | Broken guitar in ashes |

See `demos/` folder for generated sample images.
