import { createServer, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import type { CliHost } from "@xiranite/cli-runtime"
import type { TerminalInteractionDefinition, TerminalRenderer } from "@xiranite/cli-runtime/interaction"
import { runProgram, SLEEPT_MAX_WAIT_HELP, type SleeptCliDependencies } from "./cli.js"
import { POWER_MODE_VALUES, type SleeptInput, type SleeptResult } from "./core.js"
import { createSleeptInteractionSchema, sleeptInputFromInteractionValues } from "./interaction.js"

const HOST_TOKEN = "sleept-cli-test-token"

/** What the face sent the host: the node id in the route and the input in the body. */
interface RecordedStart {
  nodeId: string
  input: Record<string, unknown>
}

interface FakeHost {
  baseUrl: string
  starts: RecordedStart[]
  close(): Promise<void>
}

/**
 * A scripted stand-in for the Rust host: `/operations` over real HTTP on 127.0.0.1, because the point of
 * these tests is that the face holds no node engine of its own. The bodies follow
 * `crates/xiranite-core/src/operation/dto.rs`; nothing here proves the host is correct — the host's own
 * answers are measured in `crates/xiranite-quickjs-executor/tests/`.
 */
async function startFakeHost(results: Record<string, SleeptResult> = {}): Promise<FakeHost> {
  const starts: RecordedStart[] = []
  const pending = new Map<string, { nodeId: string; input: Record<string, unknown> }>()
  let sequence = 0

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const headers = request.headers as IncomingHttpHeaders
      const path = (request.url ?? "").split("?")[0] ?? ""
      if (path === "/health") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: "ok" }))
        return
      }
      if (headers["x-xiranite-token"] !== HOST_TOKEN) {
        response.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        response.end("Unauthorized")
        return
      }
      const body = Buffer.concat(chunks).toString("utf8")
      if (request.method === "POST" && path.startsWith("/nodes/") && path.endsWith("/operations")) {
        const operationId = `op-${(sequence += 1)}`
        const nodeId = path.split("/")[2] ?? "sleept"
        const input = JSON.parse(body).input as Record<string, unknown>
        starts.push({ nodeId, input })
        pending.set(operationId, { nodeId, input })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(operationId, "queued") }))
        return
      }
      const events = /^\/node-operations\/([^/]+)\/events$/.exec(path)
      if (events?.[1]) {
        // The TUI's task queue reads this route rather than the ndjson stream, and it treats a `completed`
        // operation without a result as a failed run — so a fake that answers the phase alone would look dead.
        const entry = pending.get(events[1])
        const result = results[String(entry?.input?.action ?? "")] ?? { success: false, message: "no scripted result for the polled action", data: {} }
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ operation: record(events[1], "completed", { finishedAt: 4, result }), events: [], from: 0, limit: 100, next: 0, total: 0 }))
        return
      }

      const stream = /^\/node-operations\/([^/]+)\/stream$/.exec(path)
      if (stream?.[1]) {
        const entry = pending.get(stream[1])
        const action = String(entry?.input?.action ?? "")
        const result = results[action] ?? { success: false, message: `no scripted result for ${action}`, data: {} }
        const frames = [
          { type: "operation", operation: record(stream[1], "running", { startedAt: 2 }) },
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

/** The answer the CLI's `status` command and the TUI parity check both ask the host for. */
function scriptedStatus(): Record<string, SleeptResult> {
  return {
    get_stats: {
      success: true,
      message: "Status ready. CPU: 12.0%",
      data: { timerStatus: "idle", remainingSeconds: 0, currentUpload: 0, currentDownload: 0, currentCpu: 12 },
    },
  }
}

/** A countdown answer keyed the way the fake routes: by the action in the input the face sent. */
function scriptedCountdown(message: string): Record<string, SleeptResult> {
  return {
    countdown: {
      success: true,
      message,
      data: { timerStatus: "completed", remainingSeconds: 0, currentUpload: 0, currentDownload: 0, currentCpu: 0 },
    },
  }
}

function record(operationId: string, phase: string, extra: Record<string, unknown> = {}) {
  return { operationId, nodeId: "sleept", phase, createdAt: 1, updatedAt: 2, eventCount: 0, ...extra }
}

const fakeHosts: FakeHost[] = []

afterEach(async () => {
  process.exitCode = 0
  while (fakeHosts.length) await fakeHosts.pop()?.close()
})

describe("sleept CLI interaction contract", () => {
  test("keeps pipe JSON parseable and free from ANSI", async () => {
    const fake = await startFakeHost({
      // The CLI's `status` command asks the host for `get_stats` — the action name is the node's, the word the
      // operator types is the face's. Recorded here so the next reader does not key a script on "status".
      ...scriptedStatus(),
    })
    fakeHosts.push(fake)
    const host = createHost({ backendUrl: fake.baseUrl })

    await runProgram(["status", "--json"], host)

    expect(process.exitCode ?? 0, `stderr was [${host.stderrText()}] stdout was [${host.stdoutText()}]`).toBe(0)
    expect(host.stdoutText()).not.toMatch(/\u001b\[/)
    const result = JSON.parse(host.stdoutText()) as SleeptResult
    expect(result.success).toBe(true)
    expect(result.message).toContain("CPU:")
    expect(result.data?.timerStatus).toBe("idle")
    // The claim the lift rests on: the JSON this face prints came back from the host, and the only engine in
    // the process is the transport that asked for it.
    expect(fake.starts).toHaveLength(1)
    expect(fake.starts[0]?.nodeId).toBe("sleept")
    expect(fake.starts[0]?.input.action).toBe("get_stats")
  }, 20_000)

  /**
   * `--backend`/`--token` are the face's own flags (recipe §2). A run that reaches the fake proves both halves
   * at once: the values were folded into the attach, and they left argv — a `--backend` that reached the
   * command router would end this run on the usage path with exit code 2 instead of a result document.
   */
  test("attaches through the face's own flags without leaking them into argv", async () => {
    const fake = await startFakeHost(scriptedStatus())
    fakeHosts.push(fake)
    const host = createHost({})

    await runProgram(["status", "--json", "--backend", fake.baseUrl, "--token", HOST_TOKEN], host)

    expect(process.exitCode ?? 0, `stderr was [${host.stderrText()}]`).toBe(0)
    expect((JSON.parse(host.stdoutText()) as SleeptResult).data?.timerStatus).toBe("idle")
    expect(fake.starts).toHaveLength(1)
    expect(host.env.XIRANITE_BACKEND_URL).toBeUndefined()
  }, 20_000)

  test("starts the OpenTUI renderer with the package schema used by the GUI mapping", async () => {
    const renderers: TerminalRenderer[] = []
    let captured: TerminalInteractionDefinition<SleeptInput, SleeptResult> | undefined
    const dependencies = createDependencies({
      async runUi(definition, options) {
        renderers.push(options.renderer)
        captured = definition as TerminalInteractionDefinition<SleeptInput, SleeptResult>
      },
    })

    const fake = await startFakeHost(scriptedStatus())
    fakeHosts.push(fake)
    await runProgram(["ui", "--renderer=opentui", "--lang", "zh", "--theme", "high-contrast"], createHost({ tty: true, backendUrl: fake.baseUrl }), dependencies)

    expect(renderers).toEqual(["opentui"])
    expect(captured).toBeDefined()
    const values = { ...captured!.schema.initialValues, action: "get_stats" }
    const uiInput = captured!.schema.toInput(values)
    const guiInput = sleeptInputFromInteractionValues(values)
    expect(uiInput).toEqual(guiInput)
    const result = await captured!.run(uiInput, () => undefined)
    expect(result.success).toBe(true)
    expect(result.data?.timerStatus).toBe("idle")
  }, 20_000)

  test("routes gd and legacy guided to the same compact guide", async () => {
    const runGuide = vi.fn(async () => undefined)
    const dependencies = createDependencies({ runGuide })

    await runProgram(["gd"], createHost({ tty: true }), dependencies)
    await runProgram(["guided"], createHost({ tty: true }), dependencies)

    expect(runGuide).toHaveBeenCalledTimes(2)
  })

  test.each(["ui", "gd", "guided"])("rejects explicit %s mode without a TTY", async (mode) => {
    const host = createHost()
    const dependencies = createDependencies()

    await runProgram([mode], host, dependencies)

    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(host.stdoutText()).toBe("")
    expect(host.stderrText()).toContain("requires an interactive terminal")
    expect(dependencies.runGuide).not.toHaveBeenCalled()
    expect(dependencies.runUi).not.toHaveBeenCalled()
  })

  test("uses configured default only for no-argument TTY invocation", async () => {
    const root = await mkdtemp(join(tmpdir(), "sleept-mode-"))
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.sleept.cli]",
      'default_mode = "gd"',
      'renderer = "opentui"',
      'language = "zh"',
      'theme = "dracula"',
    ].join("\n"), "utf8")
    const runGuide = vi.fn(async () => undefined)
    const dependencies = createDependencies({ runGuide })

    await runProgram([], createHost({ tty: true, configPath }), dependencies)
    expect(runGuide).toHaveBeenCalledTimes(1)

    const pipeHost = createHost({ configPath })
    await runProgram([], pipeHost, dependencies)
    const exitCode = process.exitCode
    process.exitCode = 0
    expect(exitCode).toBe(2)
    expect(pipeHost.stdoutText()).toBe("")
    expect(pipeHost.stderrText()).toContain("No interactive terminal detected")
    expect(runGuide).toHaveBeenCalledTimes(1)
  })

  test("uses configured English as an override to the Chinese UI default", async () => {
    const root = await mkdtemp(join(tmpdir(), "sleept-language-"))
    const configPath = join(root, "xiranite.config.toml")
    await writeFile(configPath, [
      "[nodes.sleept.cli]",
      'language = "en"',
    ].join("\n"), "utf8")
    let language: string | undefined
    const runUi: SleeptCliDependencies["runUi"] = async (_definition, options) => {
      language = options.language
    }

    const fake = await startFakeHost()
    fakeHosts.push(fake)
    await runProgram(["ui"], createHost({ tty: true, configPath, backendUrl: fake.baseUrl }), createDependencies({ runUi }))

    expect(language).toBe("en")
  })

  test("runs a short countdown dry-run as JSON", async () => {
    const fake = await startFakeHost(scriptedCountdown("[dryrun] Countdown completed; simulated sleep."))
    fakeHosts.push(fake)
    const host = createHost({ backendUrl: fake.baseUrl })

    await runProgram(["countdown", "--hours", "0", "--minutes", "0", "--seconds", "1", "--dryrun", "--json"], host)

    expect(process.exitCode ?? 0).toBe(0)
    const result = JSON.parse(host.stdoutText()) as SleeptResult
    expect(result.success).toBe(true)
    expect(result.message).toBe("[dryrun] Countdown completed; simulated sleep.")
    expect(result.data?.timerStatus).toBe("completed")
    expect(fake.starts[0]?.input).toMatchObject({ action: "countdown", hours: 0, minutes: 0, seconds: 1, dryrun: true, powerMode: "sleep" })
  })

  test("parses hibernate as a dry-run power action", async () => {
    const fake = await startFakeHost(scriptedCountdown("[dryrun] Countdown completed; simulated hibernate."))
    fakeHosts.push(fake)
    const host = createHost({ backendUrl: fake.baseUrl })

    await runProgram(["countdown", "--seconds", "1", "--power", "hibernate", "--dryrun", "--json"], host)

    const result = JSON.parse(host.stdoutText()) as SleeptResult
    expect(result.success).toBe(true)
    // What the mode argument means is a fact about what the face *sent*; the message above is the fake's own
    // words, so asserting it alone would prove nothing about the parsing.
    expect(fake.starts[0]?.input).toMatchObject({ powerMode: "hibernate", dryrun: true })
  })

  /**
   * The drift this pins is the silent fallback in `powerMode()`: an unrecognised spelling becomes `sleep`,
   * so a timer set to dim the display would take the machine down instead. Each new mode needs its own row.
   */
  test.each(["display-sleep", "screensaver"] as const)("parses %s as a dry-run power action", async (mode) => {
    const fake = await startFakeHost(scriptedCountdown(`[dryrun] Countdown completed; simulated ${mode}.`))
    fakeHosts.push(fake)
    const host = createHost({ backendUrl: fake.baseUrl })

    await runProgram(["countdown", "--seconds", "1", "--power", mode, "--dryrun", "--json"], host)

    // The silent fallback in `powerMode()` would send `sleep` and the machine would go down instead of dimming.
    expect(fake.starts[0]?.input).toMatchObject({ powerMode: mode, dryrun: true })
    expect(JSON.stringify(fake.starts[0]?.input)).not.toContain('"powerMode":"sleep"')
  })

  test("preserves hibernate from the shared terminal and GUI input mapping", () => {
    expect(sleeptInputFromInteractionValues({ action: "countdown", powerMode: "hibernate" }).powerMode).toBe("hibernate")
  })

  test.each(["display-sleep", "screensaver"] as const)("preserves %s from the shared terminal and GUI input mapping", (mode) => {
    expect(sleeptInputFromInteractionValues({ action: "countdown", powerMode: mode }).powerMode).toBe(mode)
  })

  /**
   * The terminal's vocabulary claim, checked on the schema rather than on a rendered frame: a `select` only
   * puts a window of its options in the tree, so an id lookup in the TUI test would be a gauge that reads
   * "missing" for reasons that have nothing to do with the mode list.
   */
  test("offers every power mode the core defines, labelled in the terminal's own dictionary", () => {
    const field = createSleeptInteractionSchema({}, "zh").fields.find((entry) => entry.id === "powerMode")

    expect(field?.options?.map((option) => option.value)).toEqual([...POWER_MODE_VALUES])
    expect(field?.options?.map((option) => option.label)).toEqual(["睡眠", "休眠", "关机", "重启", "显示器休眠", "进入屏保"])
  })

  test("documents zero maximum wait as indefinite monitoring", () => {
    expect(SLEEPT_MAX_WAIT_HELP).toContain("use 0 to monitor indefinitely")
  })
})

