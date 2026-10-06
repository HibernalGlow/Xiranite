import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { render } from "vitest-browser-react"

import i18n from "@/i18n"
import { SettingsStageNav } from "@/components/views/settings/SettingsStageNav"

import "./md3-settings-nav.css"

/**
 * Token fixture for the MD3 设置侧栏 (navigation drawer) sheet.
 *
 * `md3-settings-nav.css` only *reads* `--md-*` custom properties; the engine normally
 * writes them onto `documentElement` (`src/lib/design-theme/apply.ts:101-117`). This
 * object stands in for the engine so the *mapping* is what is under test.
 *
 * Every value here was read out of `src/lib/design-theme/md3/tokens.generated.ts`
 * (`MD3_COMPONENT_TOKENS["navigation-drawer"] / ["list"]` + `MD3_SYS_TOKENS`), with
 * `ref:…` expanded exactly the way `mapper.ts` `expandRefs()` does it — weight refs
 * flatten to the dictionary numbers, faces stay `var()` chains. Colour roles are the
 * baseline light scheme (`md-sys-color.light` resolved through `md-ref-palette`).
 * Nothing was typed from memory; the `--md-sys-space-*` forms are `md3/space.ts`'s
 * own `calc(var(--md-sys-space-unit) * …)` shape.
 */
