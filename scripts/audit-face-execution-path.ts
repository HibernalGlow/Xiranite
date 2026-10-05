/**
 * 台账生成器：三个形态里「节点的那一份 core 到底在哪个进程被执行」的现读清单（ADR-0074 §1/§5）。
 *
 * 为什么要有它：终端面按规则只能经 `/operations` 打宿主，core 由宿主内的 QuickJS 求值；但今天大多数
 * `cli.ts`/`Tui.tsx` 仍把 core 当**值**导入并在 Node/Bun 进程里就地跑，于是「实现一份、执行宿主两个」。
 * 判断这件事不能靠肉眼：`packages/nodes/nameu/src/cli.ts` 是压成单行的，带空格的 `import { … } from`
 * 写法看不见它，所以导入分类一律走 AST（`@ast-grep/napi`），与 `scripts/audit-node-cli-surface.ts` 同一条
 * 口径。
 *
 * 「终端面已迁移」= 该节点的 cli/Tui 里（a）没有对 core 的值导入，(b) 没有直接调用清单里那个 `run` 符号，
 * (c) 存在走协议的证据。三者缺一即记 `in-process`。
 *
 * 宿主就绪度是另一条轴，且它决定谁**能**先迁：core bundle 是否构建成功、host bundle 是否已暂存、
 * 该 id 是否进了 Rust 注册表（`registration.rs` 的 `include_str!` 或 builtin-host 的 `NODE_BUNDLES`）。
 * 没进注册表的节点，`/operations` 现在跑不起来，迁移它只能写成 blocked 而不是硬派下去。
 *
 * `--self-check` 是这条尺的阳性对照：已迁移的样本必须判成 migrated，进程内跑的样本必须判成 in-process，
 * 否则脚本非零退出——一把看不见违规的尺不能用来派发子智能体。
 *
 * 用法：`bun scripts/audit-face-execution-path.ts [--self-check]`
 * 产物：`artifacts/face-execution-ledger.json` 与 `docs/migration/face-execution-ledger.md`
 */

import { existsSync, readFileSync } from "node:fs"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

import { parse } from "@ast-grep/napi"

const REPO = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

const MANIFEST_PATH = join(REPO, "artifacts", "node-bundles", "manifest.json")
const TIERS_PATH = join(REPO, "artifacts", "node-host-requirements.json")
const REGISTRATION_PATH = join(REPO, "crates", "xiranite-scripted-nodes", "src", "registration.rs")
const BUILTIN_BUILD_PATH = join(REPO, "crates", "xiranite-builtin-host", "build.rs")
const BUNDLES_DIR = join(REPO, "crates", "xiranite-quickjs-executor", "bundles")
const LEDGER_JSON = join(REPO, "artifacts", "face-execution-ledger.json")
const LEDGER_MD = join(REPO, "docs", "migration", "face-execution-ledger.md")

/** 一个节点在台账里的一行。 */
interface FaceRecord {
  id: string
  faces: string[]
  coreValueImports: string[]
  coreTypeOnly: boolean
  directRunCalls: number
  runtimeFactoryCalls: number
  protocolEvidence: string[]
  verdict: "migrated" | "in-process" | "no-face"
  hostCoreOk: boolean
  hostCoreBytes: number
  hostBundleBytes: number | null
  hostBundleError: string | null
  stagedInBundlesDir: boolean
  registeredInRust: boolean
  tiers: string[]
  canMigrateNow: boolean
  /** 第三面（GUI）：`src/nodes/<id>/` 里对 core 的值导入与直接调用；浏览器里跑业务逻辑同样是第二个执行宿主。 */
  guiFiles: string[]
  guiCoreValueImports: string[]
  guiRunCalls: number
  /** GUI 目录里有与 HEAD 不同的内容 = UI 那条 lane 正握着这些文件。 */
  guiDirty: string[]
  /** 带 core 值导入/调用的具体 GUI 文件，以及它们各自是否被人握着——派发只看这一列，不看整目录。 */
  guiOffendingFiles: { path: string; dirty: boolean }[]
  /**
   * core 被改了、但 `bundles/<id>.js` 没跟着重建 = 宿主内嵌的还是旧引擎文本。
   * 这种节点的「已注册」不能当证据用：注册表说的是旧那份。迁移派发前必须先看这列。
   */
  coreChangedBundleStale: boolean
  /** face 文件上有未提交改动 = 别的会话正在写这几个文件，派发会撞车。 */
  faceDirty: string[]
  dispatchable: boolean
  blocker: string | null
  wave: "A" | "B" | "C" | "-"
}

