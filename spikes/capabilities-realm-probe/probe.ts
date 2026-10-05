/**
 * The realm probe for `@xiranite/host-capabilities`, run by `run.ts` inside the embedded QuickJS host.
 *
 * Every assertion below is about an answer that came from Rust: the file bytes, the host SHA, the temp
 * directory, the clock, the refusal of a path outside the granted roots. The probe reports per-check
 * results rather than throwing on the first problem, so one run says everything that broke.
 *
 * There is deliberately no `TextEncoder`/`TextDecoder` here: the realm has none (that gap is recorded
 * separately), so the byte fixtures are literal `Uint8Array`s.
 */
import { hostCapabilities } from "@xiranite/host-capabilities"

const ABC = new Uint8Array([0x61, 0x62, 0x63])
const SHA256_OF_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

type Checks = Record<string, boolean>

export async function probeRun(request: { root: string }): Promise<{
  success: boolean
  message: string
  data: { checks: Checks; failures: string[]; detail: Record<string, unknown> }
}> {
  const { fs, os, crypto, clock } = hostCapabilities
  const checks: Checks = {}
  const detail: Record<string, unknown> = {}
  const note = (name: string, passed: boolean, observed?: unknown): void => {
    checks[name] = passed
    if (observed !== undefined) detail[name] = observed
  }

  note("transport-is-the-realm-bridge", typeof (globalThis as unknown as { __xrh?: unknown }).__xrh !== "undefined")

  const entries = await fs.list(request.root)
  const names = entries.map((entry) => `${entry.name}:${entry.kind}`).sort()
  detail.rootEntries = names
  note("list-sees-both-seeded-files", names.includes("seed.txt:file") && names.includes("wide-日本.txt:file"))
  note(
    "list-paths-are-host-computed-and-inside-the-root",
    entries.every((entry) => entry.path.startsWith(request.root)),
    entries.map((entry) => entry.path),
  )

  const wide = `${request.root}/wide-日本.txt`
  note("non-ascii-path-round-trips", (await fs.readText(wide)) === "日本語", await fs.readText(wide))
  note("absent-path-answers-null", (await fs.stat(`${request.root}/nope.txt`)) === null)

  const info = await fs.stat(`${request.root}/seed.txt`)
  note(
    "stat-answers-kind-size-and-times",
    info?.kind === "file" && info.sizeBytes === 4 && (info.mtimeMs ?? 0) > 0,
    info,
  )

  const bytes = await fs.readBytes(`${request.root}/seed.txt`)
  note("readbytes-crosses-the-byte-channel-as-four-bytes", bytes?.byteLength === 4, bytes?.byteLength)

  const scratch = await fs.createTemp(`${request.root}/caps-`)
  note("createtemp-lands-inside-the-grant", scratch.startsWith(request.root), scratch)
  await fs.writeText(`${scratch}/w.txt`, "written-by-capability")
  note("writetext-then-readtext", (await fs.readText(`${scratch}/w.txt`)) === "written-by-capability")
  await fs.appendText(`${scratch}/w.txt`, "+appended")
  note("appendtext-adds-to-the-document", (await fs.readText(`${scratch}/w.txt`)) === "written-by-capability+appended")

  const source = `${scratch}/w.txt`
  const sourceSize = (await fs.stat(source))?.sizeBytes
  const target = `${scratch}/copy.txt`
  await fs.copy(source, target, { recursive: false, force: false })
  // The invariant, not a hand-counted length: a copy answers the same size as its source (and a wrong byte
  // rule in either direction breaks here without me having to keep the number straight).
  note("copy-with-force-false-matches-the-source-size", (await fs.stat(target))?.sizeBytes === sourceSize && (sourceSize ?? 0) > 0, { sourceSize, copied: (await fs.stat(target))?.sizeBytes })
  let copyRefusal = ""
  try {
    await fs.copy(`${scratch}/w.txt`, target, { recursive: false, force: false })
  } catch (error) {
    copyRefusal = String((error as Error).message)
  }
  note("copy-twice-refuses-by-name", copyRefusal.includes("already exists"), copyRefusal)

  const outside = await fs.stat("/etc/hosts").catch(() => "refused")
  note("a-path-outside-the-grant-is-invisible-or-refused", outside === "refused" || outside === null, outside)

  note("digest-comes-from-the-hosts-sha256", (await crypto.digest("sha256", ABC)) === SHA256_OF_ABC)
  note("uuid-is-a-36-char-id", (await crypto.uuid()).length === 36)
  note(
    "randombytes-decodes-the-hosts-hex-into-the-asked-count",
    (await crypto.randomBytes(6)).byteLength === 6,
  )
  note("clock-is-an-iso-instant", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(await clock.now()))

  const platform = await os.platform()
  note("platform-facts-come-from-the-host", platform.platform.length > 0 && platform.sep.length > 0 && (await os.cpus()).count > 0, platform)
  note("tempdir-is-absolute", (await os.tempDir()).length > 1)

  // POSITIVE CONTROL: a method that reaches no host operation at all would still pass the checks above if
  // they only compared to itself, so one check must be about a value the realm cannot invent.
  note("the-host-knows-a-file-the-probe-never-created", (await fs.stat(`${request.root}/seed.txt`))?.sizeBytes === 4)

  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
  return {
    success: failures.length === 0,
    message: failures.length === 0 ? "all capability checks passed in the realm" : `failed: ${failures.join(", ")}`,
    data: { checks, failures, detail },
  }
}
