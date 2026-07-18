import type { CSSProperties } from "react"

import type {
  ReaderShellConfigDto,
  ReaderShellMaterialPatch,
  ReaderShellMaterialPreset,
  ReaderShellSurface,
  ReaderShellSurfaceValues,
} from "../../adapters/reader-http-client"

export interface ReaderShellMaterialDraft {
  preset: ReaderShellMaterialPreset
  opacity: ReaderShellSurfaceValues
  blur: ReaderShellSurfaceValues
  saturation: ReaderShellSurfaceValues
  highlight: ReaderShellSurfaceValues
  shadow: ReaderShellSurfaceValues
}

export const READER_SHELL_SURFACES = ["top", "bottom", "sidebar"] as const

const DEFAULT_MATERIAL: ReaderShellMaterialDraft = {
  preset: "frosted",
  opacity: { top: 85, bottom: 85, sidebar: 85 },
  blur: { top: 12, bottom: 12, sidebar: 12 },
  saturation: { top: 115, bottom: 115, sidebar: 115 },
  highlight: { top: 35, bottom: 35, sidebar: 35 },
  shadow: { top: 45, bottom: 45, sidebar: 45 },
}

export const READER_SHELL_MATERIAL_PRESETS: Record<Exclude<ReaderShellMaterialPreset, "custom">, ReaderShellMaterialDraft> = {
  solid: createUniformMaterial("solid", { opacity: 100, blur: 0, saturation: 100, highlight: 8, shadow: 28 }),
  soft: createUniformMaterial("soft", { opacity: 92, blur: 8, saturation: 108, highlight: 20, shadow: 36 }),
  frosted: createUniformMaterial("frosted", { opacity: 82, blur: 16, saturation: 125, highlight: 38, shadow: 50 }),
}

export function readerShellMaterialDraft(shell: ReaderShellConfigDto): ReaderShellMaterialDraft {
  return {
    preset: shell.material?.preset ?? DEFAULT_MATERIAL.preset,
    opacity: { ...DEFAULT_MATERIAL.opacity, ...shell.opacity },
    blur: { ...DEFAULT_MATERIAL.blur, ...shell.blur },
    saturation: { ...DEFAULT_MATERIAL.saturation, ...shell.material?.saturation },
    highlight: { ...DEFAULT_MATERIAL.highlight, ...shell.material?.highlight },
    shadow: { ...DEFAULT_MATERIAL.shadow, ...shell.material?.shadow },
  }
}

export function readerShellMaterialPatch(draft: ReaderShellMaterialDraft): ReaderShellMaterialPatch {
  return {
    preset: draft.preset,
    opacity: { ...draft.opacity },
    blur: { ...draft.blur },
    saturation: { ...draft.saturation },
    highlight: { ...draft.highlight },
    shadow: { ...draft.shadow },
  }
}

export function readerShellMaterialStyle(
  draft: ReaderShellMaterialDraft,
  surface: ReaderShellSurface,
): CSSProperties {
  const shadowDirection = surface === "top" ? "0 10px 30px" : surface === "bottom" ? "0 -12px 30px" : "0 0 32px"
  return {
    backgroundColor: `color-mix(in oklch, var(--background) ${draft.opacity[surface]}%, transparent)`,
    backdropFilter: draft.blur[surface] === 0 && draft.saturation[surface] === 100
      ? "none"
      : `blur(${draft.blur[surface]}px) saturate(${draft.saturation[surface]}%)`,
    borderColor: `color-mix(in oklch, var(--border) ${Math.max(20, draft.highlight[surface])}%, transparent)`,
    boxShadow: `inset 0 1px 0 rgb(255 255 255 / ${(draft.highlight[surface] / 250).toFixed(3)}), ${shadowDirection} rgb(0 0 0 / ${(draft.shadow[surface] / 200).toFixed(3)})`,
  }
}

export function applyReaderShellMaterialPreview(draft: ReaderShellMaterialDraft, root: ParentNode = document): void {
  applyPreview(root, '[data-reader-edge-chrome="top"]', readerShellMaterialStyle(draft, "top"))
  applyPreview(root, '[data-reader-edge-chrome="bottom"]', readerShellMaterialStyle(draft, "bottom"))
  applyPreview(root, '[data-reader-edge-chrome="left"], [data-reader-edge-chrome="right"]', readerShellMaterialStyle(draft, "sidebar"))
  applyPreview(root, '[data-layer-id="sidebar-control"]', readerShellMaterialStyle(draft, "sidebar"))
}

function applyPreview(root: ParentNode, selector: string, style: CSSProperties): void {
  for (const element of root.querySelectorAll<HTMLElement>(selector)) Object.assign(element.style, style)
}

function createUniformMaterial(
  preset: Exclude<ReaderShellMaterialPreset, "custom">,
  values: { opacity: number; blur: number; saturation: number; highlight: number; shadow: number },
): ReaderShellMaterialDraft {
  const uniform = (value: number): ReaderShellSurfaceValues => ({ top: value, bottom: value, sidebar: value })
  return {
    preset,
    opacity: uniform(values.opacity),
    blur: uniform(values.blur),
    saturation: uniform(values.saturation),
    highlight: uniform(values.highlight),
    shadow: uniform(values.shadow),
  }
}
