# Xiranite Spatial Morphing Workspace Design System

This document outlines the core design systems and themes implemented in the **Xiranite Spatial Morphing Workspace**. It consists of two distinct environmental aesthetics: **Wuling (Endfield Tactical Workspace)** and **Utopia (Atmospheric Urban Workspace)**.

---

## 1. Wuling - Endfield Tactical Workspace (Default)

### Brand & Style
This design system is a fusion of industrial efficiency and high-tech elegance, drawing direct inspiration from the Wuling City aesthetic in *Arknights: Endfield*. It is optimized for high-performance spatial computing in a light-flooded environment, where information density and aesthetic clarity coexist.

The brand personality is **Precise, Technical, and Atmospheric**. It targets "Operators"—power users who require a sophisticated, modular environment for complex workflows. The UI evokes the feeling of a clean, brightly lit laboratory or a sunlit high-altitude command deck: clinical, professional, and cutting-edge.

The design style leverages **Glassmorphism** and **Corporate Modernism**. It uses semi-transparent, light-refracting surfaces to maintain spatial awareness of the background while providing clear work zones. Subtle geometric patterns and technical micro-copy reinforce the "tech-wear" minimalist vibe within a high-visibility light mode interface.

### Colors
The palette is anchored in a crisp, light technical base to maximize legibility and energy. The core identity is driven by "Endfield Green"—a spectrum of jade and teal that signifies energy and data flow.

- **Primary (Endfield Light):** `#81C784` / `#286b33`. Used for primary interactive elements, active states, and key data visualizations.
- **Secondary (Industrial Forest):** `#2E7D32` / `#1b6d24`. Used for success states, secondary accents, and progress indicators that require more weight against the light background.
- **Tech Teal:** Reserved for specific data-readouts and "System" level notifications.
- **Status Glows:** High-luminance versions of the primary green are used for "Focused" states and active terminal connections.
- **Background:** High-transparency glass effect, `#f9f9fc`. Surfaces are bright and airy, reducing fatigue during daytime operation.

### Typography
- **Inter** is the workhorse for the UI, providing a neutral and highly legible sans-serif base.
- **JetBrains Mono** is utilized for "Technical Overlays"—data values, coordinates, status labels, and system IDs.

### Elevation & Depth
- **Docked State:** Elements are semi-opaque, appearing attached to screen edges with a 1px inner border.
- **Floating State:** Heavy background blur and a subtle soft shadow.
- **Focused State:** The active module gains a high-contrast border in Primary Green and a localized "Ambient Pulse" shadow.

---

## 2. Utopia - Atmospheric Urban Workspace

### Brand & Style
This design system moves away from tactical industrialism toward an **Atmospheric Urban** aesthetic. It blends the depth of traditional ink-wash textures with the precision of a modern creative workspace. The personality is sophisticated, contemplative, and warm—evoking the feeling of a quiet, dimly lit studio at midnight.

The visual style is characterized by:
- **Tonal Depth:** Replacing harsh outlines with subtle layering and soft ambient glows.
- **Organic Sophistication:** Introducing serif typography and softer radii to humanize the interface.
- **Intentional Contrast:** Using vibrant Cinnabar and Gilded Gold accents sparingly against a deep, dark-chocolate foundation.

### Colors
The palette is rooted in a deep "Ink-Black" brown (`#120F0E`) and "Dark Chocolate" (`#1A1614` / `#161311`). These rich, warm neutrals provide a more comfortable reading experience than pure black or cold slates.

- **Primary (Cinnabar Red):** `#ffb4a5` / `#E2583E`. Used for critical actions, status indicators, and high-priority branding elements. It should feel like a wax seal or traditional stamp.
- **Secondary (Gilded Gold):** `#f0bd8b` / `#D4A373`. Used for highlighting interactive states, focus rings, and subtle decorative accents.
- **Tertiary (Umber):** `#d2c4bb`. Used for container borders and low-contrast UI dividers.
- **Amber Secondary Text:** Secondary information uses a low-opacity Gilded Gold tint to maintain the warm, ink-on-paper feel.

### Typography
The typographic system utilizes a "Serif for Soul, Sans for System" approach.
- **Source Serif 4** provides an editorial, intellectual character for headings.
- **Inter** handles the functional UI elements.

### Elevation & Depth
Depth is established through **Tonal Layering** rather than traditional drop shadows.
1. **Base Layer:** The darkest tone, representing the desk or the paper.
2. **Container Layer:** A slightly lighter brown with a subtle 1px stroke of Umber.
3. **Elevated State:** Active or hovered cards use a soft, inner glow of Gilded Gold and a slight lightening of the background fill.
**Soft Ambient Light:** Instead of harsh drop shadows, use large-radius, low-opacity blurs of Cinnabar Red or Gilded Gold.