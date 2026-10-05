/* @jsxImportSource @opentui/react */
/**
 * The nameu workbench under test.
 *
 * The first case drives the screen with a scripted result document and proves the layout. The second hands the
 * same production screen the production definition (`createNameuHostDefinition`) plus a scripted `/operations`
 * host, so the path from a mouse click on `plan` to `POST /nodes/nameu/operations` and back into the projection
 * panel is covered in one piece — the screen never computes a plan itself. The host is a real `node:http`
 * listener for the same reason it is one in `cli.test.ts`: the attach and the body encodings only count if they
 * survive an actual round trip. No case here needs, or touches, a built Rust host.
 */
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { testRender } from "@opentui/react/test-utils"
import { expect, test, afterEach } from "vitest"
import { act } from "react"
import type { CliHost } from "@xiranite/cli-runtime"
import { sharedHostHandle, stopSharedHost } from "@xiranite/cli-runtime/backend"
import { createNameuHostDefinition } from "./cli.js"
import { createNameuInteractionSchema } from "./interaction.js"
import { NameuTui } from "./Tui.js"
import type { NameuData, NameuResult } from "./core.js"

const HOST_TOKEN = "tui-host-token"
/** Keeps the face from reading the machine's real `[nodes.nameu]` section while the screen runs. */
const ABSENT_CONFIG_PATH = join(tmpdir(), "xiranite-nameu-face-test", "xiranite.config.toml")

function data(partial: Partial<NameuData> = {}): NameuData {
  return {
    action: "plan",
    mode: "multi",
    items: [],
    scannedCount: 0,
    readyCount: 0,
    renamedCount: 0,
    unchangedCount: 0,
    skippedCount: 0,
    conflictCount: 0,
    errorCount: 0,
    errors: [],
    ...partial,
  }
}

function planResult(): NameuResult {
  const items = [
    {
      sourcePath: "D:/archives/Artist/Book Artist.zip",
      targetPath: "D:/archives/Artist/Book [Artist].zip",
      sourceName: "Book Artist.zip",
      targetName: "Book [Artist].zip",
      artistName: "Artist",
      kind: "archive" as const,
      status: "ready" as const,
    },
  ]
  return { success: true, message: "NameU planned 1 item(s).", data: data({ items, scannedCount: 1, readyCount: 1 }) }
}

interface ScriptedHost {
  baseUrl: string
  /** The raw body of the last `POST /nodes/{id}/operations`, so the input document can be read back. */
  startBody(): string | undefined
  nodeId(): string | undefined
  close(): Promise<void>
}

const openHosts: ScriptedHost[] = []

afterEach(async () => {
  for (const host of openHosts.splice(0)) await host.close()
})

async function openScriptedHost(): Promise<ScriptedHost> {
  const recorded: { body?: string; nodeId?: string } = {}
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8")
      const requestedPath = (request.url ?? "").split("?")[0] ?? ""
      // `/health` is the one token-free route the Rust host serves, and the face probes it before it
      // renders anything, so a scripted host that does not answer it looks dead.
      if (requestedPath === "/health") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ status: "ok" }))
        return
      }
      if (request.method === "POST" && /^\/nodes\/[^/]+\/operations$/.test(requestedPath)) {
        recorded.body = body
        recorded.nodeId = decodeURIComponent(requestedPath.split("/")[2] ?? "")
        const result = planResult()
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({
          operation: {
            operationId: "op-tui-1",
            nodeId: recorded.nodeId,
            phase: "completed",
            createdAt: 1,
            updatedAt: 2,
            finishedAt: 2,
            eventCount: 0,
            result,
          },
        }))
        return
      }
      response.writeHead(404, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "Node operation not found." }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = (server.address() as AddressInfo).port
  openHosts.push({
    baseUrl: `http://127.0.0.1:${port}`,
    startBody: () => recorded.body,
    nodeId: () => recorded.nodeId,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  })
  return openHosts[openHosts.length - 1]!
}

/**
 * A `CliHost` for the face-side helpers the host definition uses. Deliberately not spreading `process.env`, so
 * no attach and no config file leak in from the machine running this test.
 */
function faceHost(env: Record<string, string>): CliHost {
  const sink = { isTTY: false, write: () => true }
  return {
    cwd: process.cwd(),
    env,
    stdin: { isTTY: true } as CliHost["stdin"],
    stdout: sink,
    stderr: sink,
  }
}

