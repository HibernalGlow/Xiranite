import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
  HostAttachmentError,
  assertHostReachable,
  attachOrStartHost,
  createHostOperationsClient,
  extractHostAttachArgs,
  isHostAttachConfigured,
  resolveHostAttachment,
} from "./backend.js"

const tempDirs: string[] = []
const openServers: Server[] = []
const startedHandles: { stop(): Promise<void> }[] = []

afterEach(async () => {
  await Promise.all(startedHandles.splice(0).map((handle) => handle.stop()))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  await Promise.all(openServers.splice(0).map((server) => closeServer(server)))
})

/** A listener that answers `GET <path>` with `status`, to stand in for a live or half-live host. */
async function listeningServer(handler: (url: string, response: import("node:http").ServerResponse) => void): Promise<{ baseUrl: string; port: number }> {
  const server = createServer((request, response) => handler(request.url ?? "", response))
  openServers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${address.port}`, port: address.port }
}

/** Takes a listener back out of the cleanup list and closes it, so the next request to it is refused. */
async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) throw new Error("no test server to close")
  // `close()` waits for idle keep-alive sockets too, and `fetch` holds them; without this the
  // "port that is not listening" fixture would never resolve.
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
}

async function channelFile(contents: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "xiranite-host-attach-"))
  tempDirs.push(dir)
  const path = join(dir, "channel.json")
  await writeFile(path, typeof contents === "string" ? contents : JSON.stringify(contents), "utf8")
  return path
}

describe("resolveHostAttachment", () => {
  test("takes explicit flags over the environment and a channel file", async () => {
    const path = await channelFile({ baseUrl: "http://127.0.0.1:1/from-file", token: "file-token", instanceId: "file-instance" })

    const attachment = await resolveHostAttachment({
      args: ["nested", "--backend", "http://127.0.0.1:9/from-flag", "--token=flag-token", "--path", "D:/a"],
      env: {
        XIRANITE_BACKEND_URL: "http://127.0.0.1:8/from-env",
        XIRANITE_BACKEND_TOKEN: "env-token",
        XIRANITE_CHANNEL_FILE: path,
      },
    })

    expect(attachment.baseUrl).toBe("http://127.0.0.1:9/from-flag")
    expect(attachment.token).toBe("flag-token")
    // The channel file is the only publisher of an instance id, so it still travels.
    expect(attachment.instanceId).toBe("file-instance")
  })

  test("uses the environment when no flag is present", async () => {
    const attachment = await resolveHostAttachment({
      args: ["plan", "--json"],
      env: { XIRANITE_BACKEND_URL: "127.0.0.1:4319", XIRANITE_BACKEND_TOKEN: "env-token" },
    })

    expect(attachment).toEqual({ baseUrl: "http://127.0.0.1:4319", token: "env-token", instanceId: undefined })
  })

  test("falls back to the channel file and carries its instance id", async () => {
    const path = await channelFile({ baseUrl: "http://127.0.0.1:5555/xiranite", token: "file-token", instanceId: "inst-7" })

    const attachment = await resolveHostAttachment({ args: [], env: { XIRANITE_CHANNEL_FILE: path } })

    expect(attachment).toEqual({ baseUrl: "http://127.0.0.1:5555/xiranite", token: "file-token", instanceId: "inst-7" })
  })

  test("reads the channel file from the flag spelling ADR-0074 §6 hands in", async () => {
    const path = await channelFile({ baseUrl: "http://127.0.0.1:6060", token: "flag-file-token", instanceId: "inst-9" })

    const attachment = await resolveHostAttachment({ args: ["--channel-file", path], env: {} })

    expect(attachment).toEqual({ baseUrl: "http://127.0.0.1:6060", token: "flag-file-token", instanceId: "inst-9" })
  })

  test("resolves each field by precedence, so a flag token can pair with an env url", async () => {
    const attachment = await resolveHostAttachment({
      args: ["--token=flag-token"],
      env: { XIRANITE_BACKEND_URL: "http://127.0.0.1:7000" },
    })

    expect(attachment).toEqual({ baseUrl: "http://127.0.0.1:7000", token: "flag-token", instanceId: undefined })
  })

  test("fails with a message naming all three attach ways", async () => {
    const error = await resolveHostAttachment({ args: [], env: {} }).then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(HostAttachmentError)
    expect((error as HostAttachmentError).kind).toBe("missing")
    const message = (error as HostAttachmentError).message
    expect(message).toContain("--backend <url> --token <token>")
    expect(message).toContain("XIRANITE_BACKEND_URL=<url> and XIRANITE_BACKEND_TOKEN=<token>")
    expect(message).toContain("XIRANITE_CHANNEL_FILE")
  })

  test("refuses a half-configured environment instead of guessing a host", async () => {
    const error = await resolveHostAttachment({
      args: [],
      env: { XIRANITE_BACKEND_URL: "http://127.0.0.1:7000" },
    }).then(() => undefined, (cause: unknown) => cause)

    expect((error as HostAttachmentError).kind).toBe("missing")
    expect((error as HostAttachmentError).message).toContain("no bearer token")
  })

  test("reports an unreadable or malformed channel file as its own failure", async () => {
    const broken = await channelFile("{not json")
    const invalid = await resolveHostAttachment({ args: [], env: { XIRANITE_CHANNEL_FILE: broken } })
      .then(() => undefined, (cause: unknown) => cause)
    expect((invalid as HostAttachmentError).kind).toBe("invalid")
    expect((invalid as HostAttachmentError).message).toContain("is not JSON")

    const missing = await resolveHostAttachment({
      args: [],
      env: { XIRANITE_CHANNEL_FILE: join(tmpdir(), "definitely-not-here.json") },
    }).then(() => undefined, (cause: unknown) => cause)
    expect((missing as HostAttachmentError).kind).toBe("missing")
    expect((missing as HostAttachmentError).message).toContain("cannot be read")
  })

  test("rejects a host url that is not http", async () => {
    const error = await resolveHostAttachment({
      args: ["--backend", "ftp://127.0.0.1/x", "--token", "t"],
      env: {},
    }).then(() => undefined, (cause: unknown) => cause)

    expect((error as HostAttachmentError).kind).toBe("invalid")
    expect((error as HostAttachmentError).message).toContain("must be http or https")
  })
})

describe("extractHostAttachArgs", () => {
  test("strips the attach flags and leaves the node's own argv untouched", () => {
    const extracted = extractHostAttachArgs([
      "dissolve",
      "--backend=http://127.0.0.1:9",
      "--path",
      "D:/a",
      "--token",
      "t-1",
      "--channel-file=/tmp/host.json",
      "--json",
    ])

    expect(extracted.flags).toEqual({
      backend: "http://127.0.0.1:9",
      token: "t-1",
      channelFile: "/tmp/host.json",
    })
    expect(extracted.remaining).toEqual(["dissolve", "--path", "D:/a", "--json"])
  })

  test("keeps a dangling flag as an ordinary argument", () => {
    const extracted = extractHostAttachArgs(["plan", "--token"])

    expect(extracted.flags).toEqual({})
    expect(extracted.remaining).toEqual(["plan", "--token"])
  })
})

describe("createHostOperationsClient", () => {
  test("binds the client to the resolved host", async () => {
    const client = await createHostOperationsClient({
      args: [],
      env: { XIRANITE_BACKEND_URL: "http://127.0.0.1:4319/_xiranite/backend", XIRANITE_BACKEND_TOKEN: "t" },
    })

    expect(client.baseUrl).toBe("http://127.0.0.1:4319/_xiranite/backend")
  })

  test("refuses to build a client when no host is attached", async () => {
    await expect(createHostOperationsClient({ args: [], env: {} })).rejects.toBeInstanceOf(HostAttachmentError)
  })
})

describe("assertHostReachable", () => {
  test("accepts a host that answers /health", async () => {
    const server = await listeningServer((url, response) => {
      response.writeHead(url === "/health" ? 200 : 404)
      response.end("{}")
    })

    const attachment = await assertHostReachable({ env: { XIRANITE_BACKEND_URL: server.baseUrl, XIRANITE_BACKEND_TOKEN: "t" } })

    expect(attachment.baseUrl).toBe(server.baseUrl)
  })

  test("keeps a base path when probing, because the legacy backend is served under one", async () => {
    const seen: string[] = []
    const server = await listeningServer((url, response) => {
      seen.push(url)
      response.writeHead(200)
      response.end("{}")
    })

    await assertHostReachable({ env: { XIRANITE_BACKEND_URL: `${server.baseUrl}/_xiranite/backend`, XIRANITE_BACKEND_TOKEN: "t" } })

    expect(seen).toEqual(["/_xiranite/backend/health"])
  })

  test("names a port that is not listening as a host that does not answer", async () => {
    const closed = await listeningServer((_url, response) => {
      response.writeHead(200)
      response.end("{}")
    })
    await closeServer(openServers.pop())

    const error = await assertHostReachable({ env: { XIRANITE_BACKEND_URL: closed.baseUrl, XIRANITE_BACKEND_TOKEN: "t" } })
      .then(() => undefined, (cause: unknown) => cause)

    expect((error as HostAttachmentError).kind).toBe("missing")
    expect((error as HostAttachmentError).message).toContain("does not answer /health")
  })

  test("separates a live port from a Xiranite host", async () => {
    const notXiranite = await listeningServer((_url, response) => {
      response.writeHead(503)
      response.end("nope")
    })

    const error = await assertHostReachable({ env: { XIRANITE_BACKEND_URL: notXiranite.baseUrl, XIRANITE_BACKEND_TOKEN: "t" } })
      .then(() => undefined, (cause: unknown) => cause)

    expect((error as HostAttachmentError).kind).toBe("invalid")
    expect((error as HostAttachmentError).message).toContain("answered /health with 503")
  })
})

describe("isHostAttachConfigured", () => {
  test("treats a half-named host as configured, because guessing over it would start a second host", () => {
    expect(isHostAttachConfigured({ env: {} })).toBe(false)
    expect(isHostAttachConfigured({ env: { XIRANITE_BACKEND_URL: "http://127.0.0.1:1" } })).toBe(true)
    expect(isHostAttachConfigured({ env: { XIRANITE_BACKEND_TOKEN: "t" } })).toBe(true)
    expect(isHostAttachConfigured({ env: { XIRANITE_CHANNEL_FILE: "/tmp/host.json" } })).toBe(true)
    expect(isHostAttachConfigured({ args: ["--channel-file", "/tmp/host.json"], env: {} })).toBe(true)
  })
})

/**
 * A stand-in for the child the face spawns, written the way an executable can be made without a compiler:
 * a POSIX shebang script. The success path is therefore POSIX-only — Windows cannot spawn a `.cmd`
 * without a shell and cannot synthesise an `.exe` — while every failure path below runs on every platform
 * through `process.execPath`, which really is an executable and really does reject `--ttl-seconds`.
 */
async function fakeHostScript(
  channel: unknown,
  options: { stayAlive?: boolean; printBefore?: string; silent?: boolean; reportPid?: boolean } = {},
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "xiranite-host-spawn-"))
  tempDirs.push(dir)
  const path = join(dir, "fake-host.sh")
  const lines = ["#!/bin/sh"]
  if (options.printBefore) lines.push(`echo '${options.printBefore}'`)
  if (!options.silent) {
    if (typeof channel === "string") lines.push(`echo '${channel}'`)
    else {
      const document = options.reportPid
        ? JSON.stringify({ ...(channel as object), instanceId: "pid-$$" })
        : JSON.stringify(channel)
      // Double quotes so the shell expands `$$`; the JSON quotes are escaped for it.
      lines.push(`echo "XIRANITE_CHANNEL ${document.replace(/"/g, '\\"')}"`)
    }
  }
  lines.push(options.stayAlive || options.silent ? "exec sleep 30" : "exit 3")
  await writeFile(path, `${lines.join("\n")}\n`, "utf8")
  await chmod(path, 0o755)
  return path
}

