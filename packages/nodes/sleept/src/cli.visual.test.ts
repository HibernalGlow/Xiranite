import { access, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, test } from "vitest"
import { captureCliVisual, expectCliVisualArtifacts, runCliMouseScenario } from "../../../../scripts/cli-visual-testing.ts"

const CLI_PATH = fileURLToPath(new URL("./cli.ts", import.meta.url))
const SAFE_UI_CLI_PATH = fileURLToPath(new URL("../../../../scripts/fixtures/sleept-safe-ui-cli.ts", import.meta.url))

afterEach(() => {
  process.exitCode = 0
})

describe("sleept Ink UI visual capture", () => {
  test("captures the shared Chinese schema with a Termcn theme", async () => {
    const capture = await captureCliVisual({
      nodeId: "sleept",
      cliPath: CLI_PATH,
      args: ["ui", "--renderer", "ink", "--lang", "zh", "--theme", "dracula"],
      artifactName: "ui-ink-zh-dracula",
      waitForText: "触发序列",
    })

    expect(capture.plainText).toContain("Sleept")
    expect(capture.plainText).toContain("触发序列")
    expect(capture.plainText).toContain("系统待命")
    expect(capture.plainText).toContain("执行动作")
    expect(capture.plainText).toContain("定时模式")
    expect(capture.plainText).toContain("倒计时")
    expect(capture.plainText).toContain("网络")
    expect(capture.plainText).toContain("CPU")
    expect(capture.plainText).toContain("Ink")
    expect(capture.plainText).not.toContain("步骤")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    expect(capture.html).not.toMatch(/\u001b|\?25|DABx/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)

  test("captures the matching fullscreen OpenTUI workbench", async () => {
    const capture = await captureCliVisual({
      nodeId: "sleept",
      cliPath: CLI_PATH,
      args: ["ui", "--renderer", "opentui", "--lang", "zh", "--theme", "dracula"],
      artifactName: "ui-opentui-zh-dracula",
      waitForText: "触发序列",
    })

    expect(capture.plainText).toContain("Sleept")
    expect(capture.plainText).toContain("OpenTUI")
    expect(capture.plainText).toContain("触发序列")
    expect(capture.plainText).toContain("系统待命")
    expect(capture.plainText).toContain("执行动作")
    expect(capture.plainText).not.toContain("步骤")
    expect(capture.ansi).toMatch(/\u001b\[[0-9;?]*[A-Za-z]/)
    await expectCliVisualArtifacts(capture)
  }, 30_000)

  test("drives the Ink workbench entirely through real PTY mouse events", async () => {
    const root = await mkdtemp(join(tmpdir(), "sleept-ink-mouse-"))
    const configPath = join(root, "xiranite.config.toml")
    const liveSentinelPath = join(root, "live-execution-attempted.txt")
    await writeFile(configPath, [
      "[nodes.sleept]",
      'timerMode = "countdown"',
      'power_mode = "sleep"',
      "hours = 0",
      "minutes = 0",
      "seconds = 5",
      "dryrun = true",
    ].join("\n"), "utf8")

    const scenario = await runCliMouseScenario({
      cliPath: SAFE_UI_CLI_PATH,
      args: ["ui", "--renderer", "ink", "--lang", "zh", "--theme", "dracula"],
      env: {
        XIRANITE_CONFIG_PATH: configPath,
        XIRANITE_TEST_LIVE_SENTINEL: liveSentinelPath,
      },
      initialWaitFor: "开始演练",
      timeoutMs: 8_000,
      steps: [
        { clickText: "网络", region: { maxX: 35, maxY: 12 }, waitForText: "上传阈值" },
        { clickText: "倒计时", region: { maxX: 35, maxY: 12 }, waitForText: "小时" },
        { clickText: "否", region: { minX: 65, maxY: 14 }, waitForText: "开始执行" },
        { clickText: "开始执行", region: { minX: 65, maxY: 16 }, waitForText: "确认真实执行" },
        { clickText: "返回检查", region: { minX: 65, maxY: 18 }, waitForText: "开始执行", waitForAbsentText: "确认真实执行" },
        { clickText: "是", region: { minX: 65, maxY: 14 }, waitForText: "开始演练" },
        { clickText: "开始演练", region: { minX: 65, maxY: 16 }, waitForText: "停止" },
        { clickText: "停止", region: { minX: 65, maxY: 16 }, waitForAbsentText: "停止" },
        { clickText: "日志", region: { minY: 15 }, waitForText: "remaining" },
      ],
    })

    expect(scenario.clicks).toHaveLength(9)
    expect(scenario.finalScreen).toContain("remaining")
    expect(scenario.ansi).toContain("\u001b[?1049h")
    expect(scenario.ansi).toContain("\u001b[?1049l")
    expect(scenario.ansi).toContain("\u001b[?1006h")
    await expect(access(liveSentinelPath)).rejects.toThrow()
  }, 30_000)
})
