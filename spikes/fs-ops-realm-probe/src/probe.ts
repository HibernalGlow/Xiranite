/**
 * Realm-side probe for the fs/os operations that were wired in this pass — `fs.mkdtemp`, `fs.copy`,
 * `fs.appendText`, `fs.utimes`, `fs.link`, `fs.symlink`, `fs.readlink`, `fs.realpath`, `os.cpus`, `os.homedir`.
 *
 * These had never been called from JS before (the host answered them, the shim threw), so the only proof that the
 * wire names and answer keys match Rust is a real call through a real `__xrh`. `quickjs-run` grants exactly one
 * directory and hands it to the operation, so the same probe doubles as the grant check: a path outside the root
 * must come back refused, not answered.
 *
 * Two assertions exist specifically to be able to fail:
 * - `utimes-seconds-not-ms`: Node's `utimes(path, 1000, 2000)` is **seconds** (measured on Node 26 → `mtimeMs`
 *   `2000000`), while `fs.utimes` takes milliseconds. Passing Node's number straight through would leave
 *   `mtimeMs === 2000` and still report success.
 * - `cpus-carry-no-fabricated-times`: the host answers `{ model, speed, logical }`. A zero-filled `times` would
 *   look right and read as "this CPU has done nothing" to anything sampling deltas.
 */
