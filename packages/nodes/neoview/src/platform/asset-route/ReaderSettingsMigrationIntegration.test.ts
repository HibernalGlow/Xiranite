import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createReaderHttpController } from "../../platform.js"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Reader settings migration HTTP integration", () => {
  it("[neoview.settings.http-integration] previews without writes and imports non-destructively through the shared config store", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-neoview-settings-http-"))
    roots.push(root)
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.neoview.custom]",
      "keep = true",
      "",
    ].join("\n"), "utf8")
    const controller = await createReaderHttpController({
      baseUrl: "http://127.0.0.1:41000",
      token: "secret",
      configPath,
      legacyThumbnailDatabasePath: false,
    })
    const content = JSON.stringify({
      format: "NeoView/1.0",
      config: { system: { language: "zh-CN" }, book: { readingDirection: "right-to-left" } },
    })
    try {
      const before = await readFile(configPath, "utf8")
      const unauthorized = await controller.handle(jsonRequest("/reader/settings/migration/inspect", { content }, false))
      expect(unauthorized?.status).toBe(401)
      const preview = (await controller.handle(jsonRequest("/reader/settings/migration/inspect", { content })))!
      expect(preview.status).toBe(200)
      expect(await readFile(configPath, "utf8")).toBe(before)

      const imported = (await controller.handle(jsonRequest("/reader/settings/migration/import", {
        content,
        modules: ["native-settings"],
        strategy: "merge",
        confirmed: true,
      })))!
      expect(imported.status).toBe(200)
      const responseText = await imported.text()
      expect(responseText).not.toContain(configPath)
      expect(JSON.parse(responseText)).toMatchObject({ changed: true, backupCreated: true, strategy: "merge" })
      const written = await readFile(configPath, "utf8")
      expect(written).toContain("[nodes.neoview.custom]")
      expect(written).toContain("keep = true")
      expect(written).toContain('reading_direction = "right-to-left"')

      const repeated = (await controller.handle(jsonRequest("/reader/settings/migration/import", {
        content,
        strategy: "merge",
        confirmed: true,
      })))!
      await expect(repeated.json()).resolves.toMatchObject({ changed: false })
    } finally {
      await controller[Symbol.asyncDispose]()
    }
  })
})

function jsonRequest(path: string, body: unknown, authorized = true): Request {
  const headers = new Headers({ "content-type": "application/json" })
  if (authorized) headers.set("x-xiranite-token", "secret")
  return new Request(`http://127.0.0.1:41000${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}
