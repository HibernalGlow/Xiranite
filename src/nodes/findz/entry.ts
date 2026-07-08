import type { AppNodeEntry, NodeSchema } from "@xiranite/contract"
import { core, def } from "@xiranite/node-findz"
import { z } from "zod"
import { Component } from "./Component"
import type { FindzCardState } from "./types"

/**
 * Runtime validation schema for persisted findz card state. Uses `.passthrough()`
 * so legacy fields (e.g. `result`) do not disappear during the migration period.
 * The precise `FindzCardState` type stays hand-maintained in `./types`; this
 * schema is the runtime guard wired into `host.state.getData()`.
 */
export const findzDataSchema = z
  .object({
    pathText: z.string().optional(),
    where: z.string().optional(),
    noArchive: z.boolean().optional(),
    followSymlinks: z.boolean().optional(),
    withImageMeta: z.boolean().optional(),
    longFormat: z.boolean().optional(),
    continueOnError: z.boolean().optional(),
    maxResults: z.number().optional(),
    maxReturnFiles: z.number().optional(),
    groupBy: z.string().optional(),
    refine: z.string().optional(),
    sortBy: z.string().optional(),
    sortDesc: z.boolean().optional(),
    outputFormat: z.string().optional(),
    outputPath: z.string().optional(),
    archiveSeparator: z.string().optional(),
    printZero: z.boolean().optional(),
    logs: z.array(z.string()).optional(),
    phase: z.string().optional(),
    progress: z.number().optional(),
    progressText: z.string().optional(),
  })
  .passthrough()

const entry = {
  def,
  core,
  Component,
  host: {
    contractVersion: "^1.0.0",
    capabilities: ["state", "runner", "clipboard", "config", "env"],
  },
  schemas: {
    data: findzDataSchema as unknown as NodeSchema<FindzCardState>,
    config: findzDataSchema.partial() as unknown as NodeSchema<Partial<FindzCardState>>,
  },
} satisfies AppNodeEntry<typeof core, FindzCardState, Partial<FindzCardState>>

export default entry
