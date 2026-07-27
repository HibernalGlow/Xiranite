import type { AppNodeEntry, NodeSchema } from "@xiranite/contract"
import { core, def } from "@xiranite/node-findz"
import { z } from "zod"
import { Component } from "./Component"
import type { FindzCardState } from "./types"

export const findzDataSchema = z
  .object({
    libraryRoot: z.string().optional(),
    libraryId: z.string().optional(),
    pathPrefix: z.string().optional(),
    text: z.string().optional(),
    rules: z.unknown().optional(),
    sortBy: z.string().optional(),
    sortDesc: z.boolean().optional(),
    areaBy: z.string().optional(),
    selectedArchiveId: z.number().int().positive().optional(),
    taskId: z.string().optional(),
    pageCursor: z.string().optional(),
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
