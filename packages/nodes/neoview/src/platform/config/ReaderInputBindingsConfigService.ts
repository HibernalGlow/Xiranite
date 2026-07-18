import type { ResolveConfigPathOptions } from "@xiranite/config"

import {
  parseNeoviewInputBindingsConfig,
  parseNeoviewInputBindingsPatch,
} from "../../application/config/ReaderInputBindingsConfig.js"
import type { ReaderInputBinding, ReaderInputBindingsConfig } from "../../domain/input/ReaderInputBindings.js"
import { commitNeoviewConfig, readNeoviewConfig } from "./NeoviewConfigStore.js"

export interface ReaderInputBindingsConfigWriteResult {
  config: ReaderInputBindingsConfig
  changed: boolean
  configPath: string
}

/** Canonical configuration port shared by CLI and terminal interaction surfaces. */
export class ReaderInputBindingsConfigService {
  constructor(private readonly options: ResolveConfigPathOptions = {}) {}

  async inspect(): Promise<ReaderInputBindingsConfig> {
    const node = await readNeoviewConfig(this.options)
    return parseNeoviewInputBindingsConfig(isRecord(node.bindings) ? node.bindings : undefined)
  }

  async apply(bindings: readonly ReaderInputBinding[], confirmed: boolean): Promise<ReaderInputBindingsConfigWriteResult> {
    if (!confirmed) throw new Error("Input binding changes require explicit confirmation.")
    const parsed = parseNeoviewInputBindingsPatch({ inputBindings: { bindings: [...bindings] } })
    return await this.#commit(parsed.tomlPatch)
  }

  async reset(confirmed: boolean): Promise<ReaderInputBindingsConfigWriteResult> {
    if (!confirmed) throw new Error("Input binding reset requires explicit confirmation.")
    const parsed = parseNeoviewInputBindingsPatch({ inputBindings: { reset: "defaults" } })
    return await this.#commit(parsed.tomlPatch)
  }

  async #commit(patch: Record<string, unknown>): Promise<ReaderInputBindingsConfigWriteResult> {
    const committed = await commitNeoviewConfig(patch, { ...this.options, strategy: "merge" })
    const bindings = isRecord(committed.nodeConfig.bindings) ? committed.nodeConfig.bindings : undefined
    return {
      config: parseNeoviewInputBindingsConfig(bindings),
      changed: committed.changed,
      configPath: committed.configPath,
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