/**
 * `./core.js`、`./core`、`@xiranite/node-x/core` 都算 core。**裸包名 `@xiranite/node-x` 也算**：实测 30/30 节点包的
 * `src/index.ts` 写着 `export * from "./core.js"`，从包根取值就把整份 core 图拉进这个面的 chunk。
 * 这条原先不在判据里，是尺的盲点——三个写手各自独立指出，连被当参考的 `src/nodes/dissolvef/entry.ts:2` 也带着它。
 */
function isCoreSource(source: string, id: string): boolean {
  return /^(\.\/core(\.js)?|@xiranite\/node-[a-z0-9]+\/core(\.js)?)$/.test(source)
    || source === `@xiranite/node-${id}`
}

/**
 * face 文件上是否有**与 HEAD 不同的内容** = 别的会话正在写这几个文件，派发会撞车。
 * 这里不用 `git status --porcelain`：它会把 Butler 索引的陈旧状态也报成脏（实测 `clipm` 报 1 行而
 * `git diff HEAD` 为空），虚报脏就等于把可派的活锁死。内容差才是证据。
 */
function dirtyFaceFiles(id: string, faces: string[]): string[] {
  if (faces.length === 0) return []
  const paths = faces.map((face) => `packages/nodes/${id}/src/${face}`)
  let out: string
  try {
    out = execFileSync("git", ["diff", "HEAD", "--name-only", "--", ...paths], { cwd: REPO, encoding: "utf8" })
  } catch {
    return ["git diff 不可用"]
  }
  return out.split("\n").filter((line) => line.trim() !== "").map((line) => line.split("/").pop() ?? line)
}

/** 与 HEAD 相比内容不同的路径；空数组 = 这些文件当前没人握着。 */
function changedAgainstHead(relPaths: string[]): string[] {
  if (relPaths.length === 0) return []
  try {
    return execFileSync("git", ["diff", "HEAD", "--name-only", "--", ...relPaths], { cwd: REPO, encoding: "utf8" })
      .split("\n")
      .filter((line) => line.trim() !== "")
  } catch {
    return ["git diff 不可用"]
  }
}

