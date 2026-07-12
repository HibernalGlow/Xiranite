import type { AppNodeEntry, NodeSchema } from "@xiranite/contract"
import { core, def } from "@xiranite/node-xlchemy"
import { z } from "zod"
import { Component } from "./Component"
import type { XlchemyCardState } from "./types"

const dataSchema = z.object({
  action: z.enum(["plan", "convert"]).optional(),
  pathsText: z.string().optional(),
  format: z.enum(["JPEG XL", "AVIF", "WebP", "PNG", "TIFF", "JPEG"]).optional(),
  lossless: z.boolean().optional(),
  quality: z.number().optional(),
  effort: z.number().optional(),
  threads: z.number().optional(),
  outputMode: z.enum(["source", "directory"]).optional(),
  outputDir: z.string().optional(),
  preserveMetadata: z.boolean().optional(),
  preserveStructure: z.boolean().optional(),
  overwrite: z.boolean().optional(),
  recursive: z.boolean().optional(),
  selectedPreset: z.string().optional(),
  phase: z.enum(["idle", "running", "completed", "error"]).optional(),
  progress: z.number().optional(),
  progressText: z.string().optional(),
  currentFile: z.string().optional(),
  logs: z.array(z.string()).optional(),
}).passthrough()

export default {
  def,
  core,
  Component,
  host: { contractVersion: "^1.0.0", capabilities: ["state", "runner", "clipboard", "localFiles", "config", "env"] },
  schemas: { data: dataSchema as unknown as NodeSchema<XlchemyCardState>, config: dataSchema as unknown as NodeSchema<Partial<XlchemyCardState>> },
} satisfies AppNodeEntry<typeof core, XlchemyCardState, Partial<XlchemyCardState>>
