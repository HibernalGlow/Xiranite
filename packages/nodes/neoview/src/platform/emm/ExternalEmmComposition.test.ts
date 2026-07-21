import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { afterEach, describe, expect, it } from "vitest"
import { createReaderHttpController } from "../../platform.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("external EMM composition", () => {
  it("[neoview.emm.external-composition] hydrates File Card directory entries from configured Mangas data without a thumbnails cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-external-emm-"))
    roots.push(root)
    const bookPath = join(root, "Book.cbz")
    const emmPath = join(root, "database.sqlite")
    await writeFile(bookPath, new Uint8Array())
    const database = new DatabaseSync(emmPath)
    database.exec("CREATE TABLE Mangas (filepath TEXT, rating REAL, tags JSON, pageCount INTEGER)")
    database.prepare("INSERT INTO Mangas VALUES (?1, ?2, ?3, ?4)").run(bookPath, 4.8, JSON.stringify({ artist: ["Alice"], language: ["chinese"] }), 28)
    database.close()

    const controller = await createReaderHttpController({
      baseUrl: "http://127.0.0.1:43127",
      token: "runtime-token",
      configPath: join(root, "missing.toml"),
      legacyThumbnailDatabasePath: join(root, "thumbnails.db"),
      legacyEmmDatabasePaths: [emmPath],
    })
    try {
      const opened = await json(controller, "/reader/browser/sessions", "POST", { path: root }) as { sessionId: string }
      const page = await json(controller, `/reader/browser/s/${opened.sessionId}/entries?cursor=0&limit=16&fields=rating,tags,pageCount`) as {
        entries: { path: string; rating?: number; tags?: string[]; pageCount?: number }[]
      }
      expect(page.entries.find((entry) => entry.path === bookPath)).toMatchObject({
        rating: 4.8,
        tags: ["artist:Alice", "language:chinese"],
        pageCount: 28,
      })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.emm.config-composition] loads the configured EMM path from [nodes.neoview.emm]", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-configured-emm-"))
    roots.push(root)
    const bookPath = join(root, "Configured.cbz")
    const emmPath = join(root, "configured.sqlite")
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(bookPath, new Uint8Array())
    const database = new DatabaseSync(emmPath)
    database.exec("CREATE TABLE Mangas (filepath TEXT, rating REAL, tags JSON, pageCount INTEGER)")
    database.prepare("INSERT INTO Mangas VALUES (?1, ?2, ?3, ?4)").run(bookPath, 4.6, JSON.stringify({ artist: ["Configured"] }), 16)
    database.close()
    await writeFile(configPath, `[nodes.neoview.emm]\nenabled = true\ndatabase_paths = [${JSON.stringify(emmPath.replaceAll("\\", "/"))}]\n`)

    const controller = await createReaderHttpController({
      baseUrl: "http://127.0.0.1:43127",
      token: "runtime-token",
      configPath,
      legacyThumbnailDatabasePath: join(root, "thumbnails.db"),
    })
    try {
      const opened = await json(controller, "/reader/browser/sessions", "POST", { path: root }) as { sessionId: string }
      const page = await json(controller, `/reader/browser/s/${opened.sessionId}/entries?cursor=0&limit=16&fields=rating,tags`) as {
        entries: { path: string; rating?: number; tags?: string[] }[]
      }
      expect(page.entries.find((entry) => entry.path === bookPath)).toMatchObject({ rating: 4.6, tags: ["artist:Configured"] })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })

  it("[neoview.emm-config.live-reconfigure] probes and switches the active read-only database without restarting", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-live-emm-"))
    roots.push(root)
    const bookPath = join(root, "Live.cbz")
    const firstPath = join(root, "first.sqlite")
    const secondPath = join(root, "second.sqlite")
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(bookPath, new Uint8Array())
    createEmmDatabase(firstPath, bookPath, 2.1, "First")
    createEmmDatabase(secondPath, bookPath, 4.9, "Second")
    await writeFile(configPath, `[nodes.neoview.emm]\nenabled = true\ndatabase_paths = [${JSON.stringify(firstPath.replaceAll("\\", "/"))}]\n`)

    const controller = await createReaderHttpController({
      baseUrl: "http://127.0.0.1:43127",
      token: "runtime-token",
      configPath,
      legacyThumbnailDatabasePath: join(root, "thumbnails.db"),
    })
    try {
      const opened = await json(controller, "/reader/browser/sessions", "POST", { path: root }) as { sessionId: string }
      const entriesPath = `/reader/browser/s/${opened.sessionId}/entries?cursor=0&limit=16&fields=rating,tags`
      expect(findEntry(await json(controller, entriesPath), bookPath)).toMatchObject({ rating: 2.1, tags: ["artist:First"] })

      const probe = await json(controller, "/reader/emm/config/probe", "POST", { emm: { databasePaths: [secondPath] } }) as {
        connected: boolean
        sources: { path: string; status: string; readOnly: boolean }[]
      }
      expect(probe).toEqual({
        enabled: true,
        automatic: false,
        connected: true,
        readOnly: true,
        sources: [{ path: secondPath, status: "compatible", readOnly: true }],
      })

      await json(controller, "/reader/config", "PATCH", { emm: { databasePaths: [secondPath] } })
      expect(findEntry(await json(controller, entriesPath), bookPath)).toMatchObject({ rating: 4.9, tags: ["artist:Second"] })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function createEmmDatabase(path: string, bookPath: string, rating: number, artist: string): void {
  const database = new DatabaseSync(path)
  database.exec("CREATE TABLE Mangas (filepath TEXT, rating REAL, tags JSON, pageCount INTEGER)")
  database.prepare("INSERT INTO Mangas VALUES (?1, ?2, ?3, ?4)").run(bookPath, rating, JSON.stringify({ artist: [artist] }), 1)
  database.close()
}

function findEntry(value: unknown, path: string): { path: string; rating?: number; tags?: string[] } | undefined {
  return (value as { entries: { path: string; rating?: number; tags?: string[] }[] }).entries.find((entry) => entry.path === path)
}

async function json(
  controller: Awaited<ReturnType<typeof createReaderHttpController>>,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  const init: RequestInit = {
    method,
    headers: { "x-xiranite-token": "runtime-token", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
  const response = await controller.handle(new Request(`http://127.0.0.1:43127${path}`, init))
  expect(response?.status).toBe(method === "POST" && path.endsWith("/sessions") ? 201 : 200)
  return response!.json()
}