export const MD3_SETTINGS_NAV_FIXTURE: Record<string, string> = {
  "--md-comp-list-list-item-container-shape": "var(--md-sys-shape-corner-none)",
  "--md-comp-list-list-item-leading-space": "16px",
  "--md-comp-list-list-item-one-line-container-height": "56px",
  "--md-comp-list-list-item-overline-color": "var(--md-sys-color-on-surface-variant)",
  "--md-comp-list-list-item-overline-line-height": "var(--md-sys-typescale-label-small-line-height)",
  "--md-comp-list-list-item-overline-size": "var(--md-sys-typescale-label-small-size)",
  "--md-comp-list-list-item-overline-tracking": "var(--md-sys-typescale-label-small-tracking)",
  "--md-comp-list-list-item-overline-weight": "var(--md-sys-typescale-label-small-weight)",
  "--md-comp-list-list-item-trailing-space": "16px",
  "--md-comp-navigation-drawer-active-focus-state-layer-color": "var(--md-sys-color-on-secondary-container)",
  "--md-comp-navigation-drawer-active-hover-state-layer-color": "var(--md-sys-color-on-secondary-container)",
  "--md-comp-navigation-drawer-active-icon-color": "var(--md-sys-color-on-secondary-container)",
  "--md-comp-navigation-drawer-active-indicator-color": "var(--md-sys-color-secondary-container)",
  "--md-comp-navigation-drawer-active-indicator-height": "56px",
  "--md-comp-navigation-drawer-active-indicator-shape": "var(--md-sys-shape-corner-full)",
  "--md-comp-navigation-drawer-active-label-text-color": "var(--md-sys-color-on-secondary-container)",
  "--md-comp-navigation-drawer-active-label-text-weight": "var(--md-sys-typescale-label-large-weight-prominent)",
  "--md-comp-navigation-drawer-active-pressed-state-layer-color": "var(--md-sys-color-on-secondary-container)",
  "--md-comp-navigation-drawer-headline-color": "var(--md-sys-color-on-surface-variant)",
  "--md-comp-navigation-drawer-headline-line-height": "var(--md-sys-typescale-title-small-line-height)",
  "--md-comp-navigation-drawer-headline-size": "var(--md-sys-typescale-title-small-size)",
  "--md-comp-navigation-drawer-headline-tracking": "var(--md-sys-typescale-title-small-tracking)",
  "--md-comp-navigation-drawer-headline-weight": "var(--md-sys-typescale-title-small-weight)",
  "--md-comp-navigation-drawer-icon-size": "24px",
  "--md-comp-navigation-drawer-inactive-focus-state-layer-color": "var(--md-sys-color-on-surface)",
  "--md-comp-navigation-drawer-inactive-hover-icon-color": "var(--md-sys-color-on-surface)",
  "--md-comp-navigation-drawer-inactive-hover-label-text-color": "var(--md-sys-color-on-surface)",
  "--md-comp-navigation-drawer-inactive-hover-state-layer-color": "var(--md-sys-color-on-surface)",
  "--md-comp-navigation-drawer-inactive-icon-color": "var(--md-sys-color-on-surface-variant)",
  "--md-comp-navigation-drawer-inactive-label-text-color": "var(--md-sys-color-on-surface-variant)",
  "--md-comp-navigation-drawer-inactive-pressed-state-layer-color": "var(--md-sys-color-on-secondary-container)",
  "--md-comp-navigation-drawer-label-text-font": "var(--md-sys-typescale-label-large-font)",
  "--md-comp-navigation-drawer-label-text-line-height": "var(--md-sys-typescale-label-large-line-height)",
  "--md-comp-navigation-drawer-label-text-size": "var(--md-sys-typescale-label-large-size)",
  "--md-comp-navigation-drawer-label-text-tracking": "var(--md-sys-typescale-label-large-tracking)",
  "--md-comp-navigation-drawer-label-text-weight": "var(--md-sys-typescale-label-large-weight)",
  "--md-comp-navigation-drawer-modal-container-color": "var(--md-sys-color-surface-container-low)",
  "--md-ref-typeface-plain": "var(--font-app-mono)",
  "--md-sys-color-on-secondary-container": "#1D192B",
  "--md-sys-color-on-surface": "#1D1B20",
  "--md-sys-color-on-surface-variant": "#49454F",
  "--md-sys-color-secondary-container": "#E8DEF8",
  "--md-sys-color-surface-container-low": "#F7F2FA",
  "--md-sys-elevation-shadow-0": "none",
  "--md-sys-motion-duration-short4": "200ms",
  "--md-sys-motion-easing-standard": "cubic-bezier(0.2, 0, 0, 1)",
  "--md-sys-shape-corner-full": "9999px",
  "--md-sys-shape-corner-none": "0px",
  "--md-sys-space-100": "var(--md-sys-space-unit)",
  "--md-sys-space-150": "calc(var(--md-sys-space-unit) * 1.5)",
  "--md-sys-space-50": "calc(var(--md-sys-space-unit) * 0.5)",
  "--md-sys-space-unit": "8px",
  "--md-sys-state-focus-state-layer-opacity": "0.12",
  "--md-sys-state-hover-state-layer-opacity": "0.08",
  "--md-sys-state-pressed-state-layer-opacity": "0.12",
  "--md-sys-typescale-label-large-font": "var(--md-ref-typeface-plain)",
  "--md-sys-typescale-label-large-line-height": "1.25rem",
  "--md-sys-typescale-label-large-size": "0.875rem",
  "--md-sys-typescale-label-large-tracking": "0.00625rem",
  "--md-sys-typescale-label-large-weight": "500",
  "--md-sys-typescale-label-large-weight-prominent": "700",
  "--md-sys-typescale-label-small-line-height": "1rem",
  "--md-sys-typescale-label-small-size": "0.6875rem",
  "--md-sys-typescale-label-small-tracking": "0.03125rem",
  "--md-sys-typescale-label-small-weight": "500",
  "--md-sys-typescale-title-small-line-height": "1.25rem",
  "--md-sys-typescale-title-small-size": "0.875rem",
  "--md-sys-typescale-title-small-tracking": "0.00625rem",
  "--md-sys-typescale-title-small-weight": "500",
}

const DIMENSIONS = [
  "color",
  "shape",
  "elevation",
  "typography",
  "motion",
  "states",
  "geometry",
] as const

type Dimension = (typeof DIMENSIONS)[number]

const NAV = 'nav[data-settings-stage-nav][data-settings-nav-variant="rail"]'
const ACTIVE_STAGE = '[data-settings-nav-stage="appearance"][aria-current="true"]'
const INACTIVE_STAGE = '[data-settings-nav-stage="data"]'
const ACTIVE_STEP = '[data-settings-nav-step="theme"][aria-current="true"]'
/** The stage rows that are NOT last carry the suppressed timeline connector. */
const CONNECTOR = `${NAV} > ol > li > span[aria-hidden]`
/** Sub-step rows carry the suppressed bullet dot. */
const STEP_DOT = '[data-settings-nav-steps] > li > span[aria-hidden]'

