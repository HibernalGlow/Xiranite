import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import { analyzeHttpSurface, diffHttpSurfaces, type HttpSurfaceInventory } from "./http-surface.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function createProtocolRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-http-surface-"))
  temporaryDirectories.push(root)

  const write = async (path: string, text: string) => {
    await mkdir(join(root, path.split("/").slice(0, -1).join("/")), { recursive: true })
    await writeFile(join(root, path), text, "utf8")
  }

  await write("packages/api/src/index.ts", [
    'export const api = new Elysia()',
    '  .get("/health", () => ({ ok: true }))',
    '  .post("/nodes/:id/operations", async ({ body, params, set }) => run(body, params, set))',
    '  .get("/node-operations/:operationId/stream", ({ params, query }) => stream(params, query))',
    '  .route("/config", configApi)',
    '',
  ].join("\n"))
  await write("packages/backend/src/ignored.test.ts", 'api.get("/should-not-appear", () => 1)\n')
  await write("packages/shared/src/index.ts", [
    'import { z } from "zod"',
    'export const nodeRunEventSchema = z.object({',
    '  type: z.enum(["progress", "log"]),',
    '  message: z.string(),',
    '  progress: z.number().optional(),',
    '})',
    'export const nodeOperationStreamMessageSchema = z.object({',
    '  type: z.literal("event"),',
    '  index: z.number(),',
    '})',
    '',
  ].join("\n"))
  await write("packages/contract/src/index.ts", [
    'export interface ResourceTaskRequest {',
    '  resource: string',
    '  weight?: number',
    '}',
    '',
  ].join("\n"))

  return root
}

describe("HTTP surface AST inventory", () => {
  test("lists routes, request context, DTO fields and z.enum event discriminators", async () => {
    const root = await createProtocolRepo()
    const inventory = await analyzeHttpSurface({ repoRoot: root, side: "legacy" })

    expect(inventory.schemaVersion).toBe(1)
    expect(inventory.scannedRoots).toEqual([
      "packages/api/src",
      "packages/backend/src",
      "packages/contract/src",
      "packages/shared/src",
    ])

    const keys = inventory.routes.map((route) => `${route.method} ${route.path}`)
    expect(keys).toContain("get /health")
    expect(keys).toContain("post /nodes/:id/operations")
    expect(keys).toContain("get /node-operations/:operationId/stream")
    expect(keys).not.toContain("get /should-not-appear")

    const stream = inventory.routes.find((route) => route.path === "/node-operations/:operationId/stream")
    expect(stream?.context).toEqual(["params", "query"])
    expect(inventory.groups.map((group) => group.path)).toContain("/config")

    const fields = inventory.dtoFields.map((field) => `${field.symbol}.${field.field}`)
    expect(fields).toContain("ResourceTaskRequest.resource")
    expect(inventory.dtoFields.find((field) => field.symbol === "ResourceTaskRequest" && field.field === "weight")?.optional).toBe(true)
    expect(fields).toContain("nodeRunEventSchema.message")

    // z.enum is the real run-event discriminator; a literal-only reader reports zero events.
    const events = inventory.events.map((event) => `${event.symbol}.${event.property}=${event.value}`)
    expect(events).toContain("nodeRunEventSchema.type=progress")
    expect(events).toContain("nodeRunEventSchema.type=log")
    expect(events).toContain("nodeOperationStreamMessageSchema.type=event")
    expect(inventory.summary.events).toBe(inventory.events.length)
  })

  test("refuses to scan a tree without the configured roots instead of reporting a clean surface", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-http-surface-empty-"))
    temporaryDirectories.push(root)
    await expect(analyzeHttpSurface({ repoRoot: root, side: "legacy" })).rejects.toThrow(/None of the configured HTTP surface roots/)
  })

  test("diffs both directions: a missing route and a route the Rust side invented", async () => {
    const root = await createProtocolRepo()
    const legacy = await analyzeHttpSurface({ repoRoot: root, side: "legacy" })

    expect(diffHttpSurfaces(legacy, legacy)).toEqual([])

    const drifted = structuredClone(legacy) as HttpSurfaceInventory
    drifted.routes = drifted.routes.filter((route) => route.path !== "/health")
    drifted.routes.push({ method: "post", path: "/invented", file: "crates/xiranite-api/src/lib.rs", line: 1, context: [] })
    drifted.events = drifted.events.filter((event) => event.value !== "log")

    const problems = diffHttpSurfaces(legacy, drifted)
    expect(problems).toContain("route missing in the Rust side: get /health")
    expect(problems).toContain("route only exists in the Rust side: post /invented")
    expect(problems).toContain("NDJSON event discriminator missing in the Rust side: nodeRunEventSchema type=log")
  })
})
