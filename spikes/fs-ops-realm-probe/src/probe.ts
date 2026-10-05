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
import { constants as fsConstants, copyFileSync, cpSync, linkSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, statSync, appendFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { appendFile, copyFile, cp, link, mkdir, mkdtemp, readFile, readlink, realpath, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises"
import { createHash, hash } from "node:crypto"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { Buffer } from "node:buffer"
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
  // A byte payload on the append path used to be a refusal; it is a `fs.writeBytes` append now. Probed on its own
  // file so the text document the copy/utimes checks depend on stays exactly "abcdefg".
  const appended = path("append.bin")
  appendFileSync(appended, Buffer.from([1, 2]))
  appendFileSync(appended, "z")
  check("appendFileSync-accepts-bytes-then-text", (readFileSync(appended) as Uint8Array).length === 3 && (readFileSync(appended) as Uint8Array)[2] === 122, Array.from(readFileSync(appended) as Uint8Array))

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

  // --- byte channel: readBytes / writeBytes, and the code pages that ride on them. ---
  const bin = path("blob.bin")
  await writeFile(bin, Buffer.from([0, 1, 2, 253, 254, 255]))
  const back = await readFile(bin)
  check("readFile-without-encoding-answers-bytes", back instanceof Uint8Array && (back as Uint8Array).length === 6 && (back as Uint8Array)[5] === 255, { type: typeof back })
  check("bytes-round-trip-exactly", Array.from(back as Uint8Array).join(",") === "0,1,2,253,254,255", Array.from(back as Uint8Array).join(","))
  const latin = await readFile(bin, { encoding: "latin1" })
  check("non-utf8-encoding-decodes-those-bytes", typeof latin === "string" && (latin as string).charCodeAt(5) === 255, latin)
  await appendFile(bin, Buffer.from([9]))
  check("appendFile-with-bytes-appends-one", (await readFile(bin)) instanceof Uint8Array && (await readFile(bin)).length === 7, (await readFile(bin)).length)
  await writeFile(bin, "x", { flag: "a" })
  const afterAppendText = readFileSync(bin, { encoding: "latin1" }) as string
  check("writeFile-flag-a-appends-text-to-the-bytes", afterAppendText.length === 8 && afterAppendText.endsWith("x"), { length: afterAppendText.length, tail: afterAppendText.slice(-2) })
  const missingBytes = failureOf(() => readFileSync(path("nope.bin")))
  check("readFileSync-missing-document-is-ENOENT", missingBytes.threw && missingBytes.code === "ENOENT", missingBytes)
  writeFileSync(path("sync.bin"), Buffer.from([1, 2, 3]))
  check("writeFileSync-bytes-then-readFileSync-bytes", (readFileSync(path("sync.bin")) as Uint8Array).length === 3)

  // --- digest: one implementation, so the hex has to be Node's own for the same bytes. ---
  const digest256 = hash("sha256", Buffer.from("abc"))
  check("hash-sha256-matches-node-for-abc", (digest256 as Buffer).toString("hex") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", (digest256 as Buffer).toString("hex"))
  const chained = createHash("sha1")
  chained.update("a")
  chained.update("bc")
  const chainedHex = chained.digest("hex")
  check("createHash-chained-update-matches-node", chainedHex === "a9993e364706816aba3e25717850c26c9cd0d89d", chainedHex)
  const unknownAlgorithm = failureOf(() => hash("md5", Buffer.from("abc")))
  check("algorithm-the-host-does-not-answer-is-refused-by-name", unknownAlgorithm.threw && /sha1|sha256/.test(unknownAlgorithm.message), unknownAlgorithm)

  // --- child_process: the `stdio:"ignore"` form and the piped refusal. ---
  const piped = failureOf(() => spawn("xiranite-probe-program", ["--version"], {}))
  check("spawn-with-piped-stdio-is-refused-naming-the-cap", piped.threw && /262144|ignore/.test(piped.message), piped)
  const ignored = valueOrError(() => spawn("xiranite-probe-program", ["--version"], { stdio: "ignore" }))
  if (ignored.threw) {
    // Either answer is informative: a refusal naming the allowlist proves the call reached the host and that the
    // shim did not decide permission itself. What must NOT happen is a silent success.
    check("spawn-ignore-reaches-the-host-and-the-allowlist-decides", /allowlist|refus|not allowed|program/i.test(ignored.message), ignored)
  } else {
    const child = ignored.value as { pid: number; stdout: unknown; kill(): boolean }
    check("spawn-ignore-answers-a-handle-with-null-stdout", typeof child.pid === "number" && child.stdout === null, child)
    child.kill()
  }
  const sync = valueOrError(() => spawnSync("xiranite-probe-program", ["--version"]))
  check("spawnSync-goes-through-proc-exec", sync.threw ? /allowlist|refus|ENOENT|EACCES/i.test(sync.message) : Array.isArray(sync.value?.output), sync)
  const execAttempt = failureOf(() => execFileSync("xiranite-probe-program", ["--version"]))
  check("execFileSync-refusal-is-the-host's-answer-not-a-javascript-one", execAttempt.threw && execAttempt.message.length > 0, execAttempt)

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