/** Mirrors `applyDesignTheme`'s DOM contract: one root attribute per dimension. */
function applyMd3(off: readonly Dimension[] = []): void {
  const root = document.documentElement
  root.setAttribute("data-app-design", "md3")
  for (const dimension of DIMENSIONS) {
    root.setAttribute(`data-design-${dimension}`, off.includes(dimension) ? "off" : "on")
  }
  for (const [name, value] of Object.entries(MD3_SETTINGS_NAV_FIXTURE)) {
    root.style.setProperty(name, value)
  }
}

function resetDom(): void {
  const root = document.documentElement
  root.removeAttribute("data-app-design")
  for (const dimension of DIMENSIONS) root.removeAttribute(`data-design-${dimension}`)
  for (const name of Object.keys(MD3_SETTINGS_NAV_FIXTURE)) root.style.removeProperty(name)
}

function styleOf(selector: string, property: string, pseudo?: string): string {
  const el = document.querySelector<HTMLElement>(selector)
  expect(el, `missing element: ${selector}`).not.toBeNull()
  return getComputedStyle(el as HTMLElement, pseudo ?? null).getPropertyValue(property).trim()
}

/**
 * Follow a fixture `var()` chain to the terminal literal the browser finally sees
 * (`--md-comp-…-weight` → `--md-sys-typescale-…-weight-prominent` → `700`).
 */
function resolveToken(name: string): string {
  const raw = MD3_SETTINGS_NAV_FIXTURE[name]
  expect(raw, `fixture is missing ${name}`).toBeTypeOf("string")
  const chain = /^var\((--[a-z0-9-]+)\)$/.exec(raw as string)
  return chain ? resolveToken(chain[1] as string) : (raw as string)
}

/**
 * Resolve a fixture value to the same string the browser reports, so an assertion
 * quotes the *token* instead of a hand-copied pixel value. Only the two forms this
 * sheet actually emits are handled (`px`/`rem` literals, and a `var()` chain that
 * ends in one of those).
 */
function tokenPx(name: string): string {
  const raw = resolveToken(name)
  const direct = /^(-?[\d.]+)(px|rem)$/.exec(raw)
  if (direct) return `${Number(direct[1]) * (direct[2] === "rem" ? 16 : 1)}px`
  throw new Error(`tokenPx cannot resolve ${name}=${raw}`)
}

/** Same idea for colours: quote the role token, not an `rgb()` literal. */
function tokenRgb(name: string): string {
  const hex = resolveToken(name)
  const parts = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex)
  if (!parts) throw new Error(`tokenRgb cannot resolve ${name}=${hex}`)
  return `rgb(${Number(`0x${parts[1]}`)}, ${Number(`0x${parts[2]}`)}, ${Number(`0x${parts[3]}`)})`
}

async function renderRail(): Promise<void> {
  await i18n.changeLanguage("en")
  await render(
    <SettingsStageNav
      section="appearance"
      activeStep="theme"
      onSectionChange={() => {}}
      onStepSelect={() => {}}
      variant="rail"
    />,
  )
}

beforeEach(() => {
  applyMd3()
})

afterEach(() => {
  resetDom()
})

