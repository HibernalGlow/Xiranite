#!/usr/bin/env bun
import { readFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import { fileURLToPath } from "node:url"

import {
  DEFAULT_COMFYUI_REQUEST_TIMEOUT_MS,
  compileComfygureTemplate,
  confirmComfygureTemplateBindings,
  importComfyuiWorkflow,
  normalizeComfyuiEndpoint,
} from "./core.js"

interface WorkflowAuditOptions {
  file: string
  endpoint?: string
}

export function parseWorkflowAuditOptions(argv: readonly string[]): WorkflowAuditOptions {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: { endpoint: { type: "string" } },
  })
  const file = positionals[0]?.trim()
  if (!file) throw new Error("Usage: bun run audit:workflow -- <workflow.json> [--endpoint http://127.0.0.1:8000]")
  return { file, endpoint: values.endpoint }
}

export async function runWorkflowAudit(options: WorkflowAuditOptions): Promise<boolean> {
  const source = await readFile(options.file, "utf8")
  const objectInfo = options.endpoint ? await readObjectInfo(options.endpoint) : undefined
  const imported = importComfyuiWorkflow(source, { objectInfo, name: options.file })
  const errors = imported.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
  let compiledNodeCount: number | undefined
  let remainingDynamicNodes: readonly string[] | undefined
  let compileError: string | undefined
  if (imported.template && errors.length === 0) {
    try {
      const compiled = compileComfygureTemplate(confirmComfygureTemplateBindings(imported.template))
      compiledNodeCount = Object.keys(compiled.graph).length
      remainingDynamicNodes = Object.values(compiled.graph)
        .map((node) => node.class_type)
        .filter((classType) => ["BatchLoadTexts", "GlowDynamicTypedOutputs", "GlowTriggerLoRAStack", "GlowQueueControl", "PromptCleaningMaid", "AnimaPromptFormatter"].includes(classType))
    } catch (error) {
      compileError = error instanceof Error ? error.message : String(error)
    }
  }
  process.stdout.write(`${JSON.stringify({
    file: options.file,
    sourceFormat: imported.sourceFormat,
    repairedSource: imported.repairedSource,
    importedNodeCount: Object.keys(imported.template?.graph ?? {}).length,
    defaultLoraCount: imported.template?.defaultLoras.length ?? 0,
    compiledNodeCount,
    remainingDynamicNodes,
    diagnostics: imported.diagnostics,
    compileError,
  }, null, 2)}\n`)
  return errors.length === 0 && !compileError && (remainingDynamicNodes?.length ?? 0) === 0
}

async function readObjectInfo(endpoint: string): Promise<Record<string, unknown>> {
  const normalizedEndpoint = normalizeComfyuiEndpoint(endpoint)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_COMFYUI_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${normalizedEndpoint}/object_info`, { headers: { accept: "application/json" }, signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("/object_info did not return a node map.")
    return payload as Record<string, unknown>
  } finally {
    clearTimeout(timer)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseWorkflowAuditOptions(process.argv.slice(2))
  const successful = await runWorkflowAudit(options).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return false
  })
  if (!successful) process.exitCode = 1
}
