/**
 * The coverage gate for the capability surface, plus a real behaviour run of the Node transport.
 *
 * Why a test rather than only the type: `CAPABILITY_FOR_OPERATION` is `satisfies Record<HostOperationName, …>`,
 * so `tsc` already refuses a missing or extra operation. What types cannot see is a transport that names
 * every method and implements none — a `HostCapabilities` object full of stubs type-checks. So this file
 * walks the mapped paths against both transports, runs the Node transport against a real temp directory,
 * and keeps a positive control: an intentionally short transport **must** be rejected, or the assertion is
 * not measuring anything.
 */
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { HOST_OPERATION_NAMES } from "./operations.generated.js"
import { CAPABILITY_FOR_OPERATION, CAPABILITY_PATHS, assertCoverage, operationFor } from "./contract.js"
import { nodeCapabilities } from "./node.js"
import { realmCapabilities } from "./realm.js"

describe("capability surface covers the host vocabulary exactly", () => {
  it("maps every host operation and nothing else", () => {
    expect(Object.keys(CAPABILITY_FOR_OPERATION).sort()).toEqual([...HOST_OPERATION_NAMES].sort())
  })

  it("names a capability for each operation, and the reverse lookup answers", () => {
    for (const operation of HOST_OPERATION_NAMES) {
      const capability = CAPABILITY_FOR_OPERATION[operation]
      expect(capability, `${operation} maps to nothing`).toMatch(/^[a-z]+\.[a-zA-Z]+$/)
      expect(operationFor(capability)).toBe(operation)
    }
  })

  it("the realm transport implements every mapped method", () => {
    expect(() => assertCoverage(realmCapabilities, "realm")).not.toThrow()
  })

  it("the node transport implements every mapped method", () => {
    expect(() => assertCoverage(nodeCapabilities, "node")).not.toThrow()
  })

  it("POSITIVE CONTROL: a short transport is rejected, so the two checks above can fail", () => {
    const short: Record<string, unknown> = { fs: { stat: () => Promise.resolve(null) } }
    expect(() => assertCoverage(short, "hollow")).toThrow(/implements none of/)
  })
})

describe("node transport against a real directory", () => {
  let root = ""

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "host-capabilities-"))
  })
  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("writes, reads, stats, lists, moves, copies and removes", async () => {
    const file = join(root, "a.txt")
    await nodeCapabilities.fs.writeText(file, "hello")
    expect(await nodeCapabilities.fs.readText(file)).toBe("hello")
    expect(await nodeCapabilities.fs.readText(join(root, "absent.txt"))).toBeNull()

    const stats = await nodeCapabilities.fs.stat(file)
    expect(stats?.kind).toBe("file")
    expect(stats?.sizeBytes).toBe(5)
    expect(await nodeCapabilities.fs.stat(join(root, "absent.txt"))).toBeNull()

    await nodeCapabilities.fs.appendText(file, " world")
    expect(await nodeCapabilities.fs.readText(file)).toBe("hello world")

    const moved = join(root, "nested", "b.txt")
    await nodeCapabilities.fs.move(file, moved)
    expect(await nodeCapabilities.fs.stat(file)).toBeNull()
    await nodeCapabilities.fs.copy(moved, join(root, "c.txt"), { recursive: false })
    expect((await nodeCapabilities.fs.list(root)).map((entry) => entry.name).sort()).toEqual(["c.txt", "nested"])

    const bytes = await nodeCapabilities.fs.readBytes(moved)
    expect(new TextDecoder().decode(bytes)).toBe("hello world")
    expect((await nodeCapabilities.fs.readBytes(moved, { offset: 99, length: 4 }))?.byteLength).toBe(0)

    const scratch = await nodeCapabilities.fs.createTemp("cap-")
    expect((await nodeCapabilities.fs.stat(scratch))?.kind).toBe("dir")
    await nodeCapabilities.fs.remove(scratch, { recursive: true })
    expect(await nodeCapabilities.fs.stat(scratch)).toBeNull()
    await rm(scratch, { recursive: true, force: true })
  })

  it("links, realpaths and sets times", async () => {
    const target = join(root, "link-target.txt")
    await nodeCapabilities.fs.writeText(target, "t")
    const link = join(root, "as-link.txt")
    await nodeCapabilities.fs.hardLink(target, link)
    expect((await nodeCapabilities.fs.stat(link))?.sizeBytes).toBe(1)
    // A hard link is a directory entry, not a pointer: realpath resolves the temporary directory's own
    // symlinked prefix and lands on the entry, and readlink has nothing to answer.
    await expect(nodeCapabilities.fs.readLink(link)).rejects.toThrow(/EINVAL|ENOENT/)
    expect((await nodeCapabilities.fs.realPath(link)).endsWith("as-link.txt")).toBe(true)

    const symbolic = join(root, "as-symlink.txt")
    await nodeCapabilities.fs.symbolicLink(target, symbolic, "file")
    expect(await nodeCapabilities.fs.readLink(symbolic)).toBe(target)
    expect((await nodeCapabilities.fs.stat(symbolic))?.kind).toBe("symlink")

    const when = 1_700_000_000_000
    await nodeCapabilities.fs.setTimes(link, { atimeMs: when, mtimeMs: when })
    expect((await nodeCapabilities.fs.stat(link))?.mtimeMs).toBeCloseTo(when, 0)
  })

  it("answers a non-zero exit as a value, not a throw", async () => {
    const result = await nodeCapabilities.proc.exec(process.execPath, ["-e", "process.exit(3)"])
    expect(result.exitCode).toBe(3)
    expect(result.truncated).toBe(false)
    const noise = await nodeCapabilities.proc.exec(process.execPath, ["-e", "console.error('bad')"])
    expect(noise.exitCode).toBe(0)
    expect(noise.stderr).toContain("bad")
  })

  it("starts a child, polls it, and reaps it with its transcript", async () => {
    const started = await nodeCapabilities.proc.start(
      process.execPath,
      ["-e", "console.log('out');setTimeout(()=>process.exit(0),50)"],
      {},
    )
    expect(started.pid).toBeGreaterThan(0)
    const settled = await nodeCapabilities.proc.wait(started.handle)
    expect(settled.running).toBe(false)
    expect(settled.stdout).toContain("out")
  })

  it("the host-owned answers come from one implementation each", async () => {
    expect(await nodeCapabilities.crypto.digest("sha256", new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    )
    expect((await nodeCapabilities.crypto.uuid()).length).toBe(36)
    expect((await nodeCapabilities.crypto.randomBytes(8)).byteLength).toBe(8)
    expect(await nodeCapabilities.clock.now()).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect((await nodeCapabilities.os.cpus()).count).toBeGreaterThan(0)
    expect((await nodeCapabilities.os.platform()).sep.length).toBeGreaterThan(0)
  })

  it("refuses a host service by name instead of answering an empty object", async () => {
    await expect(nodeCapabilities.service.invoke("czkawka", "findDuplicates")).rejects.toThrow(/host process/)
  })
})