describe("md3 settings rail as a navigation drawer", () => {
  test("stage item is a 56dp drawer indicator with a 24dp leading icon", async () => {
    await renderRail()

    expect(styleOf(ACTIVE_STAGE, "height")).toBe(tokenPx("--md-comp-navigation-drawer-active-indicator-height"))
    expect(styleOf(ACTIVE_STAGE, "min-height")).toBe(tokenPx("--md-comp-navigation-drawer-active-indicator-height"))
    expect(styleOf(ACTIVE_STAGE, "box-shadow")).toBe("none")
    // the numbering badge is suppressed, so the drawer icon IS the leading slot
    expect(styleOf(`${ACTIVE_STAGE} > span:first-child`, "display")).toBe("none")
    expect(styleOf(`${ACTIVE_STAGE} > svg`, "width")).toBe(tokenPx("--md-comp-navigation-drawer-icon-size"))
    expect(styleOf(`${ACTIVE_STAGE} > svg`, "height")).toBe(tokenPx("--md-comp-navigation-drawer-icon-size"))
  })

  test("label typography is drawer label-large, not the old 11px/10px/9px", async () => {
    await renderRail()

    expect(styleOf(ACTIVE_STAGE, "font-size")).toBe(tokenPx("--md-comp-navigation-drawer-label-text-size"))
    expect(styleOf(ACTIVE_STAGE, "font-size")).toBe("14px")
    expect(styleOf(ACTIVE_STAGE, "line-height")).toBe(tokenPx("--md-comp-navigation-drawer-label-text-line-height"))
    expect(styleOf(ACTIVE_STAGE, "font-weight")).toBe(resolveToken("--md-comp-navigation-drawer-active-label-text-weight"))
    expect(styleOf(INACTIVE_STAGE, "font-weight")).toBe(resolveToken("--md-comp-navigation-drawer-label-text-weight"))
    expect(styleOf(INACTIVE_STAGE, "font-size")).toBe("14px")
    // nested steps share the drawer label; the 8px "ADV" tag is the list overline (label-small)
    expect(styleOf(ACTIVE_STEP, "font-size")).toBe("14px")
    expect(styleOf('[data-settings-nav-step="theme-import"] > span > span:not(:first-child)', "font-size")).toBe(
      tokenPx("--md-comp-list-list-item-overline-size"),
    )
    // headline replaces the hand-written uppercase overline
    expect(styleOf(`${NAV} > p`, "font-size")).toBe(tokenPx("--md-comp-navigation-drawer-headline-size"))
    expect(styleOf(`${NAV} > p`, "text-transform")).toBe("none")
  })

  test("selected item is the secondary-container indicator with on-secondary-container ink", async () => {
    await renderRail()

    const secondaryContainer = tokenRgb("--md-sys-color-secondary-container")
    const onSecondaryContainer = tokenRgb("--md-sys-color-on-secondary-container")
    expect(styleOf(ACTIVE_STAGE, "background-color")).toBe(secondaryContainer)
    expect(styleOf(ACTIVE_STAGE, "color")).toBe(onSecondaryContainer)
    expect(styleOf(`${ACTIVE_STAGE} > svg`, "color")).toBe(onSecondaryContainer)
    expect(styleOf(ACTIVE_STEP, "background-color")).toBe(secondaryContainer)
    // container is a drawer surface step, not the old `bg-muted/10`
    expect(styleOf(NAV, "background-color")).toBe(tokenRgb("--md-sys-color-surface-container-low"))
    expect(styleOf(NAV, "border-right-style")).toBe("none")
  })

  test("shape: resting items are flush rectangles, the indicator is corner-full", async () => {
    await renderRail()

    expect(styleOf(INACTIVE_STAGE, "border-top-left-radius")).toBe(tokenPx("--md-sys-shape-corner-none"))
    expect(styleOf(ACTIVE_STAGE, "border-top-left-radius")).toBe(tokenPx("--md-sys-shape-corner-full"))
  })

  test("the timeline connector and the sub-step dots are gone", async () => {
    await renderRail()

    expect(document.querySelectorAll(CONNECTOR).length, "rail should still render the connector markup").toBeGreaterThan(0)
    expect(document.querySelectorAll(STEP_DOT).length, "rail should still render the dot markup").toBeGreaterThan(0)
    expect(styleOf(CONNECTOR, "display")).toBe("none")
    expect(styleOf(STEP_DOT, "display")).toBe("none")
  })

  test("state layer is a pointer-transparent overlay inside the item, focus ring untouched", async () => {
    await renderRail()

    expect(styleOf(INACTIVE_STAGE, "position", "::before")).toBe("absolute")
    expect(styleOf(INACTIVE_STAGE, "z-index", "::before")).toBe("-1")
    expect(styleOf(INACTIVE_STAGE, "pointer-events", "::before")).toBe("none")
    expect(styleOf(INACTIVE_STAGE, "border-top-left-radius", "::before")).toBe("0px")
    expect(styleOf(INACTIVE_STAGE, "overflow")).toBe("hidden")
    expect(styleOf(INACTIVE_STAGE, "color")).toBe(tokenRgb("--md-sys-color-on-surface-variant"))
  })

  test("the focus ring is left alone: same outline with md3 on and with the recipe off", async () => {
    await renderRail()

    const withMd3 = styleOf(INACTIVE_STAGE, "outline-style")
    // Same DOM, recipe attributes removed — `resetDom` is the native control here,
    // so this compares the *layer's* effect and nothing else.
    resetDom()
    expect(styleOf(INACTIVE_STAGE, "outline-style")).toBe(withMd3)
  })

  test("sub-step item is a one-line list row aligned under the stage label", async () => {
    await renderRail()

    expect(styleOf(ACTIVE_STEP, "height")).toBe(tokenPx("--md-comp-list-list-item-one-line-container-height"))
    const stageLabelX = document.querySelector<HTMLElement>(`${ACTIVE_STAGE} > span:last-child`)!.getBoundingClientRect().left
    const stepLabelX = document.querySelector<HTMLElement>(`${ACTIVE_STEP} > span > span:first-child`)!.getBoundingClientRect().left
    expect(stepLabelX, "子级标签与父级标签同一条 x").toBeCloseTo(stageLabelX, 0)
  })
})

