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
  /** 注册不上的**原话**理由（registration.rs 的 UNREGISTERED_BUNDLES 行），不是我转述的。 */
  unregisteredReason: string | null
  /** 缺的那一句授权：派生器已推出的 roots 与它明确拒绝发明的名字。 */
  grantAsk: { status: string; basis: string; pending: string[] } | null
  canMigrateNow: boolean
  /** 第三面（GUI）：`src/nodes/<id>/` 里对 core 的值导入与直接调用；浏览器里跑业务逻辑同样是第二个执行宿主。 */
  guiFiles: string[]
  guiCoreValueImports: string[]
  guiRunCalls: number
  /** GUI 目录里有与 HEAD 不同的内容 = UI 那条 lane 正握着这些文件。 */
  guiDirty: string[]
  /** 节点自己在 platform.ts 里写的程序字面量候选（转录 + 行号）；**这不是授权**，只是让人一眼能拍。 */
  programCandidates: { name: string; line: number }[]
  /** 带 core 值导入/调用的具体 GUI 文件，以及它们各自是否被人握着——派发只看这一列，不看整目录。 */
  guiOffendingFiles: {
    path: string
    /** 该文件相对 HEAD 有内容差 = UI 那条 lane 正在写它（整文件收放时有撞车风险）。 */
    dirty: boolean
    /** 我必改的行段（AST 给的行号，1-based 闭区间）。offending 文件上它非空 ⇒ 下面那格不是空转。 */
    edgeRanges: [number, number][]
    /** 别人的 hunk 是否压在我必改的那几行上；false = 同文件不同地段，可外科手术式改。 */
    overlapsForeignHunks: boolean
  }[]
  /** GUI 每文件从 core 拿的名字，以及它是否被当函数调用（只当类型 ⇒ 一条 import type 就能断开）。 */
  guiEdgeNames: { file: string; names: { name: string; called: boolean }[] }[]
  /**
   * core 被改了、但 `bundles/<id>.js` 没跟着重建 = 宿主内嵌的还是旧引擎文本。
   * 这种节点的「已注册」不能当证据用：注册表说的是旧那份。迁移派发前必须先看这列。
   */
  coreChangedBundleStale: boolean
  /** face 文件上有未提交改动 = 别的会话正在写这几个文件，派发会撞车。 */
  faceDirty: string[]
  /** 面文件当前无人握着、可以改成协议调用；宿主是否跑得动看 `blocker`。 */
  faceWritable: boolean
  dispatchable: boolean
  blocker: string | null
  wave: "A" | "B" | "C" | "H" | "-"
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

/** 从 `git diff --unified=0` 文本解析**新侧**行段——现文件的行号只对得上 `+a,b`，取旧侧会看不见别人的改动。 */
function hunkRangesFromPatch(patch: string): [number, number][] {
  const found: [number, number][] = []
  for (const line of patch.split("\n")) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!m) continue
    const from = Number(m[1])
    found.push([from, from + Math.max(0, Number(m[2] ?? "1") - 1)])
  }
  return found
}

/** 两个 1-based 闭区间是否相交。 */
function rangesIntersect(a: [number, number][], b: [number, number][]): boolean {
  return a.some(([from, to]) => b.some(([otherFrom, otherTo]) => from <= otherTo && to >= otherFrom))
}

