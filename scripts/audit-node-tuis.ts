#!/usr/bin/env -S node --experimental-strip-types
import { existsSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { spawn as spawnPty } from "node-pty"

type Check = { id: string; staticIssues: string[]; smokeIssues: string[] }
const root = resolve(import.meta.dirname, "..")
const nodesRoot = resolve(root, "packages", "nodes")
const smoke = !process.argv.includes("--static-only")
const timeoutMs = Number(process.env.XIRANITE_TUI_AUDIT_TIMEOUT_MS ?? 4_000)
const only = new Set((argument("--only") ?? "").split(",").map((value) => value.trim()).filter(Boolean))

const results: Check[] = []
for (const entry of (await readdir(nodesRoot, { withFileTypes: true })).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const dir = resolve(nodesRoot, entry.name), cliPath = resolve(dir, "src", "cli.ts")
  if (!existsSync(cliPath)) continue
  if (only.size && !only.has(entry.name)) continue
  const result: Check = { id: entry.name, staticIssues: [], smokeIssues: [] }
  const tuiPath = resolve(dir, "src", "Tui.tsx"), packagePath = resolve(dir, "package.json")
  if (!existsSync(tuiPath)) result.staticIssues.push("missing Tui.tsx")
  const [cli, tui, pkg] = await Promise.all([readFile(cliPath, "utf8"), existsSync(tuiPath) ? readFile(tuiPath, "utf8") : Promise.resolve(""), readFile(packagePath, "utf8")])
  if (!/export\s+(?:const|let|var)\s+cli\b|export\s*\{[^}]*\bcli\b/.test(cli)) result.staticIssues.push("CLI does not export the aggregate `cli` command")
  if (!/runTerminalUi/.test(cli) || !/loadScreen/.test(cli)) result.staticIssues.push("CLI is not routed to a package-owned OpenTUI screen")
  if (!/\.\/interaction/.test(pkg)) result.staticIssues.push("package does not export ./interaction")
  if (!/TerminalUiScreenProps/.test(tui) || !/@xiranite\/cli-runtime\/terminal\/opentui/.test(tui)) result.staticIssues.push("TUI is not a direct shared OpenTUI composition")
  if (!/useTerminalChromeActions/.test(tui)) result.staticIssues.push("missing shared Reset/Exit/Help/Queue/Config chrome")
  if (!/terminalIcon\(|[◉○◇◆■□▶✓×⌕▣▦⊘♙]/u.test(tui)) result.staticIssues.push("missing portable Unicode semantic icons")
  if (!/(WorkbenchPanel|ActionTabs|ActionLauncher|ExecutionActions|WorkbenchField|ClickTarget)/.test(tui)) result.staticIssues.push("does not use shared termcn/OpenTUI components")
  if (containsMojibake(tui)) result.staticIssues.push("contains mojibake/broken Chinese text")
  const testPath = [
    resolve(dir, "src", "Tui.bun.test.tsx"),
    resolve(dir, "src", "testing", "Tui.bun.test.tsx"),
  ].find((path) => existsSync(path))
  if (!testPath) result.staticIssues.push("missing OpenTUI test")
  else {
    const test = await readFile(testPath, "utf8")
    if (!/mockMouse\.(click|drag|scroll)|runCliMouseScenario/.test(test)) result.staticIssues.push("test does not exercise mouse interaction")
    if (containsMojibake(test)) result.staticIssues.push("TUI test asserts mojibake instead of valid text")
  }
  const reviewPath = resolve(root, "docs", `${entry.name}-tui-visual-review.md`)
  if (!existsSync(reviewPath)) result.staticIssues.push("missing TUI visual review document")
  if (smoke) result.smokeIssues.push(...await smokeTui(entry.name, resolve(dir, "dist", "cli.js"), tui))
  results.push(result)
}

const failed = results.filter((result) => result.staticIssues.length || result.smokeIssues.length)
for (const result of results) {
  const issues = [...result.staticIssues.map((item) => `static: ${item}`), ...result.smokeIssues.map((item) => `pty: ${item}`)]
  process.stdout.write(`${issues.length ? "FAIL" : "PASS"} ${result.id}${issues.length ? `\n  - ${issues.join("\n  - ")}` : ""}\n`)
}
process.stdout.write(`\nSummary: ${results.length - failed.length}/${results.length} pass; ${failed.length} require work.\n`)
// node-pty can retain a libuv handle briefly after Ctrl+C. This is a one-shot
// audit process, so exit deliberately after the report instead of making CI
// wait for a stale pseudo-terminal handle.
process.exit(failed.length ? 1 : 0)

function containsMojibake(value: string): boolean {
  return /�|鈥\?|銆\?|锛\?|[鐨勫鍙戝睍绠＄悊瑙嗛鎵弿鍒嗙被褰掓。杈撳嚭缁撴灉鍛戒护]{3,}/u.test(value)
}

async function smokeTui(id: string, cliPath: string, tui: string): Promise<string[]> {
  if (!existsSync(cliPath)) return ["missing dist/cli.js; build has not been installed"]
  const expected = tui.match(/([A-Z][A-Z0-9]+)\s*\/\/[ A-Z0-9_-]+/)?.[0]
  let output = "", exited = false, exitCode: number | undefined
  const terminal = spawnPty(process.platform === "win32" ? "bun.exe" : "bun", [cliPath, "ui"], { cols: 120, rows: 36, cwd: root, env: { ...process.env, FORCE_COLOR: "1", XIRANITE_FORCE_COLOR: "1" } })
  terminal.onData((data) => { output += data })
  terminal.onExit((event) => { exited = true; exitCode = event.exitCode })
  try {
    await waitUntil(() => output.includes("\u001b[?1049h") || output.includes("\u001b[?1006h"), timeoutMs)
    if (expected) await waitUntil(() => plain(output).includes(expected), timeoutMs)
    else await sleep(100)
    const issues: string[] = []
    if (!output.includes("\u001b[?1049h")) issues.push("did not enter alternate screen")
    if (!output.includes("\u001b[?1006h")) issues.push("did not enable SGR mouse mode")
    if (expected && !plain(output).includes(expected)) issues.push(`missing expected title ${expected}`)
    terminal.write("\u0003")
    try { await waitUntil(() => exited, 2_000) } catch { issues.push("did not exit after Ctrl+C"); safeKill(terminal) }
    if (exitCode !== undefined && exitCode !== 0 && exitCode !== 130) issues.push(`unexpected exit code ${exitCode}`)
    return issues
  } catch (error) {
    safeKill(terminal)
    const tail = plain(output).trim().split(/\r?\n/).slice(-3).join(" | ")
    return [`startup timeout${tail ? `: ${tail}` : ""}`]
  }
}

function plain(value: string): string { return value.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "") }
function waitUntil(predicate: () => boolean, timeout: number): Promise<void> { return new Promise((done, reject) => { const started = Date.now(); const timer = setInterval(() => { if (predicate()) { clearInterval(timer); done() } else if (Date.now() - started >= timeout) { clearInterval(timer); reject(new Error("timeout")) } }, 25) }) }
function safeKill(terminal: ReturnType<typeof spawnPty>) { try { terminal.kill() } catch { /* already closed */ } }
function sleep(ms: number) { return new Promise((done) => setTimeout(done, ms)) }
function argument(flag: string): string | undefined { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1] }