/** 从源码文本分类一面：core 的值/类型导入、对清单里 `run` 符号的直接调用、走协议的证据。 */
function classifyFaceSource(source: string, id: string, runSymbol: string, runtimeSymbol?: string) {
  const root = parse("typescript", source).root()
  const coreValueImports: string[] = []
  let coreTypeOnly = false
  for (const statement of root.findAll({ rule: { kind: "import_statement" } })) {
    const text = statement.text()
    const sourceNode = statement.field("source") ?? statement.children().find((child) => child.kind() === "string")
    const raw = sourceNode?.text().slice(1, -1) ?? ""
    if (!isCoreSource(raw, id)) continue
    if (/^import\s+type\b/.test(text.trim())) {
      coreTypeOnly = true
      continue
    }
    coreValueImports.push(text.replace(/\s+/g, " ").trim())
  }
  let directRunCalls = 0
  let runtimeFactoryCalls = 0
  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    const callee = call.field("function")?.text() ?? ""
    if (callee === runSymbol) directRunCalls += 1
    else if (runtimeSymbol && callee === runtimeSymbol) runtimeFactoryCalls += 1
  }
  const protocolEvidence: string[] = []
  if (/createOperationsClient/.test(source)) protocolEvidence.push("createOperationsClient")
  if (/\.\s*runOperation\s*[<(]/.test(source)) protocolEvidence.push("runOperation")
  if (/\.\s*startOperation\s*[<(]/.test(source)) protocolEvidence.push("startOperation")
  if (/\.\s*(awaitOperation|pauseOperation|resumeOperation)\s*[<(]/.test(source)) {
    protocolEvidence.push("await/pause/resumeOperation")
  }
  return { coreValueImports, coreTypeOnly, directRunCalls, runtimeFactoryCalls, protocolEvidence }
}

/** 对一个面文件做 AST 分类。 */
function readFace(path: string, id: string, runSymbol: string, runtimeSymbol: string | undefined) {
  return classifyFaceSource(readFileSync(path, "utf8"), id, runSymbol, runtimeSymbol)
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as {
    generatedAt: string
    counts: Record<string, number>
    nodes: Record<string, {
      id: string
      run: string
      createRuntime?: string | null
      disposition?: string
      core?: { bytes?: number; ok?: boolean; error?: string | null } | null
      platform?: { bytes?: number; ok?: boolean; error?: string | null } | null
      host?: { bytes?: number; ok?: boolean; error?: string | null } | null
      bundleError?: string | null
    }>
  }
  const tiers = JSON.parse(await readFile(TIERS_PATH, "utf8")) as {
    nodes: { id: string; hostRequirements?: string[] }[]
  }
  const tierById = new Map(tiers.nodes.map((node) => [node.id, node.hostRequirements ?? []]))

  const registrationSource = await readFile(REGISTRATION_PATH, "utf8")
  const registered = new Set<string>([...registrationSource.matchAll(/bundles\/([a-z0-9]+)\.js/g)].map((m) => m[1]))
  const builtinBuild = await readFile(BUILTIN_BUILD_PATH, "utf8")
  const builtinLine = builtinBuild.match(/const NODE_BUNDLES[^=]*=\s*&?\[([^\]]*)\]/)?.[1] ?? ""
  for (const match of builtinLine.matchAll(/"([a-z0-9]+)"/g)) registered.add(match[1])

  const staged = new Set((await readdir(BUNDLES_DIR)).filter((name) => name.endsWith(".js")).map((name) => name.slice(0, -3)))

  const nodeDirs = await readdir(join(REPO, "packages", "nodes"))
  const records: FaceRecord[] = []

  // 只读地把宿主那条 lane 欠的这一刀抓过来：`--check` 是 exit-1 的门禁模式，不写任何文件
  // （写档的那条 `embed-node-bundles` 会按当前源码重签 bundles/，而当前源码里混着别人未提交的 core，
  //  所以这把尺只报清单，不替那条 lane 决定何时跑）。
  let embedCheck: string[] = []
  try {
    execFileSync("bun", ["scripts/embed-node-bundles.ts", "--check"], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? ""
    embedCheck = stderr.split("\n").filter((line) => line.startsWith("FAIL "))
  }

  for (const id of nodeDirs) {
    const entry = manifest.nodes[id]
    if (!entry) continue
    const faces: string[] = []
    for (const face of ["cli.ts", "Tui.tsx"]) {
      if (existsSync(join(REPO, "packages", "nodes", id, "src", face))) faces.push(face)
    }

    const perFace = faces.map((face) =>
      readFace(join(REPO, "packages", "nodes", id, "src", face), id, entry.run, entry.createRuntime ?? undefined),
    )

    // 第三面：GUI 的源码树在 `src/nodes/<id>/`，与节点包分开，所以单独扫一遍同一把判据。
    const guiDir = join(REPO, "src", "nodes", id)
    let guiFiles: string[] = []
    try {
      guiFiles = (await readdir(guiDir, { recursive: true }))
        .map((name) => String(name))
        .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.includes(".screenshots."))
    } catch {
      guiFiles = []
    }
    const guiDetails = guiFiles.map((rel) => ({
      rel,
      detail: readFace(join(guiDir, rel), id, entry.run, entry.createRuntime ?? undefined),
    }))
    const guiCoreValueImports = guiDetails.flatMap((item) => item.detail.coreValueImports)
    const guiRunCalls = guiDetails.reduce((sum, item) => sum + item.detail.directRunCalls, 0)
    const coreValueImports = perFace.flatMap((detail) => detail.coreValueImports)
    const directRunCalls = perFace.reduce((sum, detail) => sum + detail.directRunCalls, 0)
    const runtimeFactoryCalls = perFace.reduce((sum, detail) => sum + detail.runtimeFactoryCalls, 0)
    const protocolEvidence = [...new Set(perFace.flatMap((detail) => detail.protocolEvidence))]
    const coreTypeOnly = perFace.some((detail) => detail.coreTypeOnly) && coreValueImports.length === 0

    let verdict: FaceRecord["verdict"] = "no-face"
    if (faces.length > 0) {
      const bypassesProtocol = coreValueImports.length > 0 || directRunCalls > 0
      verdict = !bypassesProtocol && protocolEvidence.length > 0 ? "migrated" : "in-process"
    }

    const hostCoreOk = entry.core?.ok === true
    const hostBundleOk = entry.host?.ok === true || staged.has(id)
    const registeredInRust = registered.has(id)
    const blocker = !hostCoreOk
      ? `core bundle 未构建成功：${entry.core?.error ?? entry.bundleError ?? "unknown"}`
      : !hostBundleOk
        ? `host bundle 未暂存（platform 侧：${entry.platform?.error ?? entry.bundleError ?? "unknown"}）`
        : !registeredInRust
          ? "未进 Rust 注册表：/operations 现在跑不了这个节点，先走 embed + 注册"
          : null

    const faceDirty = dirtyFaceFiles(id, faces)
    const guiDirty = changedAgainstHead(guiFiles.map((rel) => `src/nodes/${id}/${rel}`))
    const offending = guiDetails
      .filter((item) => item.detail.coreValueImports.length > 0 || item.detail.directRunCalls > 0)
      .map((item) => `src/nodes/${id}/${item.rel}`)
    const offendingDirty = new Set(changedAgainstHead(offending))
    const guiOffendingFiles = offending.map((path) => ({ path, dirty: offendingDirty.has(path) }))
    const coreChangedBundleStale =
      registeredInRust
      && changedAgainstHead([`packages/nodes/${id}/src/core.ts`]).length > 0
      && changedAgainstHead([`crates/xiranite-quickjs-executor/bundles/${id}.js`]).length === 0

    records.push({
      id,
      faces,
      guiFiles,
      guiCoreValueImports,
      guiRunCalls,
      coreValueImports,
      coreTypeOnly,
      directRunCalls,
      runtimeFactoryCalls,
      protocolEvidence,
      verdict,
      hostCoreOk,
      hostCoreBytes: entry.core?.bytes ?? 0,
      hostBundleBytes: entry.host?.bytes ?? (staged.has(id) ? null : 0),
      hostBundleError: entry.host?.error ?? entry.platform?.error ?? entry.bundleError ?? null,
      stagedInBundlesDir: staged.has(id),
      registeredInRust,
      tiers: tierById.get(id) ?? [],
      canMigrateNow: verdict === "in-process" && blocker === null,
      faceDirty,
      guiDirty,
      guiOffendingFiles,
      coreChangedBundleStale,
      dispatchable: verdict === "in-process" && blocker === null && faceDirty.length === 0 && !coreChangedBundleStale,
      blocker,
      wave: verdict !== "in-process" ? "-" : blocker === null ? "A" : hostCoreOk && hostBundleOk ? "B" : "C",
    })
  }

  records.sort((a, b) => a.id.localeCompare(b.id))

  const summary = {
    generatedAt: new Date().toISOString(),
    manifestGeneratedAt: manifest.generatedAt,
    counts: {
      nodes: records.length,
      migrated: records.filter((r) => r.verdict === "migrated").length,
      inProcess: records.filter((r) => r.verdict === "in-process").length,
      noFace: records.filter((r) => r.verdict === "no-face").length,
      waveA: records.filter((r) => r.wave === "A").length,
      dispatchable: records.filter((r) => r.dispatchable).length,
      waveB: records.filter((r) => r.wave === "B").length,
      waveC: records.filter((r) => r.wave === "C").length,
      guiBypassNodes: records.filter((r) => r.guiCoreValueImports.length > 0 || r.guiRunCalls > 0).length,
      guiRunCallNodes: records.filter((r) => r.guiRunCalls > 0).length,
      guiFreeNodes: records.filter((r) => r.guiOffendingFiles.length > 0 && r.guiOffendingFiles.some((file) => !file.dirty)).length,
    },
    records,
    embedCheck,
  }

  await writeFile(LEDGER_JSON, `${JSON.stringify(summary, null, 2)}\n`)
  await writeFile(LEDGER_MD, renderLedger(summary))

  if (process.argv.includes("--self-check")) {
    const problems: string[] = []
    // 对照一律用合成夹具，不赌「某个节点今天还在进程内」——那种期望值会被别的会话的迁移作废（nameu 就作废过一次）。
    const spaced = classifyFaceSource('import { runWidget } from "./core.js";\nrunWidget(input, createNodeWidgetRuntime());\n', "widget", "runWidget", "createNodeWidgetRuntime")
    if (spaced.coreValueImports.length !== 1 || spaced.directRunCalls !== 1 || spaced.runtimeFactoryCalls !== 1) {
      problems.push(`夹具「带空格的值导入+直接调用」应记 1/1/1，实际 ${spaced.coreValueImports.length}/${spaced.directRunCalls}/${spaced.runtimeFactoryCalls}`)
    }
    const minified = classifyFaceSource('import{runWidget}from"./core.js";runWidget(a);', "widget", "runWidget", undefined)
    if (minified.coreValueImports.length !== 1 || minified.directRunCalls !== 1) {
      problems.push(`夹具「压成单行的值导入」应记 1/1，实际 ${minified.coreValueImports.length}/${minified.directRunCalls}`)
    }
    const compliant = classifyFaceSource('import type { WidgetInput } from "./core.js";\nconst c = createOperationsClient({ baseUrl });\nawait c.runOperation("widget", input);\n', "widget", "runWidget", undefined)
    if (compliant.coreValueImports.length !== 0 || compliant.directRunCalls !== 0 || compliant.protocolEvidence.length === 0) {
      problems.push(`夹具「只 import type + 走客户端」应零违规且带协议证据，实际 value=${compliant.coreValueImports.length} calls=${compliant.directRunCalls} protocol=${compliant.protocolEvidence.join("+") || "无"}`)
    }
    const barePackage = classifyFaceSource('import { core, def } from "@xiranite/node-widget";\nawait core.runWidget(input);\n', "widget", "runWidget", undefined)
    if (barePackage.coreValueImports.length !== 1) {
      problems.push(`夹具「裸包名值导入（包根 re-export core）」应记 1 条边，实际 ${barePackage.coreValueImports.length}——尺又瞎了`)
    }

    const byId = new Map(records.map((r) => [r.id, r]))
    const migrated = byId.get("dissolvef")
    if (!migrated || migrated.verdict !== "migrated") {
      problems.push(`dissolvef 是参考实现，必须判 migrated，实际 ${migrated?.verdict ?? "缺失"}`)
    }
    if (records.length === 0) problems.push("台账零记录——清单或节点目录没读到，这把尺在空转")
    if (problems.length > 0) {
      console.error(`self-check FAILED:\n  ${problems.join("\n  ")}`)
      process.exitCode = 1
      return
    }
    console.log("self-check OK: 四份夹具各判对一侧（含裸包名那条边），参考实现 dissolvef 判 migrated。")
  }

  console.log(
    `台账已写：${records.length} 个节点 / migrated ${summary.counts.migrated} / in-process ${summary.counts.inProcess} / `
      + `wave A ${summary.counts.waveA} / wave B ${summary.counts.waveB} / wave C ${summary.counts.waveC}`,
  )
}

function renderLedger(summary: {
  generatedAt: string
  manifestGeneratedAt: string
  counts: Record<string, number>
  records: FaceRecord[]
  embedCheck: string[]
}): string {
  const lines = [
    "# 三位一体迁移台账（终端面执行路）",
    "",
    `现读生成：\`bun scripts/audit-face-execution-path.ts\`（本次 ${summary.generatedAt}；core 清单来自 ${summary.manifestGeneratedAt}）。`,
    "禁止手填本表；它只描述「这一面在哪个进程跑那份 core」，不描述计划。",
    "",
    `共 ${summary.records.length} 个节点：migrated ${summary.counts.migrated}，in-process ${summary.counts.inProcess}，无终端面 ${summary.counts.noFace}。`,
    `派发分波：A（宿主已可跑，立刻可迁）${summary.counts.waveA}；B（bundle 在但未进注册表）${summary.counts.waveB}；C（core/host bundle 本身没建出来）${summary.counts.waveC}。`,
    "",
    "| 节点 | 面 | 判定 | core 值导入 | 直接调用 run | 协议证据 | 已嵌 Rust | 波次 | 可派 | 阻塞 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ]
  for (const record of summary.records) {
    const dispatchCell = record.dispatchable ? "可派" : (record.faceDirty.join(", ") || "—")
    lines.push(
      `| ${record.id} | ${record.faces.join("/") || "—"} | ${record.verdict} | ${record.coreValueImports.length}`
        + ` | ${record.directRunCalls} | ${record.protocolEvidence.join("+") || "—"} | ${record.registeredInRust ? "是" : "否"}`
        + ` | ${record.wave} | ${dispatchCell} | ${record.blocker ? record.blocker.replace(/\s+/g, " ").slice(0, 120) : "—"} |`,
    )
  }
  lines.push("", "## 宿主那条 lane 欠的这一刀（`embed-node-bundles --check` 现读，只报不跑）", "",
    summary.embedCheck.length === 0
      ? "无——生成物与清单一致。"
      : summary.embedCheck.map((problem) => `- ${problem}`).join("\n"),
    "",
    "写档的那条命令（`bun scripts/embed-node-bundles.ts`）刻意不由本尺执行：它会按**当前工作树源码**重签 `bundles/`，而当前源码里混着别的 lane 未提交的 `core.ts`；把别人在写的实现签进生成物，正是门禁该拦住的事。",
  )
  lines.push("", "## 判定口径", "", "- `migrated`：无 core 值导入、无对清单里 `run` 符号的直接调用，且存在 `/operations` 客户端证据。")
  lines.push("- `in-process`：仍在 Node/Bun 进程里跑那份 core（ADR-0074 §5 要收口的形态）。")
  lines.push("- `wave A` 可立即派发；`wave B` 先要 embed + 注册（共享生成物，归宿主那条 lane）；`wave C` 是上游 bundle 构建本身没成功。")
  lines.push("- GUI 列（`guiCoreValueImports` / `guiRunCalls`）是第三面：`src/nodes/<id>/` 里对 `@xiranite/node-<id>/core` 的值导入与调用，浏览器执行同一份业务逻辑同样是第二个执行宿主。")
  lines.push("- **`blocker` / `wave` 读的是活产物**（`artifacts/node-bundles/manifest.json`、`crates/xiranite-scripted-nodes/src/registration.rs`、`bundles/` 目录），宿主那条 lane 会把节点从 B 推到 A；`dispatchable` 还额外要求 face 文件当前没有未提交改动。**派发前必须重跑本脚本**，不要信上一次读数。")
  lines.push("- `coreChangedBundleStale` 是**上界探测**，不是证明：core 与 `bundles/<id>.js` 同时被改时它报 false，而 bundle 是否真在 core 之后重建过，这把尺看不见。别拿它的 false 当「bundle 是新的」。")

  const blocked = summary.records.filter((r) => r.wave === "B")
  const unbuilt = summary.records.filter((r) => r.wave === "C")
  const guiBypass = summary.records.filter((r) => r.guiOffendingFiles.length > 0)
  const guiFree = guiBypass.filter((r) => r.guiOffendingFiles.some((file) => !file.dirty))
  const guiOwned = guiBypass.filter((r) => r.guiOffendingFiles.every((file) => file.dirty))
  lines.push(
    "",
    "## 派发队列（现读，按依赖边排）",
    "",
    `1. 立刻可派（宿主就绪 + face 无人握着）：${summary.records.filter((r) => r.dispatchable).map((r) => `\`${r.id}\``).join(" ") || "**当前 0 个**"}`,
    "2. 卡在同一条 lane 的注册产物：" + (blocked.map((r) => "`" + r.id + "`").join(" ") || "**无**")
      + " —— 前置是 `bun run build:node-bundles` 与 `bun scripts/embed-node-bundles.ts` 落到 crates/；"
      + "那两处生成物现在被别的 lane 握着（未提交），抢先跑会覆盖别人未提交的东西。",
    `3. 卡在 bundle 本身没建出来：${unbuilt.map((r) => `\`${r.id}\``).join(" ") || "无"}`,
    "4a. GUI 面可立刻派（offending 文件当前无人改）："
      + (guiFree.map((r) => "`" + r.id + "`[" + r.guiOffendingFiles.filter((file) => !file.dirty).map((file) => file.path).join(", ") + "]").join(" ") || "无"),
    "4b. GUI 面被 UI 那条 lane 改着、暂不动：" + (guiOwned.map((r) => "`" + r.id + "`").join(" ") || "无"),
    "",
    "恢复执行的一条命令：`bun scripts/audit-face-execution-path.ts --self-check`，然后按本节第 1 行派面；第 1 行为空就说明还得等上面那两条 lane 提交。",
  )
  return `${lines.join("\n")}\n`
}

await main()
