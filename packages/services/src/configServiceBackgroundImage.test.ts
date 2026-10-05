import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, test, vi } from "vitest"

import { ConfigService } from "./configService.js"

/**
 * 背景图入库的体积闸。
 *
 * 界面侧已经会压缩，这里守的是「绕过界面的写入」：一条巨型 data URL 会常驻 SQLite，
 * 并在每次启动被读回灌进前端 store，正是把内存打满的那条路。
 */
describe("config service background image cap", () => {
  test("rejects an oversized data URL without writing it to the kv store", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-bg-cap-"))
    const stored = new Map<string, string>()
    const setKvValue = vi.fn(async (key: string, value: string) => {
      stored.set(key, value)
    })
    try {
      const service = new ConfigService({
        configPath: join(root, "xiranite.config.toml"),
        kvRepository: {
          getKvValue: async (key: string) => stored.get(key) ?? null,
          setKvValue,
          deleteKvValue: async (key: string) => {
            stored.delete(key)
          },
        },
      })
      const oversized = `data:image/png;base64,${"A".repeat(5 * 1024 * 1024)}`

      await expect(service.saveBackgroundImage(oversized)).rejects.toThrow(/too large/)
      expect(setKvValue).not.toHaveBeenCalled()
      expect(stored.size).toBe(0)

      // 阳性对照：同一支 service 必须允许正常体积写入，否则上面那条红是瞎尺。
      await service.saveBackgroundImage("D:/wallpaper.png")
      expect(stored.get("bgImageUrl")).toBe("D:/wallpaper.png")

      await service.saveBackgroundImage(null)
      expect(stored.size).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
