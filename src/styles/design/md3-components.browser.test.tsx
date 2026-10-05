import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { render } from "vitest-browser-react"

import "./md3-components.css"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Token fixture for the MD3 component mapping layer.
 *
 * The mapping CSS (`md3-components.css` + `md3-components-selection.css`) only ever
 * reads `--md-*` custom properties; the engine normally writes them onto
 * `documentElement` (`src/lib/design-theme/apply.ts:83-87`). This test stands in for
 * the engine so the *mapping* is the thing under test: values are Google's own
 * canonical v0.192 numbers, read out of
 * `node_modules/@material/web/tokens/versions/v0_192/*.scss` — not typed from memory.
 * Colour roles use the M3 baseline light scheme.
 *
 * Deliberate deviations that this fixture encodes:
 *  - `--md-ref-typeface-brand` is the app face (`--font-app-sans`), not Roboto Flex.
 *  - `--md-sys-elevation-shadow-0..5` and `--md-sys-space-*` are not keys of the
 *    v0.192 dictionary; the engine derives them, and these are its documented shapes.
 */
export const MD3_TOKEN_FIXTURE: Record<string, string> = {
  "--md-comp-badge-large-color": "var(--md-sys-color-error)",
  "--md-comp-badge-large-label-text-color": "var(--md-sys-color-on-error)",
  "--md-comp-badge-large-shape": "var(--md-sys-shape-corner-full)",
  "--md-comp-banner-container-color": "var(--md-sys-color-surface-container-low)",
  "--md-comp-banner-supporting-text-color": "var(--md-sys-color-on-surface-variant)",
  "--md-comp-checkbox-container-shape": "2px",
  "--md-comp-checkbox-container-size": "18px",
  "--md-comp-checkbox-selected-container-color": "var(--md-sys-color-primary)",
  "--md-comp-checkbox-selected-icon-color": "var(--md-sys-color-on-primary)",
  "--md-comp-checkbox-unselected-outline-color": "var(--md-sys-color-on-surface-variant)",
  "--md-comp-checkbox-unselected-outline-width": "2px",
  "--md-comp-data-table-header-container-height": "56px",
  "--md-comp-data-table-header-headline-color": "var(--md-sys-color-on-surface-variant)",
  "--md-comp-data-table-row-item-container-height": "52px",
  "--md-comp-data-table-row-item-label-text-color": "var(--md-sys-color-on-surface)",
  "--md-comp-data-table-row-item-outline-color": "var(--md-sys-color-outline-variant)",
  "--md-comp-data-table-row-item-outline-width": "1px",
  "--md-comp-dialog-container-color": "var(--md-sys-color-surface-container-high)",
  "--md-comp-dialog-container-shape": "var(--md-sys-shape-corner-extra-large)",
  "--md-comp-dialog-headline-color": "var(--md-sys-color-on-surface)",
  "--md-comp-dialog-headline-font": "var(--md-sys-typescale-headline-small-font)",
  "--md-comp-dialog-headline-line-height": "var(--md-sys-typescale-headline-small-line-height)",
  "--md-comp-dialog-headline-size": "var(--md-sys-typescale-headline-small-size)",
  "--md-comp-dialog-headline-weight": "var(--md-sys-typescale-headline-small-weight)",
  "--md-comp-dialog-supporting-text-color": "var(--md-sys-color-on-surface-variant)",
  "--md-comp-divider-color": "var(--md-sys-color-outline-variant)",
  "--md-comp-divider-thickness": "1px",
  "--md-comp-elevated-card-container-color": "var(--md-sys-color-surface-container-low)",
  "--md-comp-elevated-card-container-shape": "var(--md-sys-shape-corner-medium)",
  "--md-comp-filled-button-container-color": "var(--md-sys-color-primary)",
  "--md-comp-filled-button-container-height": "40px",
  "--md-comp-filled-button-container-shape": "var(--md-sys-shape-corner-full)",
  "--md-comp-filled-button-disabled-container-color": "var(--md-sys-color-on-surface)",
  "--md-comp-filled-button-disabled-container-opacity": "0.12",
  "--md-comp-filled-button-disabled-label-text-color": "var(--md-sys-color-on-surface)",
  "--md-comp-filled-button-disabled-label-text-opacity": "0.38",
  "--md-comp-filled-button-label-text-color": "var(--md-sys-color-on-primary)",
  "--md-comp-filled-button-label-text-font": "var(--md-sys-typescale-label-large-font)",
  "--md-comp-filled-button-label-text-line-height": "var(--md-sys-typescale-label-large-line-height)",
  "--md-comp-filled-button-label-text-size": "var(--md-sys-typescale-label-large-size)",
  "--md-comp-filled-button-label-text-tracking": "var(--md-sys-typescale-label-large-tracking)",
  "--md-comp-filled-button-label-text-weight": "var(--md-sys-typescale-label-large-weight)",
  "--md-comp-filled-tonal-button-container-color": "var(--md-sys-color-secondary-container)",
  "--md-comp-filled-tonal-button-label-text-color": "var(--md-sys-color-on-secondary-container)",
  "--md-comp-icon-button-icon-size": "24px",
  "--md-comp-icon-button-state-layer-height": "40px",
  "--md-comp-icon-button-state-layer-width": "40px",
  "--md-comp-input-chip-container-height": "32px",
  "--md-comp-input-chip-container-shape": "var(--md-sys-shape-corner-small)",
  "--md-comp-input-chip-selected-container-color": "var(--md-sys-color-secondary-container)",
  "--md-comp-input-chip-selected-label-text-color": "var(--md-sys-color-on-secondary-container)",
  "--md-comp-input-chip-unselected-label-text-color": "var(--md-sys-color-on-surface-variant)",
  "--md-comp-input-chip-unselected-outline-color": "var(--md-sys-color-outline)",
  "--md-comp-linear-progress-indicator-active-indicator-color": "var(--md-sys-color-primary)",
  "--md-comp-linear-progress-indicator-active-indicator-height": "4px",
  "--md-comp-linear-progress-indicator-active-indicator-shape": "var(--md-sys-shape-corner-none)",
  "--md-comp-linear-progress-indicator-track-color": "var(--md-sys-color-surface-container-highest)",
  "--md-comp-linear-progress-indicator-track-height": "4px",
  "--md-comp-list-list-item-container-shape": "var(--md-sys-shape-corner-none)",
  "--md-comp-list-list-item-focus-state-layer-color": "var(--md-sys-color-on-surface)",
  "--md-comp-list-list-item-hover-label-text-color": "var(--md-sys-color-on-surface)",
  "--md-comp-list-list-item-label-text-color": "var(--md-sys-color-on-surface)",
  "--md-comp-list-list-item-one-line-container-height": "56px",
  "--md-comp-menu-container-color": "var(--md-sys-color-surface-container)",
  "--md-comp-menu-container-shape": "var(--md-sys-shape-corner-extra-small)",
  "--md-comp-navigation-drawer-active-indicator-shape": "var(--md-sys-shape-corner-full)",
  "--md-comp-navigation-drawer-container-height": "100%",
  "--md-comp-navigation-drawer-headline-color": "var(--md-sys-color-on-surface-variant)",
  "--md-comp-outlined-button-label-text-color": "var(--md-sys-color-primary)",
  "--md-comp-outlined-button-outline-color": "var(--md-sys-color-outline)",
  "--md-comp-outlined-button-outline-width": "1px",
  "--md-comp-outlined-card-outline-color": "var(--md-sys-color-outline-variant)",
  "--md-comp-outlined-segmented-button-container-height": "40px",
  "--md-comp-outlined-segmented-button-outline-color": "var(--md-sys-color-outline)",
  "--md-comp-outlined-segmented-button-outline-width": "1px",
  "--md-comp-outlined-segmented-button-selected-container-color": "var(--md-sys-color-secondary-container)",
  "--md-comp-outlined-segmented-button-selected-label-text-color": "var(--md-sys-color-on-secondary-container)",
  "--md-comp-outlined-segmented-button-shape": "var(--md-sys-shape-corner-full)",
  "--md-comp-outlined-segmented-button-unselected-label-text-color": "var(--md-sys-color-on-surface)",
  "--md-comp-outlined-select-text-field-container-shape": "var(--md-sys-shape-corner-extra-small)",
  "--md-comp-outlined-select-text-field-focus-outline-color": "var(--md-sys-color-primary)",
  "--md-comp-outlined-select-text-field-label-text-color": "var(--md-sys-color-on-surface-variant)",
  "--md-comp-outlined-select-text-field-outline-color": "var(--md-sys-color-outline)",
  "--md-comp-outlined-select-text-field-outline-width": "1px",
  "--md-comp-outlined-text-field-caret-color": "var(--md-sys-color-primary)",
  "--md-comp-outlined-text-field-container-shape": "var(--md-sys-shape-corner-extra-small)",
  "--md-comp-outlined-text-field-error-focus-outline-color": "var(--md-sys-color-error)",
  "--md-comp-outlined-text-field-focus-outline-color": "var(--md-sys-color-primary)",
  "--md-comp-outlined-text-field-input-text-color": "var(--md-sys-color-on-surface)",
  "--md-comp-outlined-text-field-input-text-placeholder-color": "var(--md-sys-color-on-surface-variant)",
  "--md-comp-outlined-text-field-input-text-size": "var(--md-sys-typescale-body-large-size)",
  "--md-comp-outlined-text-field-label-text-color": "var(--md-sys-color-on-surface-variant)",
  "--md-comp-outlined-text-field-outline-color": "var(--md-sys-color-outline)",
  "--md-comp-outlined-text-field-outline-width": "1px",
  "--md-comp-plain-tooltip-container-color": "var(--md-sys-color-inverse-surface)",
  "--md-comp-plain-tooltip-container-shape": "var(--md-sys-shape-corner-extra-small)",
  "--md-comp-plain-tooltip-supporting-text-color": "var(--md-sys-color-inverse-on-surface)",
  "--md-comp-primary-navigation-tab-active-indicator-height": "3px",
  "--md-comp-primary-navigation-tab-container-height": "48px",
  "--md-comp-primary-navigation-tab-container-shape": "var(--md-sys-shape-corner-none)",
  "--md-comp-radio-button-icon-size": "20px",
  "--md-comp-radio-button-selected-icon-color": "var(--md-sys-color-primary)",
  "--md-comp-scrim-container-color": "var(--md-sys-color-scrim)",
  "--md-comp-scrim-container-opacity": "0.32",
  "--md-comp-secondary-navigation-tab-container-height": "48px",
  "--md-comp-secondary-navigation-tab-label-text-font": "var(--md-sys-typescale-title-small-font)",
  "--md-comp-secondary-navigation-tab-label-text-size": "var(--md-sys-typescale-title-small-size)",
  "--md-comp-sheet-side-detached-container-shape": "var(--md-sys-shape-corner-large)",
  "--md-comp-sheet-side-docked-headline-color": "var(--md-sys-color-on-surface-variant)",
  "--md-comp-sheet-side-docked-modal-container-color": "var(--md-sys-color-surface-container-low)",
  "--md-comp-slider-active-track-color": "var(--md-sys-color-primary)",
  "--md-comp-slider-active-track-height": "4px",
  "--md-comp-slider-active-track-shape": "var(--md-sys-shape-corner-full)",
  "--md-comp-slider-handle-color": "var(--md-sys-color-primary)",
  "--md-comp-slider-handle-height": "20px",
  "--md-comp-slider-handle-width": "20px",
  "--md-comp-slider-inactive-track-color": "var(--md-sys-color-surface-container-highest)",
  "--md-comp-slider-inactive-track-height": "4px",
  "--md-comp-switch-handle-shape": "var(--md-sys-shape-corner-full)",
  "--md-comp-switch-selected-handle-color": "var(--md-sys-color-on-primary)",
  "--md-comp-switch-selected-handle-height": "24px",
  "--md-comp-switch-selected-handle-width": "24px",
  "--md-comp-switch-selected-track-color": "var(--md-sys-color-primary)",
  "--md-comp-switch-track-height": "32px",
  "--md-comp-switch-track-outline-width": "2px",
  "--md-comp-switch-track-shape": "var(--md-sys-shape-corner-full)",
  "--md-comp-switch-track-width": "52px",
  "--md-comp-switch-unselected-handle-color": "var(--md-sys-color-outline)",
  "--md-comp-switch-unselected-handle-height": "16px",
  "--md-comp-switch-unselected-handle-width": "16px",
  "--md-comp-switch-unselected-track-color": "var(--md-sys-color-surface-container-highest)",
  "--md-comp-switch-unselected-track-outline-color": "var(--md-sys-color-outline)",
  "--md-comp-text-button-label-text-color": "var(--md-sys-color-primary)",
  "--md-ref-typeface-brand": "var(--font-app-sans)",
  "--md-sys-color-error": "#B3261E",
  "--md-sys-color-error-container": "#F9DEDC",
  "--md-sys-color-on-error": "#FFFFFF",
  "--md-sys-color-on-error-container": "#410E0B",
  "--md-sys-color-on-primary": "#FFFFFF",
  "--md-sys-color-on-secondary-container": "#1D192B",
  "--md-sys-color-on-surface": "#1D1B20",
  "--md-sys-color-on-surface-variant": "#49454F",
  "--md-sys-color-outline": "#79747E",
  "--md-sys-color-outline-variant": "#CAC4D0",
  "--md-sys-color-primary": "#6750A4",
  "--md-sys-color-secondary-container": "#E8DEF8",
  "--md-sys-color-surface": "#FEF7FF",
  "--md-sys-color-surface-container": "#F3EDF7",
  "--md-sys-color-surface-container-high": "#ECE6F0",
  "--md-sys-color-surface-container-highest": "#E6E0E9",
  "--md-sys-color-surface-container-low": "#F7F2FA",
  "--md-sys-color-background": "#FEF7FF",
  "--md-sys-color-inverse-on-surface": "#F5EFEF",
  "--md-sys-color-inverse-primary": "#D0BCFF",
  "--md-sys-color-inverse-surface": "#322F35",
  "--md-sys-color-on-background": "#1D1B20",
  "--md-sys-color-on-primary-container": "#21005D",
  "--md-sys-color-on-secondary": "#FFFFFF",
  "--md-sys-color-on-tertiary": "#FFFFFF",
  "--md-sys-color-on-tertiary-container": "#31111D",
  "--md-sys-color-primary-container": "#EADDFF",
  "--md-sys-color-scrim": "#000000",
  "--md-sys-color-secondary": "#625B71",
  "--md-sys-color-shadow": "#000000",
  "--md-sys-color-surface-bright": "#F8F1F8",
  "--md-sys-color-surface-container-lowest": "#FFFFFF",
  "--md-sys-color-surface-dim": "#DED6DB",
  "--md-sys-color-tertiary": "#7D5260",
  "--md-sys-color-tertiary-container": "#FFD8E4",
  "--md-sys-elevation-level0": "0",
  "--md-sys-elevation-level1": "1",
  "--md-sys-elevation-level2": "3",
  "--md-sys-elevation-level3": "6",
  "--md-sys-elevation-level4": "8",
  "--md-sys-elevation-shadow-0": "none",
  "--md-sys-elevation-shadow-1": "0px 1px 2px rgba(0, 0, 0, 0.3), 0px 1px 4px rgba(0, 0, 0, 0.15)",
  "--md-sys-elevation-shadow-2": "0px 3px 6px rgba(0, 0, 0, 0.3), 0px 3px 10px rgba(0, 0, 0, 0.15)",
  "--md-sys-elevation-shadow-3": "0px 6px 12px rgba(0, 0, 0, 0.3), 0px 6px 19px rgba(0, 0, 0, 0.15)",
  "--md-sys-elevation-shadow-4": "0px 8px 16px rgba(0, 0, 0, 0.3), 0px 8px 25px rgba(0, 0, 0, 0.15)",
  "--md-sys-elevation-shadow-5": "0px 12px 24px rgba(0, 0, 0, 0.3), 0px 12px 37px rgba(0, 0, 0, 0.15)",
  "--md-sys-motion-duration-extra-long1": "700ms",
  "--md-sys-motion-duration-extra-long2": "800ms",
  "--md-sys-motion-duration-extra-long3": "900ms",
  "--md-sys-motion-duration-extra-long4": "1000ms",
  "--md-sys-motion-duration-long1": "450ms",
  "--md-sys-motion-duration-long2": "500ms",
  "--md-sys-motion-duration-long3": "550ms",
  "--md-sys-motion-duration-long4": "600ms",
  "--md-sys-motion-duration-medium1": "250ms",
  "--md-sys-motion-duration-medium2": "300ms",
  "--md-sys-motion-duration-medium3": "350ms",
  "--md-sys-motion-duration-medium4": "400ms",
  "--md-sys-motion-duration-short1": "50ms",
  "--md-sys-motion-duration-short2": "100ms",
  "--md-sys-motion-duration-short3": "150ms",
  "--md-sys-motion-duration-short4": "200ms",
  "--md-sys-motion-easing-emphasized": "cubic-bezier(0.2, 0, 0, 1)",
  "--md-sys-motion-easing-emphasized-accelerate": "cubic-bezier(0.3, 0, 0.8, 0.15)",
  "--md-sys-motion-easing-emphasized-decelerate": "cubic-bezier(0.05, 0.7, 0.1, 1)",
  "--md-sys-motion-easing-legacy": "cubic-bezier(0.4, 0, 0.2, 1)",
  "--md-sys-motion-easing-legacy-accelerate": "cubic-bezier(0.4, 0, 1, 1)",
  "--md-sys-motion-easing-legacy-decelerate": "cubic-bezier(0, 0, 0.2, 1)",
  "--md-sys-motion-easing-linear": "cubic-bezier(0, 0, 1, 1)",
  "--md-sys-motion-easing-standard": "cubic-bezier(0.2, 0, 0, 1)",
  "--md-sys-motion-easing-standard-accelerate": "cubic-bezier(0.3, 0, 1, 1)",
  "--md-sys-motion-easing-standard-decelerate": "cubic-bezier(0, 0, 0, 1)",
  "--md-sys-shape-corner-extra-large": "28px",
  "--md-sys-shape-corner-extra-large-top": "(28px 28px 0px 0px)",
  "--md-sys-shape-corner-extra-small": "4px",
  "--md-sys-shape-corner-extra-small-top": "(4px 4px 0px 0px)",
  "--md-sys-shape-corner-full": "9999px",
  "--md-sys-shape-corner-large": "16px",
  "--md-sys-shape-corner-large-end": "(0px 16px 16px 0px)",
  "--md-sys-shape-corner-large-start": "(16px 0px 0px 16px)",
  "--md-sys-shape-corner-large-top": "(16px 16px 0px 0px)",
  "--md-sys-shape-corner-medium": "12px",
  "--md-sys-shape-corner-none": "0px",
  "--md-sys-space-0": "0px",
  "--md-sys-space-25": "2px",
  "--md-sys-space-50": "4px",
  "--md-sys-space-75": "6px",
  "--md-sys-space-100": "8px",
  "--md-sys-space-125": "10px",
  "--md-sys-space-150": "12px",
  "--md-sys-space-175": "14px",
  "--md-sys-space-200": "16px",
  "--md-sys-space-250": "20px",
  "--md-sys-space-300": "24px",
  "--md-sys-space-400": "32px",
  "--md-sys-space-450": "36px",
  "--md-sys-space-500": "40px",
  "--md-sys-space-600": "48px",
  "--md-sys-space-700": "56px",
  "--md-sys-space-800": "64px",
  "--md-sys-space-900": "72px",
  "--md-sys-space-unit": "8px",
  "--md-sys-state-dragged-state-layer-opacity": "0.16",
  "--md-sys-state-focus-state-layer-opacity": "0.12",
  "--md-sys-state-hover-state-layer-opacity": "0.08",
  "--md-sys-state-pressed-state-layer-opacity": "0.12",
  "--md-sys-typescale-body-large-font": "var(--font-app-sans)",
  "--md-sys-typescale-body-large-line-height": "1.5rem",
  "--md-sys-typescale-body-large-size": "1rem",
  "--md-sys-typescale-body-large-tracking": "0.03125rem",
  "--md-sys-typescale-body-large-weight": "400",
  "--md-sys-typescale-body-medium-font": "var(--font-app-sans)",
  "--md-sys-typescale-body-medium-line-height": "1.25rem",
  "--md-sys-typescale-body-medium-size": "0.875rem",
  "--md-sys-typescale-body-medium-tracking": "0.015625rem",
  "--md-sys-typescale-body-medium-weight": "400",
  "--md-sys-typescale-body-small-font": "var(--font-app-sans)",
  "--md-sys-typescale-body-small-line-height": "1rem",
  "--md-sys-typescale-body-small-size": "0.75rem",
  "--md-sys-typescale-body-small-tracking": "0.025rem",
  "--md-sys-typescale-body-small-weight": "400",
  "--md-sys-typescale-display-large-font": "var(--font-app-sans)",
  "--md-sys-typescale-display-large-line-height": "4rem",
  "--md-sys-typescale-display-large-size": "3.5625rem",
  "--md-sys-typescale-display-large-tracking": "-0.015625rem",
  "--md-sys-typescale-display-large-weight": "400",
  "--md-sys-typescale-display-medium-font": "var(--font-app-sans)",
  "--md-sys-typescale-display-medium-line-height": "3.25rem",
  "--md-sys-typescale-display-medium-size": "2.8125rem",
  "--md-sys-typescale-display-medium-tracking": "0rem",
  "--md-sys-typescale-display-medium-weight": "400",
  "--md-sys-typescale-display-small-font": "var(--font-app-sans)",
  "--md-sys-typescale-display-small-line-height": "2.75rem",
  "--md-sys-typescale-display-small-size": "2.25rem",
  "--md-sys-typescale-display-small-tracking": "0rem",
  "--md-sys-typescale-display-small-weight": "400",
  "--md-sys-typescale-headline-large-font": "var(--font-app-sans)",
  "--md-sys-typescale-headline-large-line-height": "2.5rem",
  "--md-sys-typescale-headline-large-size": "2rem",
  "--md-sys-typescale-headline-large-tracking": "0rem",
  "--md-sys-typescale-headline-large-weight": "400",
  "--md-sys-typescale-headline-medium-font": "var(--font-app-sans)",
  "--md-sys-typescale-headline-medium-line-height": "2.25rem",
  "--md-sys-typescale-headline-medium-size": "1.75rem",
  "--md-sys-typescale-headline-medium-tracking": "0rem",
  "--md-sys-typescale-headline-medium-weight": "400",
  "--md-sys-typescale-headline-small-font": "var(--font-app-sans)",
  "--md-sys-typescale-headline-small-line-height": "2rem",
  "--md-sys-typescale-headline-small-size": "1.5rem",
  "--md-sys-typescale-headline-small-tracking": "0rem",
  "--md-sys-typescale-headline-small-weight": "400",
  "--md-sys-typescale-label-large-font": "var(--font-app-sans)",
  "--md-sys-typescale-label-large-line-height": "1.25rem",
  "--md-sys-typescale-label-large-size": "0.875rem",
  "--md-sys-typescale-label-large-tracking": "0.00625rem",
  "--md-sys-typescale-label-large-weight": "500",
  "--md-sys-typescale-label-large-weight-prominent": "700",
  "--md-sys-typescale-label-medium-font": "var(--font-app-sans)",
  "--md-sys-typescale-label-medium-line-height": "1rem",
  "--md-sys-typescale-label-medium-size": "0.75rem",
  "--md-sys-typescale-label-medium-tracking": "0.03125rem",
  "--md-sys-typescale-label-medium-weight": "500",
  "--md-sys-typescale-label-medium-weight-prominent": "700",
  "--md-sys-typescale-label-small-font": "var(--font-app-sans)",
  "--md-sys-typescale-label-small-line-height": "1rem",
  "--md-sys-typescale-label-small-size": "0.6875rem",
  "--md-sys-typescale-label-small-tracking": "0.03125rem",
  "--md-sys-typescale-label-small-weight": "500",
  "--md-sys-typescale-title-large-font": "var(--font-app-sans)",
  "--md-sys-typescale-title-large-line-height": "1.75rem",
  "--md-sys-typescale-title-large-size": "1.375rem",
  "--md-sys-typescale-title-large-tracking": "0rem",
  "--md-sys-typescale-title-large-weight": "400",
  "--md-sys-typescale-title-medium-font": "var(--font-app-sans)",
  "--md-sys-typescale-title-medium-line-height": "1.5rem",
  "--md-sys-typescale-title-medium-size": "1rem",
  "--md-sys-typescale-title-medium-tracking": "0.009375rem",
  "--md-sys-typescale-title-medium-weight": "500",
  "--md-sys-typescale-title-small-font": "var(--font-app-sans)",
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

/** Mirrors `applyDesignTheme`'s DOM contract: one root attribute per dimension. */
function applyMd3(off: readonly Dimension[] = []): void {
  const root = document.documentElement
  root.setAttribute("data-app-design", "md3")
  for (const dimension of DIMENSIONS) {
    root.setAttribute(`data-design-${dimension}`, off.includes(dimension) ? "off" : "on")
  }
  for (const [name, value] of Object.entries(MD3_TOKEN_FIXTURE)) {
    root.style.setProperty(name, value)
  }
}

function resetDom(): void {
  const root = document.documentElement
  // 皮肤属性是「在场即接管」的判据，测试里手动设过就必须清掉，否则下一条测试的
  // `:not([data-choice-control-style])` 门会被上一轮的残留悄悄关掉。
  root.removeAttribute("data-choice-control-style")
  root.removeAttribute("data-tabs-style")
  root.removeAttribute("data-switch-style")
  root.removeAttribute("data-app-design")
  for (const dimension of DIMENSIONS) root.removeAttribute(`data-design-${dimension}`)
  for (const name of Object.keys(MD3_TOKEN_FIXTURE)) root.style.removeProperty(name)
}

function styleOf(selector: string, property: string, pseudo?: string): string {
  const el = document.querySelector<HTMLElement>(selector)
  expect(el, `missing element: ${selector}`).not.toBeNull()
  return getComputedStyle(el as HTMLElement, pseudo ?? null).getPropertyValue(property).trim()
}

beforeEach(() => {
  applyMd3()
})

afterEach(() => {
  resetDom()
})

describe("md3 buttons (filled / outlined / text)", () => {
  test("default button takes filled-button container height 40px and corner-full", async () => {
    await render(<Button>Save</Button>)

    expect(styleOf('[data-slot="button"]', "height")).toBe("40px")
    expect(styleOf('[data-slot="button"]', "border-top-left-radius")).toBe("9999px")
  })

  test("icon-only button takes the 40dp icon-button state layer", async () => {
    await render(
      <Button variant="outline" size="icon" aria-label="Close">
        <svg />
      </Button>,
    )

    expect(styleOf('[data-slot="button"]', "width")).toBe("40px")
    expect(styleOf('[data-slot="button"]', "height")).toBe("40px")
  })

  test("negative control: data-design-geometry=off reverts the button height", async () => {
    applyMd3(["geometry"])
    await render(<Button>Save</Button>)

    const height = styleOf('[data-slot="button"]', "height")
    expect(height).not.toBe("40px")
  })
})

describe("md3 surfaces", () => {
  test("dialog content is corner-extra-large (28px)", async () => {
    await render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>Body</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    )

    expect(styleOf('[data-slot="dialog-content"]', "border-top-left-radius")).toBe("28px")
  })

  test("card is elevated-card corner-medium (12px)", async () => {
    await render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
        </CardHeader>
        <CardContent>Body</CardContent>
      </Card>,
    )

    expect(styleOf('[data-slot="card"]', "border-top-left-radius")).toBe("12px")
  })

  test("tooltip is plain-tooltip: 4px radius on inverse-surface", async () => {
    await render(
      <TooltipProvider delayDuration={0}>
        <Tooltip defaultOpen>
          <TooltipTrigger>Hover</TooltipTrigger>
          <TooltipContent>Hint</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )

    expect(styleOf('[data-slot="tooltip-content"]', "border-top-left-radius")).toBe("4px")
    expect(styleOf('[data-slot="tooltip-content"]', "background-color")).toBe("rgb(50, 47, 53)")
  })
})