describe("md3 settings rail dimension gating", () => {
  test("negative control: geometry=off stops the 56dp drawer row", async () => {
    applyMd3(["geometry"])
    await renderRail()

    const token = tokenPx("--md-comp-navigation-drawer-active-indicator-height")
    expect(token).toBe("56px")
    expect(styleOf(ACTIVE_STAGE, "height")).not.toBe(token)
    // the suppressed affordances come back with the dimension that hid them
    expect(styleOf(`${ACTIVE_STAGE} > span:first-child`, "display")).not.toBe("none")
    expect(styleOf(CONNECTOR, "display")).not.toBe("none")
  })

  test("negative control: color=off stops the secondary-container indicator", async () => {
    applyMd3(["color"])
    await renderRail()

    const secondaryContainer = tokenRgb("--md-sys-color-secondary-container")
    expect(secondaryContainer).toBe("rgb(232, 222, 248)")
    expect(styleOf(ACTIVE_STAGE, "background-color")).not.toBe(secondaryContainer)
    expect(styleOf(NAV, "border-right-style")).not.toBe("none")
  })

  test("states=off takes the overlay away without touching the item box", async () => {
    applyMd3(["states"])
    await renderRail()

    // `content: none` means the pseudo-element box simply is not generated.
    expect(styleOf(INACTIVE_STAGE, "content", "::before")).toBe("none")
    expect(styleOf(INACTIVE_STAGE, "height")).toBe(tokenPx("--md-comp-navigation-drawer-active-indicator-height"))
  })

  test("typography=off reverts the label to the component's own size", async () => {
    applyMd3(["typography"])
    await renderRail()

    expect(styleOf(ACTIVE_STAGE, "font-size")).not.toBe("14px")
    expect(styleOf(ACTIVE_STAGE, "height")).toBe("56px")
  })

  test("shape=off reverts the corner-full indicator", async () => {
    applyMd3(["shape"])
    await renderRail()

    expect(styleOf(ACTIVE_STAGE, "border-top-left-radius")).not.toBe(tokenPx("--md-sys-shape-corner-full"))
  })

  test("native recipe (no data-app-design) leaves the rail exactly as it shipped", async () => {
    document.documentElement.removeAttribute("data-app-design")
    await renderRail()

    const token = tokenPx("--md-comp-navigation-drawer-active-indicator-height")
    expect(token).toBe("56px")
    expect(styleOf(ACTIVE_STAGE, "height")).not.toBe(token)
    expect(styleOf(ACTIVE_STAGE, "background-color")).not.toBe(tokenRgb("--md-sys-color-secondary-container"))
    expect(styleOf(CONNECTOR, "display")).not.toBe("none")
    expect(styleOf(`${ACTIVE_STAGE} > span:first-child`, "display")).not.toBe("none")
  })
})
