import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import { analyzeNodePackages, HOST_REQUIREMENTS } from "./node-feasibility.js"

const temporaryDirectories: string[] = []

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