describe("attachOrStartHost", () => {
  test("attaches to a configured host and never starts one of its own", async () => {
    const live = await listeningServer((url, response) => {
      response.writeHead(url === "/health" ? 200 : 404)
      response.end("{}")
    })
    // A host binary that cannot run: if the resolver spawned it, this call would fail instead of attaching.
    const handle = await attachOrStartHost({
      env: {
        XIRANITE_BACKEND_URL: live.baseUrl,
        XIRANITE_BACKEND_TOKEN: "attach-token",
        XIRANITE_HOST_BIN: join(tmpdir(), "this-host-binary-is-not-here"),
      },
    })
    startedHandles.push(handle)

    expect(handle.spawned).toBe(false)
    expect(handle.attachment).toEqual({ baseUrl: live.baseUrl, token: "attach-token", instanceId: undefined })
    await expect(handle.stop()).resolves.toBeUndefined()
  })

  test("reports a configured-but-dead host instead of quietly starting another", async () => {
    const dead = await listeningServer((_url, response) => {
      response.writeHead(200)
      response.end("{}")
    })
    await closeServer(openServers.pop())

    const error = await attachOrStartHost({
      env: { XIRANITE_BACKEND_URL: dead.baseUrl, XIRANITE_BACKEND_TOKEN: "t", XIRANITE_HOST_BIN: process.execPath },
    }).then(() => undefined, (cause: unknown) => cause)

    // `process.execPath` really is runnable, so this message can only come from the attach branch.
    expect((error as HostAttachmentError).message).toContain("does not answer /health")
  })

  test("fails with its own message when no host binary was found", async () => {
    const error = await attachOrStartHost({ env: { XIRANITE_HOST_BIN: join(tmpdir(), "not-a-host-binary") } })
      .then(() => undefined, (cause: unknown) => cause)

    expect((error as HostAttachmentError).kind).toBe("missing")
    expect((error as HostAttachmentError).message).toContain("XIRANITE_HOST_BIN points at")
  })

  test("quotes the child's own refusal when it dies before publishing a channel", async () => {
    const error = await attachOrStartHost({ env: { XIRANITE_HOST_BIN: process.execPath } })
      .then(() => undefined, (cause: unknown) => cause)

    // Node answers `--ttl-seconds` with `bad option` on stderr and exit code 9, on every platform.
    expect((error as HostAttachmentError).message).toContain("before publishing a channel")
    expect((error as HostAttachmentError).message).toContain("bad option")
  })

  const posix = process.platform !== "win32"
  test.skipIf(!posix)("starts a host child, reads its channel off the pipe, and stops it again", async () => {
    const listening = await listeningServer((_url, response) => {
      response.writeHead(200)
      response.end("{}")
    })
    const binary = await fakeHostScript({ baseUrl: listening.baseUrl, token: "child-token" }, { stayAlive: true, reportPid: true, printBefore: "xiranite-dev-host: staged 1 node bundle(s)" })

    const handle = await attachOrStartHost({ env: { XIRANITE_HOST_BIN: binary } })
    startedHandles.push(handle)

    expect(handle.spawned).toBe(true)
    // A prose line on stdout must not confuse the reader, and `$$` is the child's own pid.
    const pid = Number(handle.attachment.instanceId?.replace("pid-", ""))
    expect(handle.attachment).toMatchObject({ baseUrl: listening.baseUrl, token: "child-token" })
    // Positive control: the child really is running, so the claim below cannot be vacuous.
    expect(() => process.kill(pid, 0)).not.toThrow()

    // stop() resolves on the child's exit, so this is the leak guard being real.
    await expect(handle.stop()).resolves.toBeUndefined()
    expect(() => process.kill(pid, 0)).toThrow(/no such process|ESRCH/)
  })

  test.skipIf(!posix)("refuses a channel line it cannot use", async () => {
    const binary = await fakeHostScript({ baseUrl: "http://127.0.0.1:59997", token: "" })

    const error = await attachOrStartHost({ env: { XIRANITE_HOST_BIN: binary } })
      .then(() => undefined, (cause: unknown) => cause)

    expect((error as HostAttachmentError).kind).toBe("invalid")
    expect((error as HostAttachmentError).message).toContain("unusable channel line")
  })

  test.skipIf(!posix)("gives up on a child that never publishes a channel", async () => {
    // Silent on purpose: a child that prints would win the race against a short timeout, and the test
    // would pass without ever exercising the wait.
    const binary = await fakeHostScript({ baseUrl: "http://127.0.0.1:59999", token: "t" }, { silent: true })

    const error = await attachOrStartHost({ env: { XIRANITE_HOST_BIN: binary } }, 250)
      .then(() => undefined, (cause: unknown) => cause)

    expect((error as HostAttachmentError).message).toContain("did not publish a channel within 250ms")
  })

  test.skipIf(!posix)("keeps an inherited channel-file path off disk when the channel goes to the pipe", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xiranite-host-pipe-"))
    tempDirs.push(dir)
    const channelPath = join(dir, "leaked-channel.json")
    // The parent environment names a channel file; the face's own sources do not, so this is the
    // auto-start branch, and a bearer token must not appear at a path nobody asked for.
    process.env.XIRANITE_CHANNEL_FILE = channelPath
    try {
      const binary = await fakeHostScript({ baseUrl: "http://127.0.0.1:59998", token: "t" }, { stayAlive: true })
      const handle = await attachOrStartHost({ env: { XIRANITE_HOST_BIN: binary } }, 2_000)
      startedHandles.push(handle)

      expect(existsSync(channelPath)).toBe(false)
    } finally {
      delete process.env.XIRANITE_CHANNEL_FILE
    }
  })
})