import { constants as fsConstants, copyFileSync, cpSync, linkSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, statSync, appendFileSync, symlinkSync, utimesSync } from "node:fs"
import { appendFile, copyFile, cp, link, mkdir, mkdtemp, readlink, realpath, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises"
import { availableParallelism, cpus, homedir } from "node:os"

interface Check {
  name: string
  ok: boolean
  detail?: unknown
}

interface ProbeInput {
  dir: string
}

/** Refusals are data in this substrate; a refusal is what a passing negative control reports. */
function failureOf(call: () => unknown): { threw: boolean; code?: string; message: string } {
  try {
    call()
    return { threw: false, message: "did not throw" }
  } catch (error) {
    const typed = error as Error & { code?: string }
    return { threw: true, code: typed.code, message: typed.message }
  }
}

/** The value-or-refusal form: an assertion that wants what a call *answered*, not only whether it threw. */
function valueOrError<T>(call: () => T): { threw: boolean; value?: T; code?: string; message: string } {
  try {
    return { threw: false, value: call(), message: "" }
  } catch (error) {
    const typed = error as Error & { code?: string }
    return { threw: true, code: typed.code, message: typed.message }
  }
}

/** The awaitable form — `failureOf` around an `async` call captures nothing, which is how one probe lied once. */
async function rejectionOf(call: () => Promise<unknown>): Promise<{ threw: boolean; message: string }> {
  try {
    await call()
    return { threw: false, message: "did not reject" }
  } catch (error) {
    return { threw: true, message: (error as Error).message }
  }
}

export async function run(input: ProbeInput): Promise<{ checks: Check[]; failures: string[] }> {
  const checks: Check[] = []
  const check = (name: string, ok: boolean, detail?: unknown): void => {
    checks.push(ok ? { name, ok } : { name, ok, detail })
  }
  const root = String(input?.dir ?? "")
  const path = (name: string): string => `${root}/${name}`
  // The host answers canonical paths, and on macOS `/var` canonicalizes to `/private/var`, so every "is this
  // inside the granted directory" assertion compares against the canonical form rather than the string handed in.
  const realRoot = realpathSync(root)

  // --- mkdtemp, both faces. ---
  const made = await mkdtemp(path("mk-"))
  check("mkdtemp-answers-a-path-inside-the-grant", typeof made === "string" && made.startsWith(`${realRoot}/mk-`), { made, realRoot })
  check("mkdtemp-directory-exists", (await stat(made)).isDirectory() === true)
  const madeSync = mkdtempSync(path("mk2-"))
  check("mkdtempSync-exists", statSync(madeSync).isDirectory() === true, madeSync)

  // --- writeText / appendText, and the byte rejection that is still honest. ---
  const text = path("note.txt")
  await writeFile(text, "abc", "utf8")
  await appendFile(text, "def", "utf8")
  check("appendFile-grew-the-document", readFileSync(text, "utf8") === "abcdef", readFileSync(text, "utf8"))
  appendFileSync(text, "g")
  check("appendFileSync-grew-the-document", readFileSync(text, "utf8") === "abcdefg")
  const binaryAppend = failureOf(() => appendFileSync(text, new Uint8Array([1, 2])))
  check("appendFile-binary-refuses-naming-the-byte-channel", binaryAppend.threw && binaryAppend.message.includes("fs.writeBytes"), binaryAppend)

  // --- copy: Node's overwrite default, COPYFILE_EXCL, and cp's EISDIR rule. ---
  const copyTarget = path("copy.txt")
  await copyFile(text, copyTarget)
  check("copyFile-target-content", readFileSync(copyTarget, "utf8") === "abcdefg")
  await copyFile(text, copyTarget)
  check("copyFile-default-overwrites-like-node", readFileSync(copyTarget, "utf8") === "abcdefg")
  const excl = failureOf(() => copyFileSync(text, copyTarget, fsConstants.COPYFILE_EXCL))
  check("copyFileSync-EXCL-refuses-an-existing-target", excl.threw && excl.code === "EEXIST", excl)
  const dirSource = path("tree")
  await mkdir(dirSource, { recursive: true })
  await writeFile(path("tree/inner.txt"), "I", "utf8")
  const eisdir = failureOf(() => cpSync(dirSource, path("tree-copy")))
  check("cpSync-directory-without-recursive-is-EISDIR", eisdir.threw && eisdir.code === "ERR_FS_EISDIR", eisdir)
  await cp(dirSource, path("tree-copy"), { recursive: true })
  check("cp-recursive-copied-the-child", readFileSync(path("tree-copy/inner.txt"), "utf8") === "I")
  const filtered = await rejectionOf(() => cp(text, path("filtered.txt"), { filter: () => true }))
  check("cp-filter-is-refused-not-ignored", filtered.threw && filtered.message.includes("filter"), filtered)

  // --- utimes: the unit trap. ---
  await utimes(text, 1000, 2000)
  const timed = statSync(text)
  check("utimes-seconds-not-ms", timed.mtimeMs === 2000000 && timed.atimeMs === 1000000, { mtimeMs: timed.mtimeMs, atimeMs: timed.atimeMs })
  await utimes(text, new Date(1234567890123), new Date(1234567890456))
  check("utimes-Date-uses-its-own-ms", Math.abs(statSync(text).mtimeMs - 1234567890456) <= 1000, statSync(text).mtimeMs)
  utimesSync(text, "3", "9")
  check("utimesSync-numeric-string-is-seconds", statSync(text).mtimeMs === 9000, statSync(text).mtimeMs)

  // --- links. ---
  const hard = path("hard.txt")
  linkSync(text, hard)
  check("linkSync-shares-the-content", readFileSync(hard, "utf8") === readFileSync(text, "utf8"))

  /**
   * `symlink` is probed in three shapes because the host may check the *stored target text* against the granted
   * roots, which Node does not: in Node `symlink("note.txt", link)` stores the string and resolves it only when
   * something reads the link. Each shape is reported instead of aborting the run, so one document says which form
   * the host answers and which it refuses — the relative form is what `linku` builds most.
   */
  const linkAbsolute = path("sym-absolute.txt")
  const relativeAttempt = failureOf(() => symlinkSync("note.txt", path("sym-relative.txt")))
  // Pinned as a *refusal* because that is the host's capability rule today (see `opFsSymlink`'s note): the stored
  // target text goes through the granted-roots check, which Node does not do. If the host ever answers a relative
  // target, this check goes red and the disclosure in ops.ts has to be rewritten — not the other way round.
  check("symlink-relative-target-is-refused-by-the-grant(disclosed-divergence)", relativeAttempt.threw && /authorized roots/i.test(relativeAttempt.message), relativeAttempt)
  const absoluteAttempt = failureOf(() => symlinkSync(text, linkAbsolute))
  check("symlink-absolute-target-inside-grant-is-accepted", !absoluteAttempt.threw, absoluteAttempt)
  const outsideAttempt = failureOf(() => symlinkSync("/etc/hosts", path("sym-outside.txt")))
  check("symlink-target-outside-the-grant-is-refused", outsideAttempt.threw, outsideAttempt)

  if (!absoluteAttempt.threw) {
    check("readlink-returns-the-stored-text", readlinkSync(linkAbsolute) === text, readlinkSync(linkAbsolute))
    const resolved = valueOrError(() => realpathSync(linkAbsolute))
    check("realpath-resolves-the-link-to-the-canonical-file", !resolved.threw && resolved.value === realpathSync(text), resolved)
  }
  const realAsync = await realpath(text)
  check("realpath-async-answers-the-canonical-path", realAsync === realpathSync(text), { realAsync, expected: realpathSync(text) })
  const junction = failureOf(() => symlinkSync(text, path("junction"), "junction"))
  check("symlink-junction-is-refused-by-name", junction.threw && junction.message.includes("junction"), junction)

  // --- the grant still decides: escaping the root must be the host's refusal, not a path string. ---
  const escape = failureOf(() => mkdtempSync("/xiranite-probe-outside-the-grant-"))
  check("outside-the-grant-is-refused", escape.threw && /authorized roots|permission|grant/i.test(escape.message), escape)

  // --- os facts. ---
  const list = cpus()
  check("cpus-is-an-array-with-a-model", Array.isArray(list) && list.length > 0 && typeof list[0]?.model === "string", list[0])
  check("cpus-carry-no-fabricated-times", list.length > 0 && !("times" in (list[0] as object)), list[0])
  check("availableParallelism-matches-the-count", availableParallelism() === list.length, { available: availableParallelism(), length: list.length })
  check("homedir-answers-a-non-empty-string", typeof homedir() === "string" && homedir().length > 0, homedir())

  await rm(path("tree"), { recursive: true, force: true })
  await rm(text, { force: true })
  await rename(copyTarget, path("renamed.txt"))
  check("rename-still-works-after-the-wiring", readFileSync(path("renamed.txt"), "utf8") === "abcdefg")

  const failures = checks.filter((entry) => !entry.ok).map((entry) => entry.name)
  return { checks, failures }
}
