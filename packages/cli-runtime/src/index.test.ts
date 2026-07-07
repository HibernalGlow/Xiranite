import { describe, expect, test } from "vitest"
import { nodeCliName, normalizeNodeCliName, renderCliEvent, renderProgressBar, renderRichPanel, visibleWidth, writeCliEvent } from "./index.js"
import type { CliHost } from "./index.js"

describe("cli-runtime", () => {
  test("derives short node command names and normalizes legacy names", () => {
    expect(nodeCliName("repacku")).toBe("xrepacku")
    expect(normalizeNodeCliName("xrepacku")).toBe("repacku")
    expect(normalizeNodeCliName("xiranite-repacku")).toBe("repacku")
  })

  test("renders rich panels within terminal width", () => {
    const host = createHost({ columns: 34 })
    const panel = renderRichPanel(host, "EngineV", ["本地图片直通", "E:/SteamLibrary/workshop/content/431960"], {
      minWidth: 18,
    })

    expect(panel).toContain("EngineV")
    expect(panel).toContain("本地图片直通")
    for (const line of panel.split(/\r?\n/)) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(34)
    }
  })

  test("renders progress bars that remain meaningful without color", () => {
    const host = createHost({ columns: 48 })
    const line = renderProgressBar(host, 40, "扫描 本地预览图", { width: 10, label: "enginev" })

    expect(line).toContain("enginev")
    expect(line).toContain("━━━━──────")
    expect(line).toContain(" 40%")
    expect(line).toContain("扫描 本地预览图")
    expect(visibleWidth(line)).toBeLessThanOrEqual(48)
  })

  test("formats and writes node run events through the shared rich event output", () => {
    const host = createHost({ columns: 36 })

    expect(renderCliEvent(host, { type: "log", message: "普通日志" })).toBe("普通日志")
    writeCliEvent(host, { type: "progress", progress: 100, message: "完成 EngineV 图片加载" }, {
      label: "enginev",
      progressWidth: 8,
    })

    expect(host.output).toHaveLength(1)
    expect(host.output[0]).toContain("enginev")
    expect(host.output[0]).toContain("━━━━━━━━")
    expect(host.output[0]).toContain("100%")
  })
})

function createHost(options: { columns?: number } = {}): CliHost & { output: string[]; errorOutput: string[] } {
  const output: string[] = []
  const errorOutput: string[] = []
  return {
    cwd: "D:/work",
    env: {},
    stdin: { isTTY: false } as CliHost["stdin"],
    stdout: {
      columns: options.columns ?? 80,
      isTTY: false,
      write: (chunk: string) => {
        output.push(String(chunk).replace(/\n$/, ""))
        return true
      },
    },
    stderr: {
      columns: options.columns ?? 80,
      isTTY: false,
      write: (chunk: string) => {
        errorOutput.push(String(chunk).replace(/\n$/, ""))
        return true
      },
    },
    output,
    errorOutput,
  }
}
