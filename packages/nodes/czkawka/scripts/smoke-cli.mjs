import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const cli = join(packageRoot, "dist", "cli.js")
const fixture = await mkdtemp(join(tmpdir(), "xiranite-czkawka-cli-"))

try {
  await Promise.all([
    writeFile(join(fixture, "duplicate-a.txt"), "same-content"),
    writeFile(join(fixture, "duplicate-b.txt"), "same-content"),
    writeFile(join(fixture, "different.txt"), "different-content"),
    writeFile(join(fixture, "empty.txt"), ""),
    writeFile(join(fixture, "image.bin"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")),
  ])

  const duplicate = await scan("duplicate-files", fixture, ["--no-cache", "--threads", "0", "--hash", "blake3", "--allow", ".txt;png", "--exclude-dir", "Z:/never", "--exclude-item", "*/never/*,*.part"])
  if (duplicate.data?.tool !== "duplicate-files" || duplicate.data.groupCount < 1) throw new Error(`Unexpected duplicate CLI result: ${JSON.stringify(duplicate)}`)

  const basic = await scan("empty-files", fixture, ["--no-cache"])
  if (basic.data?.tool !== "empty-files" || !basic.data.entries.some((entry) => entry.path.endsWith("empty.txt"))) throw new Error(`Unexpected basic CLI result: ${JSON.stringify(basic)}`)

  const media = await scan("bad-extensions", fixture, ["--no-cache"])
  if (media.data?.tool !== "bad-extensions" || !media.data.entries.some((entry) => entry.path.endsWith("image.bin"))) throw new Error(`Unexpected media CLI result: ${JSON.stringify(media)}`)

  console.log(JSON.stringify({ duplicateGroups: duplicate.data.groupCount, emptyFiles: basic.data.fileCount, badExtensions: media.data.fileCount }))
} finally {
  await rm(fixture, { recursive: true, force: true })
}

async function scan(tool, root, flags) {
  const processResult = Bun.spawnSync([process.execPath, cli, "scan", tool, root, ...flags, "--json"], { cwd: packageRoot, stdout: "pipe", stderr: "pipe" })
  const stdout = processResult.stdout.toString().trim()
  const stderr = processResult.stderr.toString().trim()
  if (!processResult.success) throw new Error(`CLI ${tool} failed (${processResult.exitCode}): ${stderr || stdout}`)
  try { return JSON.parse(stdout) }
  catch { throw new Error(`CLI ${tool} returned non-JSON output: ${stdout}\n${stderr}`) }
}