describe("md3 selection controls", () => {
  test("switch track is 52x32 despite the component's !important size utilities", async () => {
    await render(<Switch defaultChecked />)

    expect(styleOf('[data-slot="switch"]', "width")).toBe("52px")
    expect(styleOf('[data-slot="switch"]', "height")).toBe("32px")
  })

  test("checkbox is an 18px container with a 2px outline", async () => {
    await render(<Checkbox />)

    expect(styleOf('[data-slot="checkbox"]', "width")).toBe("18px")
    expect(styleOf('[data-slot="checkbox"]', "height")).toBe("18px")
    expect(styleOf('[data-slot="checkbox"]', "border-top-width")).toBe("2px")
  })

  test("progress is the 4px linear progress indicator", async () => {
    await render(<Progress value={40} />)

    expect(styleOf('[data-slot="progress"]', "height")).toBe("4px")
  })
})

describe("component skins outrank the md3 layer", () => {  test("tab treatment follows the component skin, and follows it when it changes", async () => {
    document.documentElement.dataset.tabsStyle = "pill"
    applyMd3([])
    await render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Alpha</TabsTrigger>
          <TabsTrigger value="b">Beta</TabsTrigger>
        </TabsList>
      </Tabs>,
    )

    // 判据：MD3 对皮肤管的属性零影响 —— 开与关 MD3，tabs 的圆角必须一模一样。
    // （不断言「等于皮肤值」：这个 harness 里 index.css 的 :root[data-tabs-style] 规则对该元素
    //  matches() 为 false，拿它当证据会假绿。正控在下面，证明这里的开关真的在起作用。）
    const radiusWithMd3 = styleOf('[data-slot="tabs-trigger"]', "border-top-left-radius")
    document.documentElement.removeAttribute("data-app-design")
    expect(styleOf('[data-slot="tabs-trigger"]', "border-top-left-radius")).toBe(radiusWithMd3)
    // 正控：同一个测试里，MD3 自己管的属性（卡片圆角 12px）必须随属性摘掉而消失，
    // 否则上面那条「一模一样」只是开关根本没生效。
    const card = document.createElement("div")
    card.setAttribute("data-slot", "card")
    document.body.append(card)
    document.documentElement.setAttribute("data-app-design", "md3")
    expect(getComputedStyle(card).borderTopLeftRadius).toBe("12px")
    document.documentElement.removeAttribute("data-app-design")
    expect(getComputedStyle(card).borderTopLeftRadius).not.toBe("12px")
    card.remove()
    document.documentElement.setAttribute("data-app-design", "md3")
  })

  test("segmented controls follow MD3 while the choice-control skin is absent", async () => {
    // 「不接管」档的落点：属性缺失时，让位门 `:not([data-choice-control-style])` 打开，
    // M3 的 outlined segmented（40dp 容器 + corner-full 外框）回来。
    delete document.documentElement.dataset.choiceControlStyle
    applyMd3([])
    await render(
      <ToggleGroup type="single" defaultValue="a">
        <ToggleGroupItem value="a">嵌套</ToggleGroupItem>
        <ToggleGroupItem value="b">媒体</ToggleGroupItem>
      </ToggleGroup>,
    )

    expect(styleOf('[data-slot="toggle-group-item"]', "height")).toBe("40px")
    expect(styleOf('[data-slot="toggle-group"]', "border-top-left-radius")).toBe("9999px")
    expect(styleOf('[data-slot="toggle-group-item"]', "border-top-width")).toBe("1px")

    // 皮肤一在场就必须整组让位（往返验，两半缺一不可）。
    document.documentElement.dataset.choiceControlStyle = "tabs"
    expect(styleOf('[data-slot="toggle-group-item"]', "height")).not.toBe("40px")
    expect(styleOf('[data-slot="toggle-group"]', "border-top-left-radius")).not.toBe("9999px")
    delete document.documentElement.dataset.choiceControlStyle
    expect(styleOf('[data-slot="toggle-group-item"]', "height"), "删掉属性后门要重新打开").toBe("40px")
  })

  test("switch keeps MD3 geometry where the skin is silent, but yields its colour", async () => {
    document.documentElement.dataset.switchStyle = "filled"
    applyMd3([])
    await render(<Switch checked />)

    // 尺寸/形状：皮肤只声明 background/border-color/box-shadow/opacity，没碰尺寸 → MD3 保留。
    expect(styleOf('[data-slot="switch"]', "width")).toBe("52px")
    expect(styleOf('[data-slot="switch"]', "height")).toBe("32px")
    // 颜色归皮肤：关掉 MD3 之后底色不变 ⇒ 这层底色不是 MD3 画的（MD3 只保留尺寸/形状）。
    // 「摘属性真的有用」由上面 tabs 测试里的正控负责，这里不重复担保。
    const withMd3 = styleOf('[data-slot="switch"]', "background-color")
    document.documentElement.removeAttribute("data-app-design")
    expect(styleOf('[data-slot="switch"]', "background-color")).toBe(withMd3)
  })
})

describe("md3 dimension gating", () => {
  test("shape off reverts the card radius while geometry keeps the card padding", async () => {
    applyMd3(["shape"])
    await render(<Card>Body</Card>)

    expect(styleOf('[data-slot="card"]', "border-top-left-radius")).not.toBe("12px")
    expect(styleOf('[data-slot="card"]', "padding-block-start")).toBe("16px")
  })

  test("colour off stops the inverse-surface tooltip fill", async () => {
    applyMd3(["color"])
    await render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger>Hint</TooltipTrigger>
          <TooltipContent>Helpful text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )

    // tooltip 的颜色是 color 维度管的（不是皮肤管的槽），关掉后不该再吃到 inverse-surface。
    // 53 这一位是夹具值本值（#322F35）——写成别的数这条断言就永远成立，等于没测。
    expect(styleOf('[data-slot="tooltip-content"]', "background-color")).not.toBe("rgb(50, 47, 53)")
  })

  test("native recipe (no data-app-design) leaves the button at its own size", async () => {
    document.documentElement.removeAttribute("data-app-design")
    await render(<Button>Save</Button>)

    expect(styleOf('[data-slot="button"]', "height")).not.toBe("40px")
  })
})
