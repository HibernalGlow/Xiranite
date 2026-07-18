# Theme Packs

Concrete theme CSS lives here. `src/index.css` is reserved for Tailwind token
registration, base styles, and shared integration bridges.

## Add A Theme

1. Create `src/styles/themes/<theme>.css`.
2. Add it to `src/styles/themes/index.css`.
3. Add the root class to `THEME_ROOT_CLASSES` in `src/lib/appearance.ts`.
4. Add store-applicable defaults to `THEME_DESIGN_RECIPES`.
5. Add imitation/design metadata to `THEME_STYLE_PROFILES`.
6. Add labels and swatches in theme selection UI and i18n.
7. Scope node interior rules under `.xiranite-node-surface`.

## CSS Scope

Use `.theme-<name>` for all concrete token values. A theme may also define
`:root` only when it is the default fallback loaded before React applies the
workspace theme class.

Dark overrides should be scoped to the theme root, for example:

```css
:root.theme-spatial.dark {
  --background: oklch(...);
}
```

Shared dark tokens such as generic badge colors can use `:root.dark`, but
theme-specific surfaces should not. This prevents one theme from overriding
another through selector specificity.

## Website Reference Mapping

When imitating a reference site, translate it into these axes before writing CSS:

- palette and contrast model
- typography and line-height model
- density and spacing rhythm
- border/radius treatment
- surface and depth model
- motion style
- node interior treatment
- shell/chrome layout expectations

If the reference needs structural changes beyond CSS, add component/layout
variants separately instead of forcing the whole design into tokens.
