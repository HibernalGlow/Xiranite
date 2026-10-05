import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
  HostAttachmentError,
  createHostOperationsClient,
  extractHostAttachArgs,
  resolveHostAttachment,
} from "./backend.js"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

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
