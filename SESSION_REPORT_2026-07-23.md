# Session Report — Aura Enables Landing Page

**Date:** 2026-07-23
**Project:** `/mnt/bigdata/aura/projects/enables`
**File:** `index.html` (1003 lines)

---

## 1. Brand Colors — Extracted from `enables-logo.svg`

Fetched the official logo from `DusanCar-sudo/enables` at commit `6852b7d` and extracted every color:

| Role | Hex | Source in SVG |
|------|-----|---------------|
| Coral (primary accent) | `#ff6a5b` | Left chevron + left pill bar |
| Cyan (secondary accent) | `#4fe3ee` | Right chevron + right pill bar |
| Navy (dark bg) | `#07121c` | Outer rounded rect |
| Navy-mid (surface-2) | `#101b2a` | Middle rounded rect |
| Navy-panel (surface-3) | `#142235` | Inner rounded rect |
| Snow (text) | `#f4fbff` | "ENABLES" wordmark |
| Border dark | `#2d4058` / `#1e3147` | Stroke rings |

All colors defined as CSS custom properties (`--accent`, `--surface`, `--text`, etc.) for theming.

---

## 2. Light / Dark Theme Toggle

- All semantic colors live in `:root` CSS custom properties.
- `[data-theme="light"]` block overrides every variable with a light palette (coral → `#d9442e`, cyan → `#1a9eaa`, bg → `#f0f4f8`, text → `#07121c`).
- Toggle button in the nav (sun/moon SVG icons, switches on click).
- Preference persisted to `localStorage` and restored on page reload.
- `0.4s` CSS `transition` on `background` and `color` for smooth switching.

---

## 3. VFX Text Cursor Theme (from `nexu-io/open-design`)

Fetched and applied the visual language from `plugins/_official/video-templates/vfx-text-cursor`:

- **Chromatic aberration** — `text-shadow: 3px 0 var(--accent-2), -3px 0 var(--accent)` on the headline (cyan left / coral right offset).
- **Cursor light trail** — 20px block cursor with `box-shadow: 0 0 28px var(--accent), 60px 0 90px var(--accent-glow)` — long bloom tail.
- **4 directional light rays** — `ray-1` through `ray-4`, each with `mix-blend-mode: screen`, gradient fades, and blur at different angles.
- **Film grain** — SVG `feTurbulence` noise texture at 5.5% opacity with `mix-blend-mode: overlay`.
- **Vignette** — `radial-gradient(circle at center, transparent 45%, rgba(0,0,0,0.82) 100%)`.
- **Chip header/footer** — `FRAME 01`-style mono labels (top-left / bottom-right) at `opacity: 0.4` / `0.3`.

---

## 4. Word-Cycling Headline (HyperFrames-style)

Replaced the static hero headline with a JavaScript word-cycling engine:

- **6 rotating phrases** split across two lines:
  1. `Works on all providers.`
  2. `Claude Code runs with no stop.`
  3. `One proxy. Nine providers.`
  4. `Zero config hell.`
  5. `Route any model. Any provider.`
  6. `Build faster. Deploy anywhere.`

- **Animation cycle per phrase:**
  - Type in — words appear one at a time, 90ms apart, split across line 1 and line 2.
  - Hold — full phrase stays visible for 2.2 seconds.
  - Delete — words vanish one at a time, 45ms apart (faster than typing).
  - Gap — 400ms pause, then next phrase starts.
- Starts 1.2s after page load (after hero fade-in completes).
- Chromatic aberration glow and cursor light trail remain active throughout.

---

## 5. Neural Network Canvas Background

Full-viewport `<canvas>` with a continuously running neural-network visualization:

- **5 layers** of neurons — `[4 → 6 → 8 → 6 → 4]` — spanning full viewport width, vertically centered.
- **Input/output nodes** are 5px; hidden-layer nodes are 3.5px.
- **Synapses** only connect adjacent layers (feed-forward), with breathing opacity.
- **Signal pulses** — small bright dots travel along every edge left→right, staggered by each neuron's phase.
- **Neuron glow** — three concentric rings per node: outer halo → main body → bright core, all pulsing independently.
- Uses brand coral `#ff6a5b` for all canvas drawing.
- Resizes on window change.

---

## 6. Official Logo Embedded

Replaced the placeholder geometric SVG with the real `enables-logo.svg` from the enables repo:

- **Nav** — 28×28px at full 1024×1024 resolution.
- **Footer** — 20×20px.
- Both show the coral chevron, cyan chevron, pill bar, concentric ring border, and "ENABLES" wordmark exactly as in the source SVG.

---

## 7. Full Page Structure

| Section | Description |
|---------|-------------|
| **Nav** | Fixed top bar, logo, links, theme toggle, CTA button |
| **Hero** | Canvas bg + VFX overlays + chip header + cycling headline + CTAs + stats + chip footer |
| **Features** | 3-column grid: API & Proxy Routing, 3D Web Environments, Networked Logic — each with code block or SVG visualization |
| **Architecture** | 3-step flow (Configure → Route → Build) with terminal mockup |
| **Final CTA** | Deploy Now + Read the Docs + copy-to-clipboard install command |
| **Footer** | Logo, GitHub link, MIT License, attribution |

---

## 8. Technical Details

- **Single file** — `index.html`, zero external JS dependencies (Tailwind via CDN, Google Fonts).
- **CSS custom properties** — all theming through `--accent`, `--surface`, `--text`, etc.
- **HTML validated** — Python `HTMLParser` check confirms zero mismatched/unclosed tags.
- **44 brand/theme tokens** confirmed present via grep (`ff6a5b`, `4fe3ee`, `07121c`, `data-theme`, `theme-btn`, `localStorage`, `hero-line`, `chroma`, `cursor`, `vignette`, `grain`, `ray-`).
