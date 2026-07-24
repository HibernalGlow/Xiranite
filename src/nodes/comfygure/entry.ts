import type { AppNodeEntry, NodeSchema } from "@xiranite/contract"
import { core, def } from "@xiranite/node-comfygure"
import { z } from "zod"
import { Component } from "./Component"
import type { ComfygureCardState, ComfygureTargetConfig } from "./types"

const cardStateSchema = z.object({
  status: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
  program: z.record(z.string(), z.unknown()).optional(),
  batchText: z.object({ format: z.literal("deflate-base64/v1"), data: z.string(), lineCount: z.number().int().nonnegative(), uncompressedLength: z.number().int().nonnegative() }).optional(),
  template: z.record(z.string(), z.unknown()).optional(),
  templateDiagnostics: z.array(z.record(z.string(), z.unknown())).optional(),
  preview: z.record(z.string(), z.unknown()).optional(),
  preflight: z.record(z.string(), z.unknown()).optional(),
  submission: z.record(z.string(), z.unknown()).optional(),
  submissions: z.array(z.record(z.string(), z.unknown())).optional(),
  history: z.array(z.record(z.string(), z.unknown())).optional(),
}).passthrough()

const configSchema = z.object({
  endpoint: z.string().optional(),
  libraryPath: z.string().optional(),
}).passthrough()

export default {
  def,
  core,
  Component,
  host: { contractVersion: "^1.0.0", capabilities: ["state", "runner", "localFiles", "config", "env"] },
  window: { maximizeBehavior: "fullscreen" },
  schemas: {
    data: cardStateSchema as unknown as NodeSchema<ComfygureCardState>,
    config: configSchema as unknown as NodeSchema<ComfygureTargetConfig>,
  },
} satisfies AppNodeEntry<typeof core, ComfygureCardState, ComfygureTargetConfig>
