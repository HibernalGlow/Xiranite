import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createServer, type AddressInfo, type IncomingHttpHeaders, type ServerResponse } from "node:http"
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { CliHost } from "@xiranite/cli-runtime"
import { stopSharedHost } from "@xiranite/cli-runtime/backend"
import { createLinkuHostDefinition, runProgram } from "./cli.js"
import type { LinkuData, LinkuResult } from "./core.js"

const HOST_TOKEN = "attach-token"
const CONFIG_BASE = "config_version = 1\n\n"

/** The node input document exactly as the face serialised it, plus the bytes it went out in. */
interface RecordedStart {
  input: Record<string, unknown>
  rawBody: string
}

interface FakeHost {
  baseUrl: string
  starts: RecordedStart[]
  close(): Promise<void>
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that this face holds no node engine of its own — linku is a node that *changes the disk*,
 * so a face that created the link itself would be the second executor ADR-0074 §5 removes.
 * `crates/xiranite-api` is still being wired, so the bodies follow `crates/xiranite-core/src/operation/dto.rs`
 * and this file's mirror of `core.ts`'s `LinkuData`; nothing here proves the host is correct.
 */
async function startFakeHost(options: {
  results: Record<string, LinkuResult>
  events?: { type: "progress" | "log"; progress?: number; message: string }[]
  token?: string
}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const expectedToken = options.token ?? HOST_TOKEN
  const pending = new Map<string, Record<string, unknown>>()
  let sequence = 0

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const headers = request.headers as IncomingHttpHeaders
      const path = (request.url ?? "").split("?")[0] ?? ""
      // `/health` is the one route `crates/xiranite-api` serves without the bearer token, and this face
      // probes it before it asks the operator anything, so a fake that did not answer it would look dead.
      if (path === "/health") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: "ok" }))
        return
      }
      if (headers["x-xiranite-token"] !== expectedToken) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      const body = Buffer.concat(chunks).toString("utf8")

      if (request.method === "POST" && /^\/nodes\/linku\/operations$/.test(path)) {
        const operationId = `op-${(sequence += 1)}`
        const input = JSON.parse(body).input as Record<string, unknown>
        starts.push({ input, rawBody: body })
        pending.set(operationId, input)
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      if (stream?.[1]) {
        const result = options.results[String(pending.get(stream[1])?.action ?? "")] ?? unanswered()
        const frames = [
          { type: "operation", operation: record(stream[1], "running", { startedAt: 2 }) },
          ...(options.events ?? []).map((event, index) => ({ type: "event", index, event })),
          { type: "result", operation: record(stream[1], "completed", { finishedAt: 4, result }), result },
        ]
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
        response.end(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`)
        return
      }

      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "Node operation not found." }))
    })
  })

  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve) })
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    starts,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}) {
  return { operationId, nodeId: "linku", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

/** The host's own "this action has no scripted answer" document, reported as a failure by the face. */
function unanswered(): LinkuResult {
  return { success: false, message: "linku action is not answered by this host", data: data({ failedCount: 1 }) }
}

/** `core.ts`'s `success()` defaults, so the face renders a complete document. */
function data(partial: Partial<LinkuData> = {}): LinkuData {
  return {
    links: [],
    created: false,
    recoveredCount: 0,
    restoredCount: 0,
    failedCount: 0,
    importedCount: 0,
    skippedCount: 0,
    ...partial,
  }
}

const hosts: { close(): Promise<void> }[] = []
const sandboxes: string[] = []

beforeEach(() => {
  // The face reports failure through `process.exitCode`, which starts out undefined.
  process.exitCode = 0
})

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  await stopSharedHost()
  await Promise.all(sandboxes.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  process.exitCode = 0
})

/**
 * A sandbox under the OS temp dir, deleted in `afterEach`. Every path a test hands to the host lives here,
 * and `assertInsideSandbox` proves it: linku's whole subject is links, so a fixture that pointed outside its
 * own sandbox would let `rm -r` walk into the developer's real folders.
 */
async function createSandbox(name: string): Promise<{
  root: string
  source: string
  link: string
  configPath: string
  legacyPath: string
  file: string
}> {
  // `realpath` because macOS hands out a symlinked temp root (`/var` -> `/private/var`), and every path this
  // test sends to the host has to be comparable with what the filesystem actually resolves.
  const root = await realpath(await mkdtemp(join(tmpdir(), `xiranite-linku-face-${name}-`)))
  sandboxes.push(root)
  const source = join(root, "源目录")
  const link = join(root, "软链接")
  const configPath = join(root, "xiranite.config.toml")
  const legacyPath = join(root, "legacy-linku.toml")
  await mkdir(source, { recursive: true })
  const file = join(source, "file.txt")
  await writeFile(file, "hello", "utf8")
  await writeFile(configPath, CONFIG_BASE, "utf8")
  return { root, source, link, configPath, legacyPath, file }
}

/** Replaces the sandbox config so a test can pin the `[nodes.linku]` defaults the face reads. */
async function writeSandboxConfig(sandbox: { configPath: string }, section: string): Promise<void> {
  await writeFile(sandbox.configPath, `${CONFIG_BASE}${section}`, "utf8")
}

/** Separators folded and case folded, so one comparison works on POSIX and on Windows drive paths. */
function normalizePath(value: string): string {
  return value.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase()
}

/**
 * Asserts a path a test hands to the host stays inside its own sandbox — as written, and as the filesystem
 * really resolves it, link by link. linku's subject *is* links, so a fixture that pointed outside its sandbox
 * would let the host-side walk (and this file's own cleanup) reach the developer's real folders.
 */
async function assertInsideSandbox(root: string, value: unknown, label: string): Promise<void> {
  expect(typeof value, label).toBe("string")
  const boundaries = [root, await realpath(root)].map(normalizePath)
  const contained = (path: string, step: string) => {
    const normalized = normalizePath(path)
    expect(boundaries.some((boundary) => `${normalized}/`.startsWith(`${boundary}/`)), `${label} ${step} ${path} escapes the sandbox`).toBe(true)
  }
  // The literal spelling, so a `..` that walks out is caught before anything touches it.
  const given = resolve(String(value))
  contained(given, "path")
  // And what it points at once every link is followed. `realpath` throws for a path that does not exist yet,
  // which is the normal state for a create/move target: then the literal is all there is to check.
  contained(await realpath(given).catch(() => given), "resolved")
  const info = await lstat(given).catch(() => undefined)
  if (info?.isSymbolicLink()) {
    contained(await realpath(resolve(join(given, "..", await readlink(given)))).catch(() => readlink(given)), "link target")
  }
}

describe("linku CLI", () => {
  test("refuses the configured UI outside an interactive terminal", async () => {
    const host = createHost()

    await runProgram([], host)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stderrText()).toContain("No interactive terminal detected")
    expect(host.stderrText()).toContain("linku ui")
  })

  test("runs an info query as a host operation and prints the result document", async () => {
    const sandbox = await createSandbox("info")
    const fake = await startFakeHost({
      results: {
        info: {
          success: true,
          message: "Path info loaded.",
          data: data({ pathInfo: { path: sandbox.file, exists: true, kind: "file", isSymlink: false, sizeMb: 0.0001 } }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["info", "--path", sandbox.file, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(host.stderrText()).toBe("")
    expect(host.stdoutText().trim().startsWith("{")).toBe(true)
    const result = JSON.parse(host.stdoutText()) as LinkuResult
    expect(result.data?.pathInfo?.kind).toBe("file")

    // One start call carrying the absolute CJK path verbatim.
    expect(fake.starts.map((start) => start.input.action)).toEqual(["info"])
    expect(fake.starts[0]?.input).toMatchObject({ path: sandbox.file })
    await assertInsideSandbox(sandbox.root, fake.starts[0]?.input.path, "info path")
  })

  test("asks the host to create the link and does not touch the filesystem itself", async () => {
    const sandbox = await createSandbox("create")
    const before = await readFileText(sandbox.configPath)
    const fake = await startFakeHost({
      results: { create: { success: true, message: `Symlink created: ${sandbox.link} -> ${sandbox.source}`, data: data({ created: true }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["create", "--path", sandbox.source, "--target", sandbox.link, "--configPath", sandbox.configPath, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect((JSON.parse(host.stdoutText()) as LinkuResult).data?.created).toBe(true)
    expect(fake.starts[0]?.input).toMatchObject({ action: "create", path: sandbox.source, target: sandbox.link, configPath: sandbox.configPath })
    await assertInsideSandbox(sandbox.root, fake.starts[0]?.input.path, "create source")
    await assertInsideSandbox(sandbox.root, fake.starts[0]?.input.target, "create link")
    // The face created nothing: no link at the target, and the config still holds only what the fixture wrote.
    expect(existsSync(sandbox.link)).toBe(false)
    expect(await readFileText(sandbox.configPath)).toBe(before)
  })

  test("move-link carries both paths and renders the host's recovery counters", async () => {
    const sandbox = await createSandbox("move-link")
    const relocated = join(sandbox.root, "relocated")
    const fake = await startFakeHost({
      events: [{ type: "progress", progress: 40, message: `Moving ${sandbox.source}` }],
      results: {
        move_link: {
          success: true,
          message: `Moved and linked: ${sandbox.source} -> ${relocated}`,
          data: data({ created: true, recoveredCount: 1 }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["move", "--path", sandbox.source, "--target", relocated, "--configPath", sandbox.configPath], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ action: "move_link", path: sandbox.source, target: relocated })
    await assertInsideSandbox(sandbox.root, fake.starts[0]?.input.target, "move target")
    const stdout = host.stdoutText()
    expect(stdout).toContain("Moved and linked")
    // The host's progress frame reaches the bar; the bar truncates a path this long, so it is matched on the
    // message head and the percentage rather than on the whole folder.
    expect(stdout).toContain("40% Moving")
    // Nothing moved: the source folder is still where it was.
    expect(existsSync(sandbox.source)).toBe(true)
    expect(existsSync(relocated)).toBe(false)
  })

  test("takes the attach from its own flags, which never reach the node input", async () => {
    const sandbox = await createSandbox("flags")
    const fake = await startFakeHost({ results: { list: { success: true, message: "Found 0 link record(s).", data: data() } } })
    hosts.push(fake)
    // No backend variables in the environment: only the flags can attach this run.
    const host = createHost({ XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["list", "--backend", fake.baseUrl, "--token", HOST_TOKEN, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts.length).toBe(1)
    expect(fake.starts[0]?.input).not.toHaveProperty("backend")
    expect(fake.starts[0]?.input).not.toHaveProperty("token")
    expect(fake.starts[0]?.input).toMatchObject({ action: "list" })
  })

  test("takes the attach from a channel file, and its path never reaches the input", async () => {
    const sandbox = await createSandbox("channel-file")
    const fake = await startFakeHost({ results: { list: { success: true, message: "Found 0 link record(s).", data: data() } } })
    hosts.push(fake)
    const channelPath = join(sandbox.root, "channel.json")
    await writeFile(channelPath, JSON.stringify({ baseUrl: fake.baseUrl, token: HOST_TOKEN, instanceId: "pid-1" }), "utf8")
    const host = createHost({ XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["list", "--channel-file", channelPath, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).not.toHaveProperty("channelFile")
    expect(fake.starts[0]?.input).not.toHaveProperty("channel-file")
    expect(fake.starts[0]?.input).toMatchObject({ action: "list" })
  })

  test("imports a live legacy link by default and keeps the link inside the sandbox", async () => {
    const sandbox = await createSandbox("import-live")
    // A real link, created by the fixture and pointing at the fixture's own source folder: the assertion
    // below is what proves this test never hands the host a path that leaves the sandbox.
    await symlink(sandbox.source, sandbox.link, process.platform === "win32" ? "junction" : "dir")
    await assertInsideSandbox(sandbox.root, sandbox.link, "fixture link")
    await writeFile(sandbox.legacyPath, legacyToml([
      { link: sandbox.link, target: sandbox.source, type: "directory", createdAt: "2026-07-10T19:00:00Z" },
      { link: join(sandbox.root, "missing-link"), target: join(sandbox.root, "missing-target"), type: "directory", createdAt: "invalid" },
    ]), "utf8")
    const fake = await startFakeHost({
      results: {
        import: {
          success: true,
          message: `Imported 1 link record(s) from ${sandbox.legacyPath}; skipped 1 invalid record(s)`,
          data: data({ links: [{ link: sandbox.link, target: sandbox.source, type: "directory", createdAt: "2026-07-10T19:00:00Z" }], importedCount: 1, skippedCount: 1 }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["import", "--path", sandbox.legacyPath, "--configPath", sandbox.configPath, "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ action: "import", path: sandbox.legacyPath, configPath: sandbox.configPath, includeInvalid: false })
    await assertInsideSandbox(sandbox.root, fake.starts[0]?.input.path, "legacy config path")
    // Importing did not write the record here: the host owns the config file.
    expect(host.stdoutText()).toContain("Imported 1 link record(s)")
  })

  test("--includeInvalid travels into the input document", async () => {
    const sandbox = await createSandbox("import-invalid")
    await writeFile(sandbox.legacyPath, legacyToml([{ link: join(sandbox.root, "missing-link"), target: join(sandbox.root, "missing-target"), type: "directory", createdAt: "invalid" }]), "utf8")
    const fake = await startFakeHost({
      results: { import: { success: true, message: "Imported 1 link record(s).", data: data({ importedCount: 1 }) } },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["import", "--path", sandbox.legacyPath, "--configPath", sandbox.configPath, "--includeInvalid", "--json"], host)

    expect(fake.starts[0]?.input).toMatchObject({ action: "import", includeInvalid: true })
  })

  test("restore carries the recorded link and renders the host's restore summary", async () => {
    const sandbox = await createSandbox("restore")
    const fake = await startFakeHost({
      results: {
        restore: {
          success: true,
          message: `Restored ${sandbox.source} to ${sandbox.link} and removed its link record.`,
          data: data({ restoredCount: 1 }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["restore", "--path", sandbox.link, "--configPath", sandbox.configPath], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ action: "restore", path: sandbox.link, configPath: sandbox.configPath })
    await assertInsideSandbox(sandbox.root, fake.starts[0]?.input.path, "restore link")
    const stdout = host.stdoutText()
    expect(stdout).toContain("Restored")
    expect(stdout).toContain("Restore Summary")
    expect(stdout).toContain("已还原")
  })

  test("renders recorded links and host events without --json", async () => {
    const sandbox = await createSandbox("list-render")
    // Display-only record paths, short enough for the 120-column panel: this test is about how a host answer
    // is laid out, and the sandbox containment of real paths is pinned by the create/move/import tests.
    const fake = await startFakeHost({
      events: [{ type: "log", message: "reading records" }],
      results: {
        list: {
          success: true,
          message: "Found 1 link record(s).",
          data: data({ links: [{ link: "D:/links/config", target: "D:/config/system", type: "directory", createdAt: "2026-07-10T19:00:00Z" }] }),
        },
      },
    })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["list", "--configPath", sandbox.configPath], host)

    expect(process.exitCode).toBe(0)
    const stdout = host.stdoutText()
    expect(stdout).toContain("Found 1 link record(s).")
    expect(stdout).toContain("Recorded Links (1)")
    expect(stdout).toContain("reading records")
    expect(stdout).toContain("2026-07-10T19:00:00Z")
  })

  test("applies the operator's configured defaults to the input document", async () => {
    const sandbox = await createSandbox("config-defaults")
    await writeSandboxConfig(sandbox, `[nodes.linku]\ndefault_path = "${tomlString(sandbox.source)}"\ndefault_target = "${tomlString(sandbox.link)}"\n`)
    const fake = await startFakeHost({ results: { create: { success: true, message: "Symlink created", data: data({ created: true }) } } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["create", "--json"], host)

    expect(fake.starts[0]?.input).toMatchObject({ action: "create", path: sandbox.source, target: sandbox.link })
    await assertInsideSandbox(sandbox.root, fake.starts[0]?.input.path, "default path")
    await assertInsideSandbox(sandbox.root, fake.starts[0]?.input.target, "default target")
  })

  test("stops with exit code 1 when it can neither attach nor find a host to start", async () => {
    const sandbox = await createSandbox("no-host")
    // No flags, no environment, no channel file: the face now owns the host lifecycle (ADR-0074 §6), so the
    // only way this run can fail is a host binary that is not there.
    const host = createHost({ XIRANITE_HOST_BIN: join(sandbox.root, "no-such-xiranite-host"), XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["create", "--path", sandbox.source, "--target", sandbox.link, "--configPath", sandbox.configPath, "--json"], host)

    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
    // The hint still travels, because attach remains the way to point at a host that is already running.
    expect(host.stderrText()).toContain("--backend <url> --token <token>")
    expect(host.stderrText()).toContain("XIRANITE_BACKEND_URL")
    expect(host.stderrText()).toContain("XIRANITE_CHANNEL_FILE")
    // The removed compat path created the link in this process. Nothing was created and nothing was recorded.
    expect(existsSync(sandbox.link)).toBe(false)
    expect(await readFileText(sandbox.configPath)).toBe(CONFIG_BASE)
  })

  test("a wrong token is the host's 401, not a silent local run", async () => {
    const sandbox = await createSandbox("wrong-token")
    const fake = await startFakeHost({ results: { create: { success: true, message: "never reached", data: data({ created: true }) } }, token: "other-token" })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["create", "--path", sandbox.source, "--target", sandbox.link, "--configPath", sandbox.configPath, "--json"], host)

    expect(fake.starts.length).toBe(0)
    expect(process.exitCode).toBe(1)
    expect(host.stdoutText()).toBe("")
    expect(existsSync(sandbox.link)).toBe(false)
    expect(await readFileText(sandbox.configPath)).toBe(CONFIG_BASE)
  })

  test("reports an action the host cannot answer as a failure, not as a local run", async () => {
    const sandbox = await createSandbox("unanswered")
    const fake = await startFakeHost({ results: {} })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })

    await runProgram(["move", "--path", sandbox.source, "--target", join(sandbox.root, "relocated"), "--configPath", sandbox.configPath, "--json"], host)

    expect(process.exitCode).toBe(1)
    const result = JSON.parse(host.stdoutText()) as LinkuResult
    expect(result.success).toBe(false)
    expect(result.message).toContain("not answered by this host")
    expect(existsSync(join(sandbox.root, "relocated"))).toBe(false)
  })

  test("guided mode refuses before the first prompt when no host can be reached", async () => {
    const sandbox = await createSandbox("guided-refuse")
    const host = createHost({ XIRANITE_HOST_BIN: join(sandbox.root, "no-host-binary-here"), XIRANITE_CONFIG_PATH: sandbox.configPath })
    // A terminal is present, so the refusal under test is the host one and not the TTY guard above it.
    ;(host.stdin as unknown as { isTTY: boolean }).isTTY = true
    ;(host.stdout as unknown as { isTTY: boolean }).isTTY = true

    await runProgram(["gd"], host)

    expect(process.exitCode).toBe(1)
    // Nothing was asked: the guide's intro and its first prompt both come after the host is resolved.
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("XIRANITE_HOST_BIN points at")
  })

  test("stdin paths become the input document, not a local folder read", async () => {
    const sandbox = await createSandbox("stdin")
    const fake = await startFakeHost({ results: { info: { success: true, message: "Path info loaded.", data: data() } } })
    hosts.push(fake)
    const host = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN, XIRANITE_CONFIG_PATH: sandbox.configPath })
    Object.defineProperty(host.stdin, Symbol.asyncIterator, { value: async function* lines() { yield `${sandbox.file}\n` } })

    await runProgram(["info", "--path", "-", "--json"], host)

    expect(process.exitCode).toBe(0)
    expect(fake.starts[0]?.input).toMatchObject({ path: sandbox.file })
    await assertInsideSandbox(sandbox.root, fake.starts[0]?.input.path, "stdin path")
  })
})

describe("linku terminal definition", () => {
  test("runs on the host and keeps the started operation addressable", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createLinkuHostDefinition(face, {}, "zh")
    const messages: string[] = []

    const running = definition.run({ action: "recover", configPath: "/tmp/xiranite.config.toml" }, (event) => messages.push(event.message))
    await fake.streamOpened
    await definition.cancel?.()
    fake.finish({ success: false, message: "Node operation cancelled.", data: data() })
    const result = await running

    expect(messages).toEqual(["recovering records"])
    expect(result.success).toBe(false)
    expect(result.message).toContain("cancelled")
    // The control call went to the operation this face started, not to some other run.
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/cancel"])
  })

  test("pause and resume use the same operation id", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createLinkuHostDefinition(face, {}, "zh")

    const running = definition.run({ action: "create", path: "D:/源", target: "D:/链接" }, () => undefined)
    await fake.streamOpened
    await definition.pause?.()
    await definition.resume?.()
    fake.finish({ success: true, message: "Symlink created", data: data({ created: true }) })
    const result = await running

    expect(result.success).toBe(true)
    expect(fake.controlPaths).toEqual(["/node-operations/op-hang/pause", "/node-operations/op-hang/resume"])
  })

  test("no control call happens without a running operation", async () => {
    const fake = await startHangingHost()
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createLinkuHostDefinition(face, {}, "zh")

    await definition.cancel?.()
    await definition.pause?.()
    await definition.resume?.()

    expect(fake.controlPaths).toEqual([])
    expect(fake.starts.length).toBe(0)
  })

  /**
   * The link gate travels with the schema into `ui`/`gd`: the session asks for confirmation because the node's
   * schema still calls create/move/recover/restore dangerous, and only then calls `run`. A definition that lost
   * the schema would start a host operation straight away, on a node that moves folders.
   */
  test("the host-backed definition keeps the node's link gate", async () => {
    const fake = await startFakeHost({ results: { create: { success: true, message: "Symlink created", data: data({ created: true }) } } })
    hosts.push(fake)
    const face = createHost({ XIRANITE_BACKEND_URL: fake.baseUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN })
    const definition = createLinkuHostDefinition(face, { default_path: "D:/源", default_target: "D:/链接" }, "zh")

    expect(definition.schema.id).toBe("linku")
    expect(definition.schema.initialValues).toMatchObject({ path: "D:/源", target: "D:/链接" })
    expect(definition.schema.fields.map((field) => field.id)).toEqual(["action", "path", "target", "configPath"])
    for (const action of ["create", "move_link", "recover", "restore"] as const) {
      expect(definition.schema.isDangerous({ action }), action).toBe(true)
    }
    for (const action of ["info", "list"] as const) {
      expect(definition.schema.isDangerous({ action }), action).toBe(false)
    }
    expect(definition.schema.dangerPrompt?.({ action: "restore" })?.title).toBe("确认还原链接")
    expect(definition.schema.dangerPrompt?.({ action: "create" })?.title).toBe("确认文件系统链接操作")

    await definition.run({ action: "create", path: "D:/源", target: "D:/链接" }, () => undefined)
    expect(fake.starts.map((start) => start.input.action)).toEqual(["create"])
  })
})

/**
 * A host whose stream stays open until the test closes it, so the control calls the `ui`/`gd` definition
 * makes during a run can be observed.
 */
interface HangingHost {
  baseUrl: string
  starts: RecordedStart[]
  controlPaths: string[]
  streamOpened: Promise<void>
  finish(result: LinkuResult): void
  close(): Promise<void>
}

async function startHangingHost(): Promise<HangingHost> {
  let resolveOpened: () => void
  const streamOpened = new Promise<void>((resolve) => { resolveOpened = resolve })
  const controlPaths: string[] = []
  const starts: RecordedStart[] = []
  let streamResponse: ServerResponse | undefined

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const path = (request.url ?? "").split("?")[0] ?? ""
      // Token-free on the real host, and this face probes it before it starts an operation.
      if (path === "/health") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: "ok" }))
        return
      }
      if ((request.headers as IncomingHttpHeaders)["x-xiranite-token"] !== HOST_TOKEN) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      const body = Buffer.concat(chunks).toString("utf8")

      if (request.method === "POST" && /^\/nodes\/linku\/operations$/.test(path)) {
        starts.push({ input: JSON.parse(body).input as Record<string, unknown>, rawBody: body })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record("op-hang", "queued") }))
        return
      }
      if (/^\/node-operations\/op-hang\/(cancel|pause|resume)$/.test(path)) {
        controlPaths.push(path)
        const phase = path.endsWith("/cancel") ? "cancelled" : path.endsWith("/pause") ? "paused" : "running"
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record("op-hang", phase) }))
        return
      }
      if (path === "/node-operations/op-hang/stream") {
        streamResponse = response
        response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" })
        response.write(`${JSON.stringify({ type: "operation", operation: record("op-hang", "running", { startedAt: 2 }) })}\n`)
        response.write(`${JSON.stringify({ type: "event", index: 0, event: { type: "progress", progress: 20, message: "recovering records" } })}\n`)
        resolveOpened()
        return
      }
      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "Node operation not found." }))
    })
  })

  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve) })
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    starts,
    controlPaths,
    streamOpened,
    finish: (result) => {
      if (!streamResponse) return
      const operation = { ...record("op-hang", "cancelled"), result }
      streamResponse.write(`${JSON.stringify({ type: "result", operation, result })}\n`)
      streamResponse.end()
    },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => resolve()) })
    },
  }
}

/** The legacy standalone `linku.toml` the `import` action reads; written by the fixture, not by the node. */
function legacyToml(records: { link: string; target: string; type: string; createdAt: string }[]): string {
  const blocks = records.map((record) => [
    "[[links]]",
    `link = "${tomlString(record.link)}"`,
    `target = "${tomlString(record.target)}"`,
    `type = "${tomlString(record.type)}"`,
    `created_at = "${tomlString(record.createdAt)}"`,
    "",
  ].join("\n"))
  return `${["# linku config generated by xiranite", "config_version = 1", "", ...blocks].join("\n").trimEnd()}\n`
}

/** The TOML basic-string spelling of a path, for the sandbox config files. */
function tomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

async function readFileText(path: string): Promise<string> {
  return await readFile(path, "utf8")
}

/** A host attached through the environment, plus the non-TTY face that talks to it. */
function createHost(extraEnv: Record<string, string> = {}): CliHost & { stdoutText: () => string; stderrText: () => string } {
  let stdout = ""
  let stderr = ""
  // Deliberately not spreading process.env: an attach must come from this test, not from the machine
  // running it, and no config file outside the sandbox is read.
  return {
    cwd: process.cwd(),
    env: { ...extraEnv, XIRANITE_CLI_COLUMNS: "120", NO_COLOR: "1" },
    stdin: { isTTY: false } as CliHost["stdin"],
    stdout: {
      isTTY: false,
      columns: 120,
      write(chunk: string) {
        stdout += chunk
        return true
      },
    },
    stderr: {
      isTTY: false,
      columns: 120,
      write(chunk: string) {
        stderr += chunk
        return true
      },
    },
    stdoutText: () => stdout,
    stderrText: () => stderr,
  }
}
