import { XL_IMAGE_EXTENSIONS } from "@xiranite/node-xlchemy/core"
import type { XlchemyCardState } from "./types"

type InputFormatSettings = Pick<XlchemyCardState, "format" | "excludedFormatsText" | "detectAnimatedPng" | "detectAnimatedWebp" | "detectAnimatedAvif" | "detectAnimatedJxl">
export const XLCHEMY_INPUT_EXTENSIONS = [...XL_IMAGE_EXTENSIONS]

export function enabledXlchemyInputExtensions(settings: InputFormatSettings): string[] {
  if (settings.format === "dynar") {
    return [
      ".gif",
      ...(settings.detectAnimatedPng === true ? [".png", ".apng"] : []),
      ...(settings.detectAnimatedWebp !== false ? [".webp"] : []),
      ...(settings.detectAnimatedAvif === true ? [".avif"] : []),
      ...(settings.detectAnimatedJxl === true ? [".jxl"] : []),
    ]
  }
  const excluded = new Set(String(settings.excludedFormatsText ?? "avif,jxl,webp,gif").split(/[,;\s]+/).map((value) => value.replace(/^\./, "").toLowerCase()).filter(Boolean))
  return XLCHEMY_INPUT_EXTENSIONS.filter((extension) => !excluded.has(extension.slice(1)))
}

export function isXlchemyInputPathEnabled(path: string, enabledExtensions: readonly string[]): boolean {
  const name = path.replace(/\\/g, "/").split("/").at(-1) ?? path
  const dot = name.lastIndexOf(".")
  return dot <= 0 || enabledExtensions.includes(name.slice(dot).toLowerCase())
}