/** 别人在这个文件里改了哪些行段（diff hunk 的新侧区间），用来判断我的目标行是否落在别人地段上。 */
function foreignHunkRanges(paths: string[]): Map<string, [number, number][]> {
  const ranges = new Map<string, [number, number][]>()
  for (const path of paths) {
    let patch = ""
    try {
      patch = execFileSync("git", ["diff", "HEAD", "--unified=0", "--", path], { cwd: REPO, encoding: "utf8" })
    } catch {
      continue
    }
    ranges.set(path, hunkRangesFromPatch(patch))
  }
  return ranges
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

/** 节点 `platform.ts` 里出现的可执行文件字面量：名字 + 行号，逐个可反查。 */
function programCandidatesOf(id: string): { name: string; line: number }[] {
  let source: string
  try {
    source = readFileSync(join(REPO, "packages", "nodes", id, "src", "platform.ts"), "utf8")
  } catch {
    return []
  }
  const pattern = /"((?:[A-Za-z0-9_\-]+\.(?:exe|sh))|7z|7za|7zz|ffmpeg|ffprobe|which|wl-paste|xclip|xsel|powershell\.exe)"/g
  const found = new Map<string, number>()
  source.split("\n").forEach((text, index) => {
    for (const match of text.matchAll(pattern)) {
      if (!found.has(match[1])) found.set(match[1], index + 1)
    }
  })
  return [...found.entries()].map(([name, line]) => ({ name, line })).sort((a, b) => a.name.localeCompare(b.name))
}

/** 从源码文本分类一面：core 的值/类型导入、对清单里 `run` 符号的直接调用、走协议的证据。 */
function classifyFaceSource(source: string, id: string, runSymbol: string, runtimeSymbol?: string) {
  const root = parse("typescript", source).root()
  const coreValueImports: string[] = []
  /** 这条边逼我改的行段（1-based 闭区间）：值导入语句整段 + 对 `run` 符号的调用点。 */
  const edgeRanges: [number, number][] = []
  const rowsOf = (node: { range(): { start: { line: number }; end: { line: number } } }): [number, number] => [
    node.range().start.line + 1,
    node.range().end.line + 1,
  ]
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
    edgeRanges.push(rowsOf(statement))
  }
  let directRunCalls = 0
  let runtimeFactoryCalls = 0
  for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
    const callee = call.field("function")?.text() ?? ""
    if (callee === runSymbol) {
      directRunCalls += 1
      edgeRanges.push(rowsOf(call))
    } else if (runtimeSymbol && callee === runtimeSymbol) runtimeFactoryCalls += 1
  }
  const protocolEvidence: string[] = []
  if (/createOperationsClient/.test(source)) protocolEvidence.push("createOperationsClient")
  if (/\.\s*runOperation\s*[<(]/.test(source)) protocolEvidence.push("runOperation")
  if (/\.\s*startOperation\s*[<(]/.test(source)) protocolEvidence.push("startOperation")
  if (/\.\s*(awaitOperation|pauseOperation|resumeOperation)\s*[<(]/.test(source)) {
    protocolEvidence.push("await/pause/resumeOperation")
  }
  return { coreValueImports, coreTypeOnly, directRunCalls, runtimeFactoryCalls, protocolEvidence, edgeRanges }
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

  // 注册表的原话理由：`( "id", "reason" )` 成对出现在 UNREGISTERED_BUNDLES 里。
  const unregisteredReasons = new Map<string, string>()
  for (const match of registrationSource.matchAll(/\(\s*"([a-z0-9]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) {
    unregisteredReasons.set(match[1], match[2].replace(/\\"/g, '"').replace(/\\n/g, " "))
  }

  // 授权缺口：派生器知道 roots 该给什么，但拒绝替人发明 program/service/网络主机名。
  const policyNodes = new Map<string, { status?: string; basis?: string; proposedRoots?: unknown[]; network?: boolean }>()
  try {
    const policy = JSON.parse(await readFile(join(REPO, "artifacts", "node-scripted-policy.json"), "utf8")) as {
      nodes: { id: string; status?: string; basis?: string; proposedRoots?: unknown[]; network?: boolean }[]
    }
    for (const node of policy.nodes) policyNodes.set(node.id, node)
  } catch { /* 产物还没生成过：这一列留 null，不许拿缺证据当结论 */ }

  const pendingByNode = new Map<string, string[]>()
  try {
    // nodes 是**数组**（不是 id 索引）：按 Object.entries 取会拿数字键，查不到就静默留空。
    const requirements = JSON.parse(await readFile(join(REPO, "artifacts", "node-scripted-requirements.json"), "utf8")) as {
      nodes: { id: string; requirements?: { pendingGrants?: string[] } }[]
    }
    for (const node of requirements.nodes ?? []) {
      pendingByNode.set(node.id, node.requirements?.pendingGrants ?? [])
    }
  } catch { /* 同上 */ }

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
    // 每文件里从 core 拿的每个名字，是否真的以「被调用」的形态出现：只当类型用的名字改 import type 即可断开，
    // 真被调用的名字需要非 core 出口或走协议 —— 派发的粒度差在这一格。
    const guiEdgeNames = guiDetails.flatMap((item) =>
      item.detail.coreValueImports.map((statement) => {
        const names = (statement.match(/\{([^}]*)\}/)?.[1] ?? "").split(",").map((raw) => raw.trim().split(" as ")[0].trim()).filter(Boolean)
        const source = readFileSync(join(guiDir, item.rel), "utf8")
        return {
          file: item.rel,
          names: names.map((name) => ({ name, called: new RegExp(`(?<![\\w.])${name}\\s*\\(`).test(source) })),
        }
      }),
    )
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
    const holdBlocker = entry.disposition === "hold-unmigrated"
      ? `disposition=hold-unmigrated：清单没打算让它进宿主（manifest 的 run 字段为 ${JSON.stringify(entry.run)}），迁移不在射程内，别去\u300c修\u300d它`
      : null

    const faceDirty = dirtyFaceFiles(id, faces)
    const guiDirty = changedAgainstHead(guiFiles.map((rel) => `src/nodes/${id}/${rel}`))
    const offendingFiles = new Map(
      guiDetails
        .filter((item) => item.detail.coreValueImports.length > 0 || item.detail.directRunCalls > 0)
        .map((item) => [`src/nodes/${id}/${item.rel}`, item.detail.edgeRanges] as const),
    )
    const offending = [...offendingFiles.keys()]
    const offendingDirty = new Set(changedAgainstHead(offending))
    const hunkRanges = foreignHunkRanges(offending.filter((path) => offendingDirty.has(path)))
    const guiOffendingFiles = offending.map((path) => {
      const edgeRanges = offendingFiles.get(path) ?? []
      const hunks = hunkRanges.get(path) ?? []
      return {
        path,
        dirty: offendingDirty.has(path),
        edgeRanges,
        overlapsForeignHunks: edgeRanges.length > 0 && rangesIntersect(edgeRanges, hunks),
      }
    })
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
      programCandidates: programCandidatesOf(id),
      unregisteredReason: registeredInRust ? null : unregisteredReasons.get(id) ?? null,
      grantAsk: (() => {
        const policy = policyNodes.get(id)
        if (!policy?.status) return null
        return { status: policy.status, basis: policy.basis ?? "", pending: pendingByNode.get(id) ?? [] }
      })(),
      canMigrateNow: verdict === "in-process" && blocker === null,
      faceDirty,
      guiDirty,
      guiOffendingFiles,
      guiEdgeNames,
      coreChangedBundleStale,
      // 「面可以写」与「宿主跑得动」是两件事：前者只要求文件没人握着，后者要 embed + 注册落到 crates/。
      // 合成一句就会把 10 个能写的报成 0 个能干。
      faceWritable: verdict === "in-process" && faceDirty.length === 0 && !coreChangedBundleStale && holdBlocker === null,
      dispatchable: verdict === "in-process" && blocker === null && faceDirty.length === 0 && !coreChangedBundleStale,
      blocker: holdBlocker ?? blocker,
      wave: verdict !== "in-process" ? "-" : entry.disposition === "hold-unmigrated" ? "H" : blocker === null ? "A" : hostCoreOk && hostBundleOk ? "B" : "C",
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
      waveHold: records.filter((r) => r.wave === "H").length,
      guiBypassNodes: records.filter((r) => r.guiCoreValueImports.length > 0 || r.guiRunCalls > 0).length,
      guiRunCallNodes: records.filter((r) => r.guiRunCalls > 0).length,
      guiFreeNodes: records.filter((r) => r.guiOffendingFiles.length > 0 && r.guiOffendingFiles.some((file) => !file.overlapsForeignHunks)).length,
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

    // hunk 判据自己的阳性对照：这三条夹具都该留下「必改行段」，一条为空就等于 overlaps 永远看不见边（实测瞎过一次：
    // 反斜杠写在模板字符串里被吞成字母，`from\s*` 变成 `froms*`，行号表恒空 ⇒ 9 条 GUI 边全被判成「地段干净」）。
    for (const [label, sample] of [["带空格", spaced], ["压成单行", minified], ["裸包名", barePackage]] as const) {
      if (sample.edgeRanges.length === 0) {
        problems.push(`夹具「${label}」判出了 core 边却没记行段 ⇒ 地段判据在空转`)
      }
    }
    const multiline = classifyFaceSource('const a = 1\nimport {\n  smartSelect,\n} from "@xiranite/node-widget/core"\n', "widget", "runWidget", undefined)
    const multilineRange = JSON.stringify(multiline.edgeRanges)
    if (multilineRange !== "[[2,4]]") {
      problems.push(`跨行 import 子句的行段应覆盖整条语句 [[2,4]]，实际 ${multilineRange}——只记 from 关键字那一行会漏掉真正要改的那几行`)
    }
    const patch = '--- a/x\n+++ b/x\n@@ -11 +11,5 @@ import type { A } from "core"\n+import type { A } from "core"\n+import { smartSelect } from "core"\n'
    const parsed = hunkRangesFromPatch(patch)
    if (JSON.stringify(parsed) !== "[[11,15]]") problems.push(`hunk 头 +11,5 应解析成 [[11,15]]，实际 ${JSON.stringify(parsed)}`)
    if (!rangesIntersect([[15, 15]], parsed)) problems.push("正控失败：现文件第 15 行的边必须落在 +11,5 这段里")
    if (rangesIntersect([[40, 41]], parsed)) problems.push("反控失败：不相干的第 40 行不该算压在别人地段上")
    const blind = records.flatMap((r) => r.guiOffendingFiles.filter((file) => file.edgeRanges.length === 0).map((file) => `${r.id}/${file.path}`))
    if (blind.length > 0) problems.push(`这些 GUI 违规文件判出了边却没记行段（尺瞎了）：${blind.join(" ")}`)
    const contradiction = records.filter((r) => r.dispatchable && !r.faceWritable).map((r) => r.id)
    if (contradiction.length > 0) {
      problems.push(`判成「立刻可派」却不「可写」，两条判据互相矛盾：${contradiction.join(" ")}`)
    }
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
  const asks = summary.records.filter(
    (r) => (r.wave === "B" || r.wave === "H") && r.grantAsk !== null && r.grantAsk.status !== "registrable",
  )
  lines.push(
    "",
    "## 每个未注册节点缺的那一句（派生器的原话，不是转述）",
    "",
    "| 节点 | 派生器 status | 注册表给的理由 | 待答的那一句授权 | 节点自己写的程序字面量（转录，非授权） |",
    "| --- | --- | --- | --- | --- |",
  )
  for (const record of asks) {
    const ask = record.grantAsk as { status: string; basis: string; pending: string[] }
    lines.push(
      `| ${record.id} | ${ask.status} | ${(record.unregisteredReason ?? "—").replace(/\|/g, "/").slice(0, 70)} | ${
        ask.pending.map((line) => line.replace(/\|/g, "/")).join(" ; ").slice(0, 170) || "—"
      } | ${(record.programCandidates ?? []).map((c) => `${c.name}@:${c.line}`).join(" ") || "—" } |`,
    )
  }
  // 待答授权按「同一类答案一次拍完」归组：分类完全从 pending 字符串现算，不手排名单。
  const askClass = (line: string): string => {
    if (/clipboard/i.test(line)) return "clipboard-arm"
    if (/no-host-free-answer|@parcel[\\/]watcher/.test(line)) return "watcher-or-free-answer"
    if (/proc[.](exec|start|stop)|with locator|tools[.]cli|ffprobePath|runCommand is called/.test(line)) return "computed-program"
    return "services-map"
  }
  const askWhy: Record<string, string> = {
    "services-map": "**缺的不是一个词，是一条授权规则**：逐个反查过这 10 个节点的 platform.ts/core.ts，**没有一个按名字 import** 那四个 trash 函数或 czkawka 扫描方法（零命中）；它们 import 的是 `@xiranite/file-operations` 的两个包装器 `executeSingleFileMutation`/`PlatformFileMutationProvider`，真正的 `service.invoke` 发生在**共享包内部**。别名表知道那四个方法落在 `trash` 服务上（`packages/quickjs-shims/src/surface.ts:209-216`），但派生器只能从节点自己的调用点取证，所以它拒绝命名是对的（`scripts/derive-scripted-policy.ts:231-234`：`os-native` 不蕴含 `os`）。要拍的是模型：共享包自己声明服务、由注册表传播给 import 它的节点（一份事实源），还是每个节点重复声明一遍 `trash`（N 份）。",
    "computed-program": "**缺程序白名单条目**：exec 的名字在运行时才算出来（locator / `ffprobePath` / `request.tools.cli` / `command`）。节点自己的候选表里有字面量（例：`packages/nodes/gifu/src/platform.ts:14-16` 的 7z/7za/ffmpeg/ffprobe、`bitv` 的 ffprobe），但工具拒绝代推——收哪些名字、`confirmBeforeRun` 怎么定，是人拍的策略。",
    "clipboard-arm": "**缺剪贴板那条臂**：这些节点跑的是 `wl-paste`/`xclip`/`xsel`/`powershell.exe` 探测。既定终局是把能力收回宿主的 `clipboard.rs`(arboard)，而不是往清单里补几十条程序名 —— 在臂落地前填名字就是走回头路。",
    "watcher-or-free-answer": "**缺 watcher / 无宿主自由答复的决定**：`@parcel/watcher` 与 `@xiranite/findz-native` 属于 findz 那条「Go sidecar + watch 落宿主」的设计，不是补一个名字能结的。",
  }
  const buckets = new Map<string, string[]>()
  for (const record of asks) {
    const pending = record.grantAsk?.pending ?? []
    const keys = pending.length === 0 ? ["services-map"] : [...new Set(pending.map(askClass))]
    for (const key of keys) buckets.set(key, [...(buckets.get(key) ?? []), record.id])
  }
  lines.push("", "### 待答授权的类型（同类一次拍完，节点名单从 pending 字符串现算）", "")
  for (const [key, names] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push("", `- ${askWhy[key]}`, `  - 节点：**${[...new Set(names)].join(", ")}**`)
  }

  lines.push(
    "",
    "这一节的用处是把「未注册」拆成可逐条拍板的清单：工具拒绝替人发明 program/service/网络主机名（调用点行号就是出处）；拍完写进 `docs/xiranite-target-node-manifest.json`，再 `derive-scripted-policy` + `embed-node-bundles`，它们就从 wave B 进 wave A。",
  )

  lines.push("", "## 判定口径", "", "- `migrated`：无 core 值导入、无对清单里 `run` 符号的直接调用，且存在 `/operations` 客户端证据。")
  lines.push("- `in-process`：仍在 Node/Bun 进程里跑那份 core（ADR-0074 §5 要收口的形态）。")
  lines.push("- `wave A` 可立即派发；`wave B` 先要 embed + 注册（共享生成物，归宿主那条 lane）；`wave C` 是上游 bundle 构建本身没成功。")
  lines.push("- GUI 列（`guiCoreValueImports` / `guiRunCalls`）是第三面：`src/nodes/<id>/` 里对 `@xiranite/node-<id>/core` 的值导入与调用，浏览器执行同一份业务逻辑同样是第二个执行宿主。")
  lines.push("- **`blocker` / `wave` 读的是活产物**（`artifacts/node-bundles/manifest.json`、`crates/xiranite-scripted-nodes/src/registration.rs`、`bundles/` 目录），宿主那条 lane 会把节点从 B 推到 A；`dispatchable` 还额外要求 face 文件当前没有未提交改动。**派发前必须重跑本脚本**，不要信上一次读数。")
  lines.push("- `coreChangedBundleStale` 是**上界探测**，不是证明：core 与 `bundles/<id>.js` 同时被改时它报 false，而 bundle 是否真在 core 之后重建过，这把尺看不见。别拿它的 false 当「bundle 是新的」。")

  const blocked = summary.records.filter((r) => r.wave === "B")
  const unbuilt = summary.records.filter((r) => r.wave === "C")
  const held = summary.records.filter((r) => r.wave === "H")
  const guiBypass = summary.records.filter((r) => r.guiOffendingFiles.length > 0)
  /** 这个节点 GUI 面里**不压在别人 hunk 上**的那几条边（同文件不同地段也算）。 */
  const freeGuiEdges = (record: (typeof guiBypass)[number]) =>
    record.guiOffendingFiles.filter((file) => !file.overlapsForeignHunks)
  const guiFree = guiBypass.filter((record) => freeGuiEdges(record).length > 0)
  const guiOwned = guiBypass.filter((record) => freeGuiEdges(record).length === 0)
  lines.push(
    "",
    "## 派发队列（现读，按依赖边排）",
    "",
    `1. 立刻可派（宿主就绪 + face 无人握着）：${summary.records.filter((r) => r.dispatchable).map((r) => `\`${r.id}\``).join(" ") || "**当前 0 个**"}`,
    "1b. 面现在就能改、宿主还没收（写面 + 假宿主测不受阻；真宿主端到端验收等 embed + 注册）："
      + (summary.records.filter((r) => r.faceWritable && !r.dispatchable).map((r) => `\`${r.id}\``).join(" ") || "无"),
    "2. 卡在同一条 lane 的注册产物：" + (blocked.map((r) => "`" + r.id + "`").join(" ") || "**无**")
      + " —— 前置是 `bun run build:node-bundles` 与 `bun scripts/embed-node-bundles.ts` 落到 crates/；"
      + "那两处生成物现在被别的 lane 握着（未提交），抢先跑会覆盖别人未提交的东西。",
    `3. 卡在 bundle 本身没建出来（真缺陷）：${unbuilt.map((r) => `\`${r.id}\``).join(" ") || "无"}`,
    "3b. 清单判定不在迁移射程（disposition=hold-unmigrated，宿主本来就不跑它，面也无从打协议）：" + (held.map((r) => "`" + r.id + "`").join(" ") || "无"),
    "4a. GUI 面可立刻派（要改的那几行没压在别人的 hunk 上）："
      + (guiFree.map((r) => `\`${r.id}\`[${freeGuiEdges(r).map((file) => file.path + (file.dirty ? "(同文件不同地段)" : "")).join(" ")}]`).join(" ") || "无"),
    "4b. GUI 面被 UI 那条 lane 改着、暂不动：" + (guiOwned.map((r) => `\`${r.id}\``).join(" ") || "无"),
    "",
    "恢复执行的一条命令：`bun scripts/audit-face-execution-path.ts --self-check`，然后按本节第 1 行派面；第 1 行为空就说明还得等上面那两条 lane 提交。",
  )
  return `${lines.join("\n")}\n`
}

await main()
