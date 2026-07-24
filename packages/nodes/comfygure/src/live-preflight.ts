#!/usr/bin/env bun
import { parseArgs } from "node:util"
import { fileURLToPath } from "node:url"

import {
  compileAnimaInt8Program,
  normalizeComfyuiEndpoint,
  preflightComfyuiTarget,
} from "./core.js"
import { createNodeComfygureRuntime } from "./platform.js"

interface LivePreflightOptions {
  endpoint: string
}

export function parseLivePreflightOptions(argv: readonly string[]): LivePreflightOptions {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      endpoint: { type: "string", default: "http://127.0.0.1:8000" },
    },
  })
  return { endpoint: normalizeComfyuiEndpoint(values.endpoint) }
}

export async function runLivePreflight(options: LivePreflightOptions): Promise<boolean> {
  const compiled = compileAnimaInt8Program()
  const report = await preflightComfyuiTarget(compiled, { endpoint: options.endpoint }, createNodeComfygureRuntime())
  const compatible = report.online && report.missingClasses.length === 0 && report.missingResources.length === 0
  process.stdout.write(`${JSON.stringify({
    endpoint: report.endpoint,
    online: report.online,
    compatible,
    graphNodeCount: Object.keys(compiled.graph).length,
    requiredClasses: compiled.requiredClasses,
    missingClasses: report.missingClasses,
    missingResources: report.missingResources,
    uncheckedResources: report.uncheckedResources,
    warnings: report.warnings,
  }, null, 2)}\n`)
  return compatible
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseLivePreflightOptions(process.argv.slice(2))
  const compatible = await runLivePreflight(options).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return false
  })
  if (!compatible) process.exitCode = 1
}
