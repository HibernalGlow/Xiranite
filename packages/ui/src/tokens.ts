/**
 * `@xiranite/ui` — the design-token half of the two-layer public contract in
 * `docs/plugin-architecture.md` §12. A third-party plugin may import this package (and
 * `@xiranite/plugin-sdk`); it may **not** import `@/components/ui`, which is internal and would turn
 * every refactor there into a breaking change for code we do not own.
 *
 * **Names, not values, on purpose.** The values live in the host's theme layer
 * (`src/styles/themes/*.css`, ~1600 custom-property declarations across 17 palettes plus the axis and
 * custom-theme files). If this package restated a color as a hex literal, it would be a second source
 * of truth — the exact failure this repository already documents for the module table and the contract
 * version — and it would be wrong the moment the user picked another theme. So the plugin gets
 * `var(--name)` references and the theme resolves them at runtime.
 *
 * What is a *legitimate* name is measured, not asserted: {@link PLUGIN_COLOR_TOKENS} is the subset that
 * every palette theme actually declares, and `src/tokens.test.ts` recomputes that intersection from the
 * CSS on every run. That is what caught `--radius` — `endfield.css` does not define it, so a plugin
 * asked for it would silently get nothing in that one theme, which no amount of reading the design doc
 * would have shown.
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
 * The test asserts each of these is genuinely absent from at least one palette theme, so this list
 * cannot rot into a lie when a theme adds them later.
 */
export const PLUGIN_TOKENS_EXCLUDED_BY_MEASUREMENT = [
  "radius",
  "scrollbar-thumb",
  "shadow",
  "surface-1",
] as const
