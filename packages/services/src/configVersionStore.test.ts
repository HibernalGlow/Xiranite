import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { parseToml } from "@xiranite/config"
import { ConfigService } from "./configService.js"
import { GitConfigVersionStore } from "./configVersionStore.js"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { force: true, recursive: true })))
})

describe("GitConfigVersionStore", () => {
  test("records a baseline and de-duplicates unchanged snapshots", async () => {
    const repositoryPath = await tempDirectory("xiranite-config-history-")
    const store = new GitConfigVersionStore({ repositoryPath })
    const before = config({ neoview: { theme: "paper" } })
    const after = config({ neoview: { theme: "dark" } })

    const version = await store.record({
      nodeId: "neoview",
      source: "config-center",
      before,
      after,
    })
    const duplicate = await store.record({
      nodeId: "neoview",
      source: "config-center",
      before: after,
      after,
    })

    expect(version).toMatchObject({ nodeId: "neoview", source: "config-center" })
    expect(duplicate).toBeNull()
    expect(await store.listNode("neoview")).toHaveLength(1)
  })

  test("filters the global repository by node metadata and returns semantic detail", async () => {
    const repositoryPath = await tempDirectory("xiranite-config-history-")
    const store = new GitConfigVersionStore({ repositoryPath })
    const baseline = config({
      neoview: { reader: { columns: 2 }, theme: "paper" },
      xlchemy: { format: "png" },
    })
    const neoviewUpdate = config({
      neoview: { reader: { columns: 4 }, theme: "dark" },
      xlchemy: { format: "png" },
    })
    const xlchemyUpdate = config({
      neoview: { reader: { columns: 4 }, theme: "dark" },
      xlchemy: { format: "webp" },
    })

    const neoviewVersion = await store.record({
      nodeId: "neoview",
      source: "config-center",
      before: baseline,
      after: neoviewUpdate,
    })
    await store.record({
      nodeId: "xlchemy",
      source: "node-runtime",
      before: neoviewUpdate,
      after: xlchemyUpdate,
    })

    expect(await store.listNode("neoview")).toHaveLength(1)
    expect(await store.listNode("xlchemy")).toHaveLength(1)

    const detail = await store.inspectNode("neoview", neoviewVersion!.revision)
    expect(detail.before).toEqual({ reader: { columns: 2 }, theme: "paper" })
    expect(detail.after).toEqual({ reader: { columns: 4 }, theme: "dark" })
    expect(detail.delta).toBeTruthy()
    expect(detail.patch).toContain("nodes.neoview")
  }, 15_000)

  test("redacts sensitive values before committing them", async () => {
    const repositoryPath = await tempDirectory("xiranite-config-history-")
    const store = new GitConfigVersionStore({ repositoryPath })
    const secret = "do-not-commit-this-token"

    const version = await store.record({
      nodeId: "synct",
      source: "config-center",
      before: config({ synct: { endpoint: "local", token: secret } }),
      after: config({ synct: { endpoint: "remote", token: secret } }),
    })

    const detail = await store.inspectNode("synct", version!.revision)
    expect(JSON.stringify(detail)).not.toContain(secret)
    expect(detail.after).toEqual({ endpoint: "remote", token: "[REDACTED]" })

    const trackedSnapshot = await readFile(join(repositoryPath, "xiranite.config.toml"), "utf8")
    expect(trackedSnapshot).not.toContain(secret)
  })
})

describe("ConfigService config history", () => {
  test("restores only the selected node and preserves current secrets and other nodes", async () => {
    const root = await tempDirectory("xiranite-config-restore-")
    const configPath = join(root, "xiranite.config.toml")
    const versions = new GitConfigVersionStore({ repositoryPath: join(root, "history") })
    const service = new ConfigService({ configPath, configVersions: versions })

    await service.updateNodeConfig("neoview", { theme: "paper", token: "first-secret" })
    const oldVersion = (await service.getNodeConfigVersions("neoview")).versions[0]!
    await service.updateNodeConfig("neoview", { theme: "dark", token: "current-secret" })
    await service.updateNodeConfig("xlchemy", { format: "webp" })

    await service.restoreNodeConfigVersion("neoview", oldVersion.revision)

    const current = parseToml(await readFile(configPath, "utf8")) as {
      nodes: Record<string, Record<string, unknown>>
    }
    expect(current.nodes.neoview).toEqual({ theme: "paper", token: "current-secret" })
    expect(current.nodes.xlchemy).toEqual({ format: "webp" })
  }, 15_000)
})

function config(nodes: Record<string, unknown>) {
  return { nodes }
}

async function tempDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(path)
  return path
}
