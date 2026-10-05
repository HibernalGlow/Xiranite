/**
 * `@xiranite/ui` — the design-token half of the two-layer public contract in
 * `docs/plugin-architecture.md` §12. A third-party plugin may import this package (and
 * `@xiranite/plugin-sdk`); it may **not** import `@/components/ui`, which is internal and would turn
 * every refactor there into a breaking change for code we do not own.
 *
 * **Names, not values, on purpose.** The values live in the host's theme layer
 * (`src/styles/themes/*.css`). If this package restated a color as a hex literal, it would be a second
 * source of truth — the exact failure this repository already documents for the module table and the
 * contract version — and it would be wrong the moment the user picked another theme. So the plugin gets
 * `var(--name)` references and the theme resolves them at runtime.
 *
 * What is a *legitimate* name is measured, not asserted: {@link PLUGIN_COLOR_TOKENS} is the subset that
 * the palette layer declares, and `src/tokens.test.ts` recomputes that set from the CSS on every run.
 * That is what originally caught `--radius` — `endfield.css` did not define it, so a plugin asking for
 * it got a value from a different layer than the palette in use, which no amount of reading the design
 * doc would have shown.
 *
 * **The sample changed on 2026-10-05**: the 16 built-in colour presets were deleted in favour of the
 * advanced-theme axis, so the palette layer is one file (`wuling.css`) plus whatever the user imports
 * as a custom theme. `tokens.test.ts` therefore pins the *other* half of the guarantee — the preset
 * names in `src/lib/appearance.ts` must match the `.theme-*` files on disk — because "declared by every
 * palette" would no longer be a real intersection.
 */

/**
 * Semantic color tokens every palette theme defines. Order is alphabetical because the list is
 * compared against a computed set, not presented to a user.
 */
export const PLUGIN_COLOR_TOKENS = [
  "accent",
  "accent-foreground",
  "background",
  "border",
  "card",
  "card-foreground",
  "destructive",
  "foreground",
  "input",
  "muted",
  "muted-foreground",
  "popover",
  "primary",
  "primary-foreground",
  "ring",
] as const

export type PluginColorToken = (typeof PLUGIN_COLOR_TOKENS)[number]

/** The custom-property name a plugin should reference for one semantic token. */
export function pluginColorVar(token: PluginColorToken): `--${string}` {
  return `--${token}`
}

/**
 * A `var(…)` string for one semantic token, e.g. `var(--card)`.
 *
 * Returns a plain string rather than a style object so it composes with whatever the plugin already
 * uses (inline style, CSS-in-JS, a stylesheet value) without this package owning a rendering model.
 */
export function pluginColor(token: PluginColorToken): string {
  return `var(${pluginColorVar(token)})`
}

/**
 * Names a plugin is **not** allowed to rely on, with the reason recorded rather than rediscovered.
 * This group is the palette layer itself saying nothing: no `.theme-*` file declares them, so a value
 * seen under them comes from a different layer (`--scrollbar-thumb` lives in `src/index.css` under
 * `:root` and `[data-scrollbar-style=…]`, `--surface-1` was in the preset files retired 2026-10-05 and
 * now has no declaration at all). `tokens.test.ts` re-derives this from the CSS on every run, so the
 * list cannot rot into a lie if a palette later declares one of them.
 */
export const PLUGIN_TOKENS_EXCLUDED_BY_MEASUREMENT = [
  "scrollbar-thumb",
  "surface-1",
] as const

/**
 * Names that **do** resolve but are outside a *colour* contract, because another axis owns them.
 *
 * `--radius` and `--shadow` are declared by the palette, so the measurement above would let them in —
 * and that is exactly why they are listed separately rather than deleted. The advanced-theme axis has
 * a `shape` and an `elevation` dimension, and a recipe resolves corners and shadows on its own
 * (`--stijl-radius` / `--md3-shape-*`; `stijl-components.css` deliberately does **not** override
 * `--radius`). A plugin that reads the palette value therefore gets a number that can disagree with
 * what the UI actually draws. The measured failure mode is not blankness but **silence about which
 * axis answered**: `radius` was already caught once for exactly that reason, when `endfield.css` left
 * it undeclared and the plugin fell through to a base-layer `0.375rem` while `.theme-vite` declared
 * `0.75rem`.
 */
export const PLUGIN_TOKENS_OWNED_BY_ANOTHER_AXIS = [
  "radius",
  "shadow",
] as const