/** The attach environment for one run: the same object feeds the face host and the shared-handle warm-up. */
function faceEnv(baseUrl: string): Record<string, string> {
  return {
    XIRANITE_BACKEND_URL: baseUrl,
    XIRANITE_BACKEND_TOKEN: HOST_TOKEN,
    XIRANITE_CONFIG_PATH: ABSENT_CONFIG_PATH,
    NO_COLOR: "1",
  }
}

test("NameU renders rename diff and previews in one click", async () => {
  let action: string | undefined
  const schema = createNameuInteractionSchema({ pathsText: "D:/archives" }, "zh")
  const x = await testRender(
    <NameuTui
      definition={{
        schema,
        run: async (input) => {
          action = input.action
          return planResult()
        },
      }}
      language="zh"
      onExit={() => undefined}
    />,
    { width: 142, height: 40, useMouse: true },
  )
  try {
    await act(async () => x.renderOnce())
    expect(x.captureCharFrame()).toContain("NAMEU // RENAME REVIEW DESK")
    const button = x.renderer.root.findDescendantById("nameu-command-plan")
    expect(button).toBeDefined()
    await act(async () => x.mockMouse.click(button!.x + 2, button!.y + Math.max(0, Math.floor((button!.height - 1) / 2))))
    await x.waitFor(() => action === "plan")
    await x.waitFor(() => x.captureCharFrame().includes("改名投影 · 1"))
    expect(x.captureCharFrame()).toContain("Book [Artist].zip")
  } finally {
    await act(async () => x.renderer.destroy())
  }
})

test("the TUI face starts a nameu operation on the host and renders its plan", async () => {
  const host = await openScriptedHost()
  const attachEnv = faceEnv(host.baseUrl)
  // Warm the shared host handle first: the face memoizes an attach per (env, cwd), and without this the click
  // path is a `/health` probe plus a POST, which a frame-counted `waitFor` can lose on a loaded machine.
  await sharedHostHandle({ env: attachEnv, cwd: process.cwd() })
  let x!: Awaited<ReturnType<typeof testRender>>
  try {
    // The run and the control calls are the production host definition; only the paths field is pre-filled
    // through the schema, which is the same seam the layout case above uses and the same one a node config
    // default goes through. Getting a value in is not what this case pins — that a click on `plan` reaches
    // `POST /nodes/nameu/operations` and the answer lands in the projection panel is.
    const definition = {
      ...createNameuHostDefinition(faceHost(attachEnv), {}, "zh"),
      schema: createNameuInteractionSchema({ pathsText: "D:/archives/Artist" }, "zh"),
    }
    await act(async () => {
      x = await testRender(<NameuTui definition={definition} language="zh" onExit={() => undefined} />, { width: 142, height: 40, useMouse: true })
    })

    await act(async () => x.renderOnce())
    expect(x.captureCharFrame()).toContain("NAMEU // RENAME REVIEW DESK")
    // Nothing has been sent yet: opening the screen must not reach the host.
    expect(host.startBody()).toBeUndefined()

    const plan = x.renderer.root.findDescendantById("nameu-command-plan")
    expect(plan).toBeDefined()
    await act(async () => x.mockMouse.click(plan!.x + 2, plan!.y + Math.max(0, Math.floor((plan!.height - 1) / 2))))

    // `waitFor` stays outside `act`: wrapping it makes the wait never resolve, because `act` holds the render
    // passes the predicate needs. The result therefore lands in React's usual "update not wrapped in act"
    // warning, which is noise about the test harness and not about the screen — the assertions below read the
    // frame after the update has already been applied.
    await x.waitFor(() => host.startBody() !== undefined, { maxPasses: 240 })
    const sent = JSON.parse(host.startBody()!) as { input?: { action?: string; paths?: string[] } }
    expect(host.nodeId()).toBe("nameu")
    expect(sent.input?.action).toBe("plan")
    expect(sent.input?.paths).toEqual(["D:/archives/Artist"])

    // The plan the host produced is what the panel shows — the screen never computes it locally.
    await x.waitFor(() => x.captureCharFrame().includes("改名投影 · 1"), { maxPasses: 240 })
    const frame = x.captureCharFrame()
    expect(frame).toContain("Book [Artist].zip")
    expect(frame).toContain("NameU planned 1 item(s).")
  } finally {
    if (x) await act(async () => x.renderer.destroy())
    // The warmed handle belongs to this run: an attached host keeps running, but the memo must not outlive it.
    await stopSharedHost()
  }
})
