import { describe, expect, test } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { startNodeAppBackend } from "./nodeApp.js"

describe("direct node host appearance API", () => {
  test("shares app UI, custom themes, and background appearance through the node-only backend", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-node-appearance-"))
    const dataDir = join(root, "data")
    const previousLocalAppData = process.env.LOCALAPPDATA
    const previousAppData = process.env.APPDATA
    process.env.LOCALAPPDATA = root
    process.env.APPDATA = root
    let backend: Awaited<ReturnType<typeof startNodeAppBackend>> | undefined

    try {
      backend = await startNodeAppBackend({
        nodeId: "neoview",
        snapshotId: "direct-test",
        token: "appearance-token",
        dataDir,
        configPath: join(dataDir, "xiranite.config.toml"),
      })
      const request = (path: string, init?: RequestInit) => fetch(`${backend!.url}${path}`, {
        ...init,
        headers: {
          "x-xiranite-token": "appearance-token",
          ...(init?.body ? { "content-type": "application/json" } : {}),
          ...init?.headers,
        },
      })
      const capabilities = await request("/node-app/capabilities")
      await expect(capabilities.json()).resolves.toMatchObject({ capabilities: expect.arrayContaining(["config", "appearance"]) })

      const savedUi = await request("/config/app/ui", {
        method: "PUT",
        body: JSON.stringify({ config: { appearance: { colorMode: "dark" } } }),
      })
      expect(savedUi.status).toBe(200)
      const loadedUi = await request("/config/app/ui")
      await expect(loadedUi.json()).resolves.toMatchObject({ config: { appearance: { colorMode: "dark" } } })

      const savedThemes = await request("/config/themes", {
        method: "PUT",
        body: JSON.stringify({ themes: [{ name: "Direct host", cssVars: { dark: { primary: "oklch(0.7 0.1 220)" } } }] }),
      })
      expect(savedThemes.status).toBe(200)
      const loadedThemes = await request("/config/themes")
      await expect(loadedThemes.json()).resolves.toMatchObject({ themes: [{ name: "Direct host" }] })

      const savedBackground = await request("/config/bg-image", {
        method: "PUT",
        body: JSON.stringify({ url: "D:/wallpaper.png" }),
      })
      expect(savedBackground.status).toBe(200)
      const loadedBackground = await request("/config/bg-image")
      await expect(loadedBackground.json()).resolves.toMatchObject({ url: "D:/wallpaper.png" })
    } finally {
      await backend?.close()
      if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA
      else process.env.LOCALAPPDATA = previousLocalAppData
      if (previousAppData === undefined) delete process.env.APPDATA
      else process.env.APPDATA = previousAppData
      await removeWithWindowsRetry(root)
    }
  })
})

async function removeWithWindowsRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EBUSY" && attempt === 39) return
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
    }
  }
}
