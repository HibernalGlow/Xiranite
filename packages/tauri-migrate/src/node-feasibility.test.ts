import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import { analyzeNodePackages, HOST_REQUIREMENTS } from "./node-feasibility.js"

const temporaryDirectories: string[] = []

/**
 * The repository this test reads live, found by climbing from the working directory to the manifest the
 * analyzer itself requires. `import.meta.url` is not a `file:` URL under this runner, so it cannot be used
 * to locate the checkout.
 */
function repoRootFromCwd(): string {
  let directory = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(directory, "docs", "xiranite-target-node-manifest.json"))) return directory
    directory = join(directory, "..")
  }
  throw new Error(`no docs/xiranite-target-node-manifest.json above ${process.cwd()}`)
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

interface NodeFixture {
  id: string
  /** Files under `src/`, keyed by name. `core.ts` stays the authoritative node surface. */
  files: Record<string, string>
  dependencies?: Record<string, string>
  guiEntry?: boolean
}

async function createRepo(nodes: NodeFixture[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xiranite-host-requirements-"))
  temporaryDirectories.push(root)

  for (const node of nodes) {
    const src = join(root, "packages", "nodes", node.id, "src")
    await mkdir(src, { recursive: true })
    for (const [name, content] of Object.entries(node.files)) {
      await writeFile(join(src, name), content, "utf8")
    }
    await writeFile(
      join(root, "packages", "nodes", node.id, "package.json"),
      `${JSON.stringify({ name: `@xiranite/node-${node.id}`, exports: { ".": "./dist/index.js", "./cli": "./dist/cli.js" }, dependencies: node.dependencies ?? {} }, null, 2)}\n`,
      "utf8",
    )
    if (node.guiEntry) {
      const ui = join(root, "src", "nodes", node.id)
      await mkdir(ui, { recursive: true })
      await writeFile(join(ui, "entry.ts"), "export default {}\n", "utf8")
    }
  }
  return root
}

const clipboardBlock = `import { execFile } from "node:child_process"

export async function readClipboardText(): Promise<string> {
  const result = await runCommand("pbpaste", [])
  return result.code === 0 ? result.stdout.trim() : ""
}

async function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return await new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout) => resolve({ code: error ? 1 : 0, stdout: stdout ?? "" }))
  })
}
`

describe("node host requirement AST audit (ADR-0073)", () => {
  test("every requirement in the vocabulary has a positive control", async () => {
    const root = await createRepo([
      { id: "purecalc", files: { "core.ts": "import { createHash } from \"node:crypto\"\nimport { z } from \"zod\"\nexport const def = { id: \"purecalc\" }\n" } },
      { id: "filemove", files: { "core.ts": "import { readFile } from \"node:fs/promises\"\nexport const run = (path: string) => readFile(path, \"utf8\")\n" } },
      {
        id: "treewalk",
        files: {
          "core.ts": "import { readdir } from \"node:fs/promises\"\nexport async function walkDirectory(path: string, depth: number): Promise<string[]> {\n  const entries = await readdir(path, { withFileTypes: true })\n  const found: string[] = []\n  for (const entry of entries) found.push(...await walkDirectory(`${path}/${entry.name}`, depth + 1))\n  return found\n}\n",
        },
      },
      { id: "shellthing", files: { "core.ts": "import { spawn } from \"node:child_process\"\nexport const run = () => spawn(\"ffmpeg\", [])\n" } },
      { id: "remoteui", files: { "core.ts": "import { Client } from \"@stable-canvas/comfyui-client\"\nexport const run = () => new Client(\"ws://127.0.0.1:8188/ws\")\n" } },
      { id: "registry", files: { "core.ts": "import { buildWindowsShellCommand } from \"@xiranite/shell-integration\"\nexport const run = () => buildWindowsShellCommand()\n" } },
      { id: "watcher", files: { "core.ts": "export async function run(root: string) {\n  const watcher = await import(\"@parcel/watcher\")\n  return watcher.subscribe(root, () => {})\n}\n" } },
      { id: "mystery", files: { "core.ts": "import { thing } from \"some-unclassified-package\"\nexport const run = () => thing()\n" } },
      { id: "binding", files: { "index.ts": "export const run = () => 1\n" }, dependencies: { "@xiranite/widget-native": "workspace:*" } },
    ])

    const report = await analyzeNodePackages({ repoRoot: root })
    const byId = new Map(report.nodes.map((node) => [node.id, node]))

    expect(report.nodes.map((node) => node.id)).toEqual([
      "binding",
      "filemove",
      "mystery",
      "purecalc",
      "registry",
      "remoteui",
      "shellthing",
      "treewalk",
      "watcher",
    ])
    expect(byId.get("purecalc")?.hostRequirements).toEqual(["pure-logic"])
    expect(byId.get("filemove")?.hostRequirements).toEqual(["file-io"])
    expect(byId.get("treewalk")?.hostRequirements).toEqual(["recursive-enumeration", "file-io"])
    expect(byId.get("shellthing")?.hostRequirements).toEqual(["external-process"])
    expect(byId.get("remoteui")?.hostRequirements).toEqual(["network"])
    expect(byId.get("registry")?.hostRequirements).toEqual(["os-native"])
    expect(byId.get("watcher")?.hostRequirements).toEqual(["no-host-free-answer", "os-native"])
    // An unclassified dependency and an unregistered native binding must not read as "the host answers it".
    expect(byId.get("mystery")?.hostRequirements).toEqual(["no-host-free-answer"])
    expect(byId.get("mystery")?.unresolvedSpecifiers).toEqual(["some-unclassified-package"])
    expect(byId.get("binding")?.hostRequirements).toEqual(["no-host-free-answer"])
    expect(byId.get("binding")?.nativeBindings).toEqual(["@xiranite/widget-native"])

    const reached = new Set(report.nodes.flatMap((node) => node.hostRequirements))
    for (const requirement of HOST_REQUIREMENTS) {
      expect(reached.has(requirement), `requirement ${requirement} is unreachable`).toBe(true)
    }
  })

  test("summary counts requirements, which a node may carry several of", async () => {
    const root = await createRepo([
      {
        id: "bandia",
        files: {
          "core.ts": "import { readdir } from \"node:fs/promises\"\nexport async function walkDirectory(path: string): Promise<string[]> {\n  const entries = await readdir(path, { withFileTypes: true })\n  const found: string[] = []\n  for (const entry of entries) found.push(...await walkDirectory(`${path}/${entry.name}`))\n  return found\n}\n",
          "platform.ts": "import { execFile } from \"node:child_process\"\nimport { PlatformFileMutationProvider } from \"@xiranite/file-operations/platform\"\nexport const run = () => execFile(\"7z\", [\"x\"])\nexport const provider = new PlatformFileMutationProvider({ ownerId: \"bandia\" })\n",
        },
      },
      { id: "pure", files: { "core.ts": "export const run = () => 1\n" } },
    ])

    const report = await analyzeNodePackages({ repoRoot: root })
    expect(report.schemaVersion).toBe(2)
    expect(report.generator.name).toBe("@xiranite/tauri-migrate")
    expect(report.summary).toEqual({
      "no-host-free-answer": 0,
      "os-native": 1,
      network: 0,
      "external-process": 1,
      "recursive-enumeration": 1,
      "file-io": 1,
      "pure-logic": 1,
    })
    expect(report.nodes[0]?.hostRequirements).toEqual(["os-native", "external-process", "recursive-enumeration", "file-io"])
    expect(report.nodes[0]?.reasons.join(" ")).toContain("file-io:")
    expect(report.nodes[0]?.reasons.join(" ")).toContain("node:fs/promises")
  })

  test("records requirement evidence with file and line, including dynamic imports", async () => {
    const root = await createRepo([
      {
        id: "lazyio",
        guiEntry: true,
        files: {
          "core.ts": "import { join } from \"node:path\"\nexport async function run(dir: string) {\n  const fs = await import(\"node:fs/promises\")\n  return [dir, join(dir), await fs.readFile(\"x\")]\n}\n",
        },
      },
    ])

    const report = await analyzeNodePackages({ repoRoot: root })
    const node = report.nodes[0]!

    expect(node.hostRequirements).toEqual(["file-io"])
    expect(node.hasGuiEntry).toBe(true)
    expect(node.hasCli).toBe(true)
    const dynamic = node.evidence.find((item) => item.specifier === "node:fs/promises")
    expect(dynamic?.dynamic).toBe(true)
    expect(dynamic?.file).toBe("packages/nodes/lazyio/src/core.ts")
    expect(dynamic?.line).toBe(3)
    expect(node.requirementEvidence.map((item) => `${item.requirement} ${item.marker}`)).toEqual(["file-io node:fs/promises"])
  })

  test("a spawn reached only through the cli-side clipboard block is not node demand", async () => {
    const root = await createRepo([
      { id: "cleanf", files: { "core.ts": "export const run = (path: string) => path\n", "platform.ts": clipboardBlock } },
      {
        id: "classf",
        files: {
          "core.ts": "export interface ClassfRuntime { readClipboardPaths: () => Promise<string[]> }\nexport const run = async (runtime: ClassfRuntime) => (await runtime.readClipboardPaths()).length\n",
          "platform.ts": `${clipboardBlock}export const readClipboardPaths = async () => (await readClipboardText()).split(\"\\n\")\n`,
        },
      },
      {
        id: "bandiaz",
        files: {
          "core.ts": "export const run = () => 1\n",
          "platform.ts": `${clipboardBlock}export const runArchive = (args: string[]) => runCommand("Bandizip", args)\n`,
        },
      },
    ])

    const report = await analyzeNodePackages({ repoRoot: root })
    const byId = new Map(report.nodes.map((node) => [node.id, node]))

    expect(byId.get("cleanf")?.hostRequirements).toEqual(["pure-logic"])
    // classf is the one node whose runtime member actually reads the clipboard.
    expect(byId.get("classf")?.hostRequirements).toEqual(["os-native"])
    // Bandizip shares runCommand with the clipboard block and is still a registered command.
    expect(byId.get("bandiaz")?.hostRequirements).toEqual(["external-process"])
    expect(byId.get("bandiaz")?.reasons.join(" ")).toContain("external-process: execFile")
  })

  test("host-free specifiers say nothing: node:os, node:process and in-process codecs stay pure", async () => {
    const root = await createRepo([
      {
        id: "encodeb",
        files: {
          "core.ts": "import { platform } from \"node:os\"\nimport process from \"node:process\"\nimport chardet from \"chardet\"\nimport iconv from \"iconv-lite\"\nexport const run = () => [platform(), process.cwd(), chardet, iconv]\n",
        },
      },
      { id: "subpathio", files: { "core.ts": "import { readLogDirectory } from \"@xiranite/logging/node\"\nexport const run = () => readLogDirectory()\n" } },
    ])

    const report = await analyzeNodePackages({ repoRoot: root })
    const byId = new Map(report.nodes.map((node) => [node.id, node]))

    expect(byId.get("encodeb")?.hostRequirements).toEqual(["pure-logic"])
    expect(byId.get("encodeb")?.unresolvedSpecifiers).toEqual([])
    expect(byId.get("subpathio")?.hostRequirements).toEqual(["file-io"])
    expect(byId.get("subpathio")?.reasons.join(" ")).toContain("@xiranite/logging/node")
  })

  test("the deleted CLI and TUI surfaces never decide a requirement", async () => {
    const root = await createRepo([
      { id: "bareinfra", files: { "core.ts": "import { z } from \"@xiranite/contract\"\nimport { fmt } from \"@xiranite/config\"\nexport const run = () => fmt(1)\nexport { z }\n" } },
      { id: "mcpprobe", files: { "core.ts": "import { Client } from \"@modelcontextprotocol/sdk/client/index.js\"\nexport const run = () => new Client({ name: \"clipm\", version: \"1\" })\n" } },
      {
        id: "cliquiet",
        files: {
          "core.ts": "export const run = () => 1\n",
          "cli.ts": "import { spawn } from \"node:child_process\"\nexport const cli = () => spawn(\"true\", [])\n",
          "Tui.tsx": "import { readFile } from \"node:fs/promises\"\nexport const Tui = () => readFile(\"x\")\n",
          "help.ts": "import { readdir } from \"node:fs/promises\"\nexport const help = () => readdir(\".\")\n",
          "interaction.ts": "import { execFile } from \"node:child_process\"\nexport const interaction = () => execFile(\"true\", [])\n",
          "core.test.ts": "import { readFile } from \"node:fs/promises\"\nexport const t = () => readFile(\"x\")\n",
        },
      },
    ])

    const report = await analyzeNodePackages({ repoRoot: root })
    const byId = new Map(report.nodes.map((node) => [node.id, node]))

    expect(byId.get("bareinfra")?.hostRequirements).toEqual(["pure-logic"])
    expect(byId.get("bareinfra")?.infrastructureSpecifiers).toEqual(["@xiranite/contract", "@xiranite/config"])
    expect(byId.get("mcpprobe")?.hostRequirements).toEqual(["network"])
    expect(byId.get("cliquiet")?.hostRequirements).toEqual(["pure-logic"])
    expect(byId.get("cliquiet")?.pluginSurfaceFiles).toBe(1)
  })

  test("composing a sibling node is a compile-time dependency, not a host service", async () => {
    const root = await createRepo([
      { id: "samea", files: { "core.ts": "import { readdir } from \"node:fs/promises\"\nexport const run = (p: string) => readdir(p)\n" } },
      {
        id: "classf",
        files: { "core.ts": "import { runSamea } from \"@xiranite/node-samea/core\"\nexport const run = () => runSamea()\n" },
      },
    ])

    const report = await analyzeNodePackages({ repoRoot: root })
    const byId = new Map(report.nodes.map((node) => [node.id, node]))

    expect(byId.get("classf")?.composedNodes).toEqual(["samea"])
    expect(byId.get("classf")?.unresolvedSpecifiers).toEqual([])
    expect(byId.get("classf")?.hostRequirements).toEqual(["pure-logic"])
    expect(byId.get("samea")?.hostRequirements).toEqual(["file-io"])
  })

  test("honours extra os-native and no-host-free-answer markers from the CLI", async () => {
    const root = await createRepo([
      { id: "gpu", files: { "core.ts": "import { render } from \"@some/gpu-pipeline\"\nexport const run = () => render()\n" } },
    ])

    const baseline = await analyzeNodePackages({ repoRoot: root })
    expect(baseline.nodes[0]?.hostRequirements).toEqual(["no-host-free-answer"])
    expect(baseline.nodes[0]?.unresolvedSpecifiers).toEqual(["@some/gpu-pipeline"])

    const marked = await analyzeNodePackages({ repoRoot: root, noHostFreeAnswer: ["@some/gpu-pipeline"] })
    expect(marked.nodes[0]?.hostRequirements).toEqual(["no-host-free-answer"])
    expect(marked.nodes[0]?.reasons[0]).toContain("@some/gpu-pipeline")
    expect(marked.nodes[0]?.unresolvedSpecifiers).toEqual([])

    const asOs = await analyzeNodePackages({ repoRoot: root, osNative: ["@some/gpu-pipeline"] })
    expect(asOs.nodes[0]?.hostRequirements).toEqual(["os-native"])
  })

  test("a helper that carries the program is resolved from its call sites, not from a guess", async () => {
  // The shape most of the archive/media nodes actually ship: `execFile(command, …)` inside `runCommand`, with the
  // names one level up. `wrapper` exists because "the spawn line has no literal" is not the same claim as
  // "somebody decides the program at run time" — the file says which of the two it is.
  const root = await createRepo([
    {
      id: "packed",
      files: {
        "core.ts": [
          "import { execFile } from \"node:child_process\"",
          "async function runCommand(command: string, args: string[]): Promise<number> {",
          "  return new Promise((resolve) => execFile(command, args, (error) => resolve(error ? 1 : 0)))",
          "}",
          "export const list = (): Promise<number> => runCommand(\"7z\", [\"l\"])",
          "export const probe = (): Promise<number> => runCommand(\"ffprobe\", [\"-h\"])",
        ].join("\n"),
      },
    },
    {
      id: "half-open",
      files: {
        "core.ts": [
          "import { execFile } from \"node:child_process\"",
          "async function runCommand(command: string, args: string[]): Promise<number> {",
          "  return new Promise((resolve) => execFile(command, args, (error) => resolve(error ? 1 : 0)))",
          "}",
          "export const list = (): Promise<number> => runCommand(\"7z\", [\"l\"])",
          // One caller hands the helper a parameter, so no name set on this helper is closed — the literals above
          // must not become the allowlist for a call that can pass anything.
          "export const custom = (tool: string): Promise<number> => runCommand(tool, [\"l\"])",
        ].join("\n"),
      },
    },
  ])
  const byId = new Map((await analyzeNodePackages({ repoRoot: root })).nodes.map((node) => [node.id, node]))
  const packed = byId.get("packed")
  const halfOpen = byId.get("half-open")

  expect(packed?.processes.map((item) => `${item.program}:${item.via}`)).toEqual(["7z:wrapper", "ffprobe:wrapper"])
  expect(packed?.unresolvedProcessCalls).toEqual([])
  // The evidence line is the spawn, which is where the program is actually run; the marker carries the calls.
  expect(packed?.processes.every((item) => item.line === 3)).toBe(true)
  expect(packed?.reasons.join(" ")).toContain("via runCommand")

  // Falsification for the same arm: a single computed caller keeps the whole helper unresolved, and says which.
  expect(halfOpen?.processes).toEqual([])
  expect(halfOpen?.unresolvedProcessCalls.map((item) => item.argument)).toEqual(["command"])
  expect(halfOpen?.unresolvedProcessCalls[0]?.marker).toContain("runCommand is called at packages/nodes/half-open/src/core.ts:6 with tool")
})

test("a ternary of two literals names both programs; one computed branch names neither", async () => {
  // `kisaki`'s reveal site is exactly this shape: `proc.exec(platform === "darwin" ? "open" : "xdg-open", …)`.
  // Both branches are spelled in the source, so the closed set of programs that site can run is
  // {open, xdg-open} — refusing to name them is the gauge being blind, not the code being undecided. The
  // negative arm is the same syntax with a parameter in one branch: there the set really is open, and the
  // site must stay unresolved, or "literal support" would become a way to launder a guess into an allowlist.
  const root = await createRepo([
    {
      id: "both-literals",
      files: {
        "core.ts": [
          "import { hostCapabilities } from \"@xiranite/host-capabilities\"",
          "const { proc } = hostCapabilities",
          "export const reveal = async (platform: string, path: string): Promise<void> => {",
          "  await proc.exec(platform === \"darwin\" ? \"open\" : \"xdg-open\", [path])",
          "}",
        ].join("\n"),
      },
    },
    {
      id: "wrapper-ternary",
      files: {
        // kisaki's real shape: the spawn sits in a helper, and the ternary is one level up at the call site.
        "core.ts": [
          "import { hostCapabilities } from \"@xiranite/host-capabilities\"",
          "const { proc } = hostCapabilities",
          "async function runOrThrow(command: string, args: string[]): Promise<number> {",
          "  return (await proc.exec(command, args)).exitCode",
          "}",
          "export const reveal = async (platform: string, path: string): Promise<number> =>",
          "  runOrThrow(platform === \"darwin\" ? \"open\" : \"xdg-open\", [path])",
        ].join("\n"),
      },
    },
    {
      id: "one-computed",
      files: {
        "core.ts": [
          "import { hostCapabilities } from \"@xiranite/host-capabilities\"",
          "const { proc } = hostCapabilities",
          "export const reveal = async (platform: string, fallback: string, path: string): Promise<void> => {",
          "  await proc.exec(platform === \"darwin\" ? \"open\" : fallback, [path])",
          "}",
        ].join("\n"),
      },
    },
  ])
  const byId = new Map((await analyzeNodePackages({ repoRoot: root })).nodes.map((node) => [node.id, node]))

  const closed = byId.get("both-literals")
  expect(closed?.processes.map((item) => item.program)).toEqual(["open", "xdg-open"])
  expect(closed?.unresolvedProcessCalls).toEqual([])
  expect(closed?.reasons.join(" ")).toContain("proc.exec(open, xdg-open)")

  // The wrapper case is the one the repository actually ships; without it the fix would only cover direct calls.
  const wrapped = byId.get("wrapper-ternary")
  expect(wrapped?.processes.map((item) => `${item.program}:${item.via}`)).toEqual(["open:wrapper", "xdg-open:wrapper"])
  expect(wrapped?.unresolvedProcessCalls).toEqual([])

  const openEnded = byId.get("one-computed")
  expect(openEnded?.processes).toEqual([])
  // Same field split as the helper tests above: `argument` is the source text that could not be closed,
  // `marker` names the call. The ternary's *resolved* branch must not survive into the report on its own.
  expect(openEnded?.unresolvedProcessCalls.map((item) => item.argument)).toEqual([
    'platform === "darwin" ? "open" : fallback',
  ])
  expect(openEnded?.unresolvedProcessCalls[0]?.argument).toContain("fallback")
  expect(openEnded?.unresolvedProcessCalls[0]?.marker).toBe("proc.exec")
})

test("the clipboard block neither grants a name nor blocks one", async () => {
  // `readClipboardText` and the node's real work share `runCommand`. The spawn stays node demand (the helper is
  // not clipboard-confined), so the clipboard loop must not be the caller that keeps the name set open — that
  // loop is what made every archive node read as "unresolvable" while its own literal tool names went unreported.
  const clipboardCaller = [
    "  for (const command of [[\"wl-paste\"], [\"xclip\", \"-selection\", \"clipboard\"]]) {",
    "    await runCommand(command[0]!, command.slice(1))",
    "  }",
  ].join("\n")
  const root = await createRepo([
    {
      id: "shared",
      files: {
        "platform.ts": [
          "import { execFile } from \"node:child_process\"",
          "async function runCommand(command: string, args: string[]): Promise<number> {",
          "  return new Promise((resolve) => execFile(command, args, (error) => resolve(error ? 1 : 0)))",
          "}",
          "async function readClipboardText(): Promise<string> {",
          clipboardCaller,
          "  return \"\"",
          "}",
          "export const extract = (): Promise<number> => runCommand(\"7z\", [\"x\"])",
          "export const paste = (): Promise<string> => readClipboardText()",
        ].join("\n"),
      },
    },
  ])
  const node = (await analyzeNodePackages({ repoRoot: root })).nodes[0]

  // The carve-out must not become a blank cheque: the real caller still resolves, and the clipboard loop is gone.
  expect(node?.processes.map((item) => `${item.program}:${item.via}`)).toEqual(["7z:wrapper"])
  expect(node?.unresolvedProcessCalls).toEqual([])
  // Falsification for the carve-out, in the same fixture: had the filter skipped the *real* caller as well, the
  // helper would read as never called and `7z` would not be granted. A helper nobody calls is the third arm, kept
  // honest by naming the file rather than leaving an empty list that also matches "nothing was scanned".
  const uncalled = await createRepo([
    {
      id: "uncalled",
      files: {
        "platform.ts": [
          "import { execFile } from \"node:child_process\"",
          "export async function runCommand(command: string, args: string[]): Promise<number> {",
          "  return new Promise((resolve) => execFile(command, args, (error) => resolve(error ? 1 : 0)))",
          "}",
        ].join("\n"),
      },
    },
  ])
  const orphan = (await analyzeNodePackages({ repoRoot: uncalled })).nodes[0]
  expect(orphan?.processes).toEqual([])
  expect(orphan?.unresolvedProcessCalls.map((item) => item.marker)).toEqual([
    "execFile(command) unresolved: runCommand is not called anywhere in packages/nodes/uncalled/src/platform.ts",
  ])
})

  test("fails loudly when there is nothing to audit", async () => {
    const root = await mkdtemp(join(tmpdir(), "xiranite-host-requirements-empty-"))
    temporaryDirectories.push(root)
    await expect(analyzeNodePackages({ repoRoot: root })).rejects.toThrow(/No node packages found/)
  })

  test("restricts to requested node ids", async () => {
    const root = await createRepo([
      { id: "one", files: { "core.ts": "export const a = 1\n" } },
      { id: "two", files: { "core.ts": "export const b = 2\n" } },
    ])

    const report = await analyzeNodePackages({ repoRoot: root, nodeIds: ["two"] })
    expect(report.nodes.map((node) => node.id)).toEqual(["two"])
  })
})

test("an external program is named only when a call site proves it", async () => {
  const root = await createRepo([
    { id: "zip", files: { "core.ts": "import { execFile } from \"node:child_process\"\nconst TOOL = \"7z.exe\"\nexport const run = () => execFile(TOOL, [\"a\"])\n" } },
    { id: "located", files: { "core.ts": "import { execFile } from \"node:child_process\"\nexport const run = (command: string) => execFile(command, [\"a\"])\n" } },
  ])
  const report = await analyzeNodePackages({ repoRoot: root })
  const byId = new Map(report.nodes.map((node) => [node.id, node]))
  const zip = byId.get("zip")
  const located = byId.get("located")
  // A same-file string constant is as provable as a quoted argument, so it becomes a grantable name.
  expect(zip?.processes.map((item) => `${item.program}:${item.via}`)).toEqual(["7z.exe:const"])
  expect(zip?.unresolvedProcessCalls).toEqual([])
  // A locator parameter is disclosed, never guessed: inventing a program here would widen the allowlist silently.
  expect(located?.processes).toEqual([])
  expect(located?.unresolvedProcessCalls.map((item) => item.argument)).toEqual(["command"])
  // Positive control: both carry the tier, so the split above is about the name and not about detection.
  expect(zip?.hostRequirements).toContain("external-process")
  expect(located?.hostRequirements).toContain("external-process")
})

describe("the host capability surface as machine evidence (ADR-0078)", () => {
  // A migrated `platform.ts` contains no `node:fs` and no `node:child_process` any more, so the tiers can only
  // come from the surface calls. Before this rule existed, 24 migrated nodes landed in
  // `no-host-free-answer` — the harshest tier in the vocabulary — while every test in this file stayed green,
  // because they all run on fixtures. That is the "green and wrong" shape AGENTS.md forbids.
  const surfaceMove = `import { hostCapabilities } from "@xiranite/host-capabilities"
import { join } from "node:path"
const { fs } = hostCapabilities
export async function moveInto(source: string, target: string): Promise<void> {
  await fs.move(source, join(target, "x.txt"))
}
`
  const surfaceExec = `import { hostCapabilities } from "@xiranite/host-capabilities"
const { proc } = hostCapabilities
export const listArchive = (path: string) => proc.exec("7z.exe", ["l", path])
`
  const surfaceClockOnly = `import { hostCapabilities } from "@xiranite/host-capabilities"
const { clock } = hostCapabilities
export const stamp = (): string => clock.now()
`
  // POSITIVE CONTROL: the same call text with the surface import gone and `fs` bound to a local stub. If the
  // tier came from the receiver name alone, this would still report file-io. Written out in full rather than
  // derived with a `replace()`, because a replace whose anchor misses leaves the perturbation undone and the
  // control green for the wrong reason.
  const unboundMove = `import { join } from "node:path"
const fs = { move: async (_source: string, _target: string) => {} }
export async function moveInto(source: string, target: string): Promise<void> {
  await fs.move(source, join(target, "x.txt"))
}
`

  test("file and process calls carry their tier, and importing the surface alone carries none", async () => {
    const root = await createRepo([
      { id: "surfmv", files: { "platform.ts": surfaceMove } },
      { id: "surfxe", files: { "platform.ts": surfaceExec } },
      { id: "surfclock", files: { "platform.ts": surfaceClockOnly } },
      { id: "unbound", files: { "platform.ts": unboundMove } },
    ])
    const report = await analyzeNodePackages({ repoRoot: root })
    const byId = new Map(report.nodes.map((node) => [node.id, node]))

    expect(byId.get("surfmv")?.hostRequirements).toEqual(["file-io"])
    expect(byId.get("surfxe")?.hostRequirements).toEqual(["external-process"])
    expect(byId.get("surfxe")?.processes.map((entry) => entry.program)).toEqual(["7z.exe"])
    // A node that only asks for the clock must not be granted roots just because it imported the surface.
    expect(byId.get("surfclock")?.hostRequirements).toEqual(["pure-logic"])
    expect(unboundMove).not.toContain("host-capabilities")
    expect(unboundMove).toContain("fs.move(")
    expect(byId.get("unbound")?.hostRequirements).not.toContain("file-io")
    for (const id of ["surfmv", "surfxe", "surfclock"]) {
      expect(byId.get(id)?.hostRequirements).not.toContain("no-host-free-answer")
    }
  })

  test("a walker over the surface still owns the enumeration, and a fully qualified receiver is still a call", async () => {
    // Both halves of this were blind spots created by the migration itself. `smartzip`'s `walk` moved from
    // `readdir` to `fs.list` and lost its `recursive-enumeration` tier — the tier that authorises the host to
    // walk at all — and 25 call sites reach the surface as `hostCapabilities.fs.*`/`hostCapabilities.proc.*`,
    // which the short-receiver rule could not see, so a program literal behind that spelling never reached
    // `processes`.
    const surfaceWalk = `import { hostCapabilities } from "@xiranite/host-capabilities"
const { fs } = hostCapabilities
export async function walk(root: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await fs.list(root)) {
    if (entry.kind === "dir") result.push(...(await walk(entry.path)))
    else result.push(entry.path)
  }
  return result
}
`
    const surfaceListOnce = `import { hostCapabilities } from "@xiranite/host-capabilities"
const { fs } = hostCapabilities
export async function topLevel(root: string): Promise<string[]> {
  return (await fs.list(root)).map((entry) => entry.path)
}
`
    const qualifiedExec = `import { hostCapabilities } from "@xiranite/host-capabilities"
export const listArchive = (path: string) => hostCapabilities.proc.exec("7z.exe", ["l", path])
`
    const qualifiedListWalk = `import { hostCapabilities } from "@xiranite/host-capabilities"
export async function walk(root: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await hostCapabilities.fs.list(root)) {
    if (entry.kind === "dir") result.push(...(await walk(entry.path)))
  }
  return result
}
`
    const root = await createRepo([
      { id: "walky", files: { "platform.ts": surfaceWalk } },
      { id: "oncelist", files: { "platform.ts": surfaceListOnce } },
      { id: "qualexec", files: { "platform.ts": qualifiedExec } },
      { id: "quallist", files: { "platform.ts": qualifiedListWalk } },
    ])
    const report = await analyzeNodePackages({ repoRoot: root })
    const byId = new Map(report.nodes.map((node) => [node.id, node]))

    expect(byId.get("walky")?.hostRequirements).toHaveLength(2)
    expect(byId.get("walky")?.hostRequirements).toContain("recursive-enumeration")
    expect(byId.get("walky")?.hostRequirements).toContain("file-io")
    expect(byId.get("quallist")?.hostRequirements).toContain("recursive-enumeration")
    expect(byId.get("qualexec")?.hostRequirements).toContain("external-process")
    expect(byId.get("qualexec")?.processes.map((entry) => entry.program)).toEqual(["7z.exe"])
    // POSITIVE CONTROL for the cycle requirement: one listing with no recursion is a single-directory read,
    // and the host must not hand out an unbounded walk grant because of it.
    expect(surfaceWalk).toContain("await walk(entry.path)")
    expect(surfaceListOnce).not.toContain("await topLevel(")
    expect(byId.get("oncelist")?.hostRequirements).not.toContain("recursive-enumeration")
    expect(byId.get("oncelist")?.hostRequirements).toContain("file-io")
  })
})

describe("the host services a node's graph reaches", () => {
  test("tells a direct call, an aliased package, and the same package imported bare", async () => {
    // `HOST_SERVED_PACKAGES` is the authority, and the distinction it draws is the one a filename guess gets
    // wrong: the bundle build replaces `@xiranite/config/node` with the shim's `config-service.ts` (so that
    // node needs the `config` grant) while `@xiranite/config` stays on the builtin fs path (no grant). Both
    // rows are asserted, plus a node that spells the name out itself.
    const root = await createRepo([
      {
        id: "direct",
        files: {
          "platform.ts":
            'import { hostCapabilities } from "@xiranite/host-capabilities"\n\nexport const sample = () => hostCapabilities.service.invoke("os", "cpu.usage", {})\n',
        },
      },
      {
        id: "aliased",
        files: { "platform.ts": 'import { readDocument } from "@xiranite/config/node"\n\nexport const read = readDocument\n' },
      },
      {
        id: "bare",
        files: { "platform.ts": 'import { resolveAppDataDir } from "@xiranite/config"\n\nexport const dir = resolveAppDataDir\n' },
      },
    ])
    const shimSrc = join(root, "packages", "quickjs-shims", "src")
    await mkdir(shimSrc, { recursive: true })
    await writeFile(
      join(shimSrc, "surface.ts"),
      'export const HOST_SERVED_PACKAGES: Record<string, string> = {\n  "@xiranite/config/node": "config-service.ts",\n}\n',
      "utf8",
    )
    await writeFile(
      join(shimSrc, "config-service.ts"),
      'import { opServiceInvokeAsync } from "./ops.ts"\n\nconst SERVICE = "config"\n\nexport const readDocument = () => opServiceInvokeAsync(SERVICE, "read", {})\n',
      "utf8",
    )
    const report = await analyzeNodePackages({ repoRoot: root })
    const byId = new Map(report.nodes.map((node) => [node.id, node]))

    expect(byId.get("direct")?.services.map((entry) => `${entry.service} ${entry.via}`)).toEqual(["os direct"])
    expect(byId.get("aliased")?.services.map((entry) => entry.service)).toEqual(["config"])
    expect(byId.get("bare")?.services).toEqual([])
  })

  test("POSITIVE CONTROL: the live tree reports grants the manifest has no column for", async () => {
    // A fixture-only rule is a rule nobody has seen fire on the repository it guards, and this one exists
    // because the manifest had no `services` column at all while `realm_run.rs` reads the grant straight out
    // of the descriptor — the analyzer was the only place that knew which services a node actually reaches.
    // Readings are per node, so a rule that silently returned [] for everyone would still leave the other tests green.
    const repoRoot = repoRootFromCwd()
    const report = await analyzeNodePackages({ repoRoot })
    const byId = new Map(report.nodes.map((node) => [node.id, node]))
    // Collapsed to a set because that is what the manifest gets: `audit-target-node-manifest.ts --apply-host-requirements`
    // writes `[...new Set(entries.map(e => e.service))].sort()`, while the evidence keeps one row per path —
    // `findz` reaches its own service twice, through a literal in `platform.ts` and an aliased package in
    // `protocol.ts`. The per-path half stays readable in `report.nodes[].services`; this helper answers
    // "which services is this node granted", which is the question the descriptor column has to match.
    const servicesOf = (id: string) => [...new Set((byId.get(id)?.services ?? []).map((entry) => entry.service))]

    // `trash` joined this row when the shim's trash family became the host service path:
    // `packages/quickjs-shims/src/czkawka-service.ts` exports `trashPath` / `getTrashCapabilities` /
    // `listTrashItems` / `restoreTrashItem` as `opServiceInvoke("trash", …)`, and `@xiranite/file-operations`
    // reaches deletion through them. Verified 2026-10-06 that this reading predates the ternary work in this
    // file — the assertion still failed against `HEAD`'s analyzer — so the stale expectation, not the code,
    // was what went red. It also means the hand-written `src/kisaki.rs` (declaring `czkawka` alone) has been
    // under-granting this node's delete-to-trash path; see docs/migration/node-flavor-distribution.md §8.2.
    expect(servicesOf("kisaki")).toEqual(["czkawka", "trash"])
    expect(servicesOf("linku")).toEqual(["config"])
    expect(servicesOf("findz")).toEqual(["findz"])
    // The negative half: these nodes read configuration too, but through the bare package, which the build
    // does not alias onto a service module. They must not collect a grant they never ask for.
    expect(servicesOf("dissolvef")).toEqual([])
    expect(servicesOf("marku")).toEqual([])
  })
})
