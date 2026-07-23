import type { AppNodeEntry, NodeSchema } from "@xiranite/contract"
import { core, def } from "@xiranite/node-lorat"
import { z } from "zod"
import { Component } from "./Component"
import type { LoratCardState } from "./types"

const cardStateSchema = z.object({
  action: z.enum(["scan", "collect", "apply_db", "write_triggers", "mark_no_trigger", "export_db"]).optional(),
  workspaceTab: z.enum(["manage", "collect"]).optional(),
  folderPath: z.string().optional(),
  collectionRoot: z.string().optional(),
  collectionItems: z.array(z.record(z.string(), z.unknown())).optional(),
  collectionOverwrite: z.boolean().optional(),
  collectionCreateModelFolder: z.boolean().optional(),
  collectionResults: z.array(z.record(z.string(), z.unknown())).optional(),
  triggerDbJson: z.string().optional(),
  search: z.string().optional(),
  statusFilter: z.enum(["all", "missing", "trigger", "notrigger"]).optional(),
  scopeFilter: z.enum(["all", "self", "at"]).optional(),
  rows: z.array(z.record(z.string(), z.unknown())).optional(),
  logs: z.array(z.string()).optional(),
  phase: z.enum(["idle", "scanning", "completed", "error"]).optional(),
  progress: z.number().optional(),
  progressText: z.string().optional(),
}).passthrough()

export default {
  def,
  core,
  Component,
  host: { contractVersion: "^1.0.0", capabilities: ["state", "runner", "clipboard", "localFiles", "config", "env"] },
  schemas: {
    data: cardStateSchema as unknown as NodeSchema<LoratCardState>,
    config: cardStateSchema as unknown as NodeSchema<Partial<LoratCardState>>,
  },
} satisfies AppNodeEntry<typeof core, LoratCardState, Partial<LoratCardState>>
