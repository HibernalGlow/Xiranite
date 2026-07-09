import type { AppNodeEntry, NodeSchema } from "@xiranite/contract"
import { core, def } from "@xiranite/node-enginev"
import { z } from "zod"
import { Component } from "./Component"
import type { EngineVCardState, EngineVNodeConfig } from "./types"

/**
 * Runtime validation schema for persisted enginev card state. Uses `.passthrough()`
 * so legacy fields (e.g. `wallpapers`, `filteredWallpapers`, `result`) do not
 * disappear during the migration period. The precise `EngineVCardState` type
 * stays hand-maintained in `./types`; this schema is the runtime guard wired
 * into `host.state.getData()`.
 */
export const enginevDataSchema = z
  .object({
    workshopPath: z.string().optional(),
    titleFilter: z.string().optional(),
    ratingFilter: z.string().optional(),
    typeFilter: z.string().optional(),
    idsText: z.string().optional(),
    template: z.string().optional(),
    outputPath: z.string().optional(),
    exportFormat: z.string().optional(),
    dryRun: z.boolean().optional(),
    copyMode: z.boolean().optional(),
    permanent: z.boolean().optional(),
    targetPath: z.string().optional(),
    galleryColumns: z.number().optional(),
    galleryCompact: z.boolean().optional(),
    galleryShowMeta: z.boolean().optional(),
    galleryShowPath: z.boolean().optional(),
    logs: z.array(z.string()).optional(),
    phase: z.string().optional(),
    progress: z.number().optional(),
    progressText: z.string().optional(),
  })
  .passthrough()

const enginevUiConfigSchema = z
  .object({
    galleryColumns: z.number().optional(),
    galleryCompact: z.boolean().optional(),
    galleryShowMeta: z.boolean().optional(),
    galleryShowPath: z.boolean().optional(),
  })
  .passthrough()

const enginevConfigSchema = z
  .object({
    workshopPath: z.string().optional(),
    outputPath: z.string().optional(),
    template: z.string().optional(),
    ui: enginevUiConfigSchema.optional(),
  })
  .passthrough()

const entry = {
  def,
  core,
  Component,
  host: {
    contractVersion: "^1.0.0",
    capabilities: ["state", "runner", "clipboard", "localFiles", "config", "env"],
  },
  schemas: {
    data: enginevDataSchema as unknown as NodeSchema<EngineVCardState>,
    config: enginevConfigSchema as unknown as NodeSchema<EngineVNodeConfig>,
  },
} satisfies AppNodeEntry<typeof core, EngineVCardState, EngineVNodeConfig>

export default entry
