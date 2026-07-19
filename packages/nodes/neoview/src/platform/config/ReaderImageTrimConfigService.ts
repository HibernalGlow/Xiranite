import type { ResolveConfigPathOptions } from "@xiranite/config"

import {
  parseNeoviewImageTrimPatch,
  parseNeoviewRuntimeConfig,
} from "../../application/config/ReaderRuntimeConfig.js"
import type {
  ReaderImageTrimPatch,
  ReaderImageTrimSettings,
} from "../../application/image-trim/ReaderImageTrim.js"
import { commitNeoviewConfig } from "./NeoviewConfigStore.js"
import { loadNeoviewRuntimeConfig } from "./loadNeoviewRuntimeConfig.js"

export interface ReaderImageTrimConfigWriteResult {
  config: ReaderImageTrimSettings
  changed: boolean
  configPath: string
}

/** Canonical image-trim configuration port shared by CLI and terminal UI. */
export class ReaderImageTrimConfigService {
  constructor(private readonly options: ResolveConfigPathOptions = {}) {}

  async inspect(): Promise<ReaderImageTrimSettings> {
    return (await loadNeoviewRuntimeConfig(this.options)).imageTrim
  }

  async apply(patch: ReaderImageTrimPatch, confirmed: boolean): Promise<ReaderImageTrimConfigWriteResult> {
    if (!confirmed) throw new Error("Image trim changes require explicit confirmation.")
    const current = await this.inspect()
    const parsed = parseNeoviewImageTrimPatch({ imageTrim: patch }, current)
    return await this.#commit(parsed.tomlPatch)
  }

  async reset(confirmed: boolean): Promise<ReaderImageTrimConfigWriteResult> {
    if (!confirmed) throw new Error("Image trim reset requires explicit confirmation.")
    const parsed = parseNeoviewImageTrimPatch({ imageTrim: { reset: "defaults" } })
    return await this.#commit(parsed.tomlPatch)
  }

  async #commit(patch: Record<string, unknown>): Promise<ReaderImageTrimConfigWriteResult> {
    const committed = await commitNeoviewConfig(patch, { ...this.options, strategy: "merge" })
    return {
      config: parseNeoviewRuntimeConfig(committed.nodeConfig).imageTrim,
      changed: committed.changed,
      configPath: committed.configPath,
    }
  }
}
