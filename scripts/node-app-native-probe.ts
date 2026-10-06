#!/usr/bin/env bun
import { parseArgs } from "node:util"

const parsed = parseArgs({
  args: process.argv.slice(2),
  options: {
    module: { type: "string" },
    "export-name": { type: "string" },
  },
})

const moduleName = parsed.values.module
const exportName = parsed.values["export-name"]
if (!moduleName || !exportName) throw new Error("--module and --export-name are required.")

const loaded = await import(moduleName) as Record<string, unknown>
const probe = loaded[exportName]
if (typeof probe !== "function") throw new Error(`Native probe ${exportName} was not exported by ${moduleName}.`)
const result = await probe()
if (result === undefined) throw new Error(`Native probe ${exportName} from ${moduleName} returned undefined.`)
console.log(`[node-app] Native probe ${moduleName}.${exportName} passed`)