interface TestHost extends CliHost {
  stdoutText: () => string
  stderrText: () => string
}

function createHost(options: { tty?: boolean; configPath?: string; backendUrl?: string } = {}): TestHost {
  let stdout = ""
  let stderr = ""
  const tty = options.tty ?? false
  return {
    cwd: process.cwd(),
    env: {
      ...process.env,
      XIRANITE_CONFIG_PATH: options.configPath ?? join(process.cwd(), "artifacts", "test-runs", "sleept-missing.toml"),
      XIRANITE_CLI_COLUMNS: "120",
      // A face with a backend URL attaches to it and never starts a child host; a face without one would
      // look for a real `xiranite-dev-host` binary, which no unit test should depend on.
      ...(options.backendUrl ? { XIRANITE_BACKEND_URL: options.backendUrl, XIRANITE_BACKEND_TOKEN: HOST_TOKEN } : {}),
    },
    stdin: { isTTY: tty } as CliHost["stdin"],
    stdout: {
      isTTY: tty,
      columns: 120,
      write(chunk: string) {
        stdout += chunk
        return true
      },
    },
    stderr: {
      isTTY: tty,
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

function createDependencies(overrides: Partial<SleeptCliDependencies> = {}): SleeptCliDependencies {
  return {
    runGuide: vi.fn(async () => undefined),
    runUi: vi.fn(async () => undefined) as SleeptCliDependencies["runUi"],
    ...overrides,
  }
}
