import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
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
    writeFile(join(fixture, "large.dat"), Buffer.alloc(100, 1)),
    writeFile(join(fixture, "medium.dat"), Buffer.alloc(50, 2)),
    writeFile(join(fixture, "tiny.dat"), Buffer.alloc(1, 3)),
    mkdir(join(fixture, "empty-tree", "nested"), { recursive: true }),
    mkdir(join(fixture, "changed-folder"), { recursive: true }),
  ])

  const duplicate = await scan("duplicate-files", fixture, ["--no-cache", "--threads", "0", "--hash", "blake3", "--allow", ".txt;png", "--exclude-dir", "Z:/never", "--exclude-item", "*/never/*,*.part"])
  if (duplicate.data?.tool !== "duplicate-files" || duplicate.data.groupCount < 1) throw new Error(`Unexpected duplicate CLI result: ${JSON.stringify(duplicate)}`)

  const basic = await scan("empty-files", fixture, ["--no-cache"])
  if (basic.data?.tool !== "empty-files" || !basic.data.entries.some((entry) => entry.path.endsWith("empty.txt"))) throw new Error(`Unexpected basic CLI result: ${JSON.stringify(basic)}`)

  const biggest = await scan("big-files", fixture, ["--no-cache", "--allow", "dat", "--count", "2", "--biggest-first"])
  const smallest = await scan("big-files", fixture, ["--no-cache", "--allow", "dat", "--count", "2", "--no-biggest-first"])
  assertNames(biggest, ["large.dat", "medium.dat"], "biggest")
  assertNames(smallest, ["medium.dat", "tiny.dat"], "smallest")

  const folders = await scan("empty-folders", fixture, ["--no-cache"])
  if (folders.data?.tool !== "empty-folders" || !folders.data.entries.some((entry) => entry.path.endsWith("empty-tree"))) throw new Error(`Unexpected empty-folder CLI result: ${JSON.stringify(folders)}`)
  const shallowFolders = await scan("empty-folders", fixture, ["--no-cache", "--no-recursive"])
  if (shallowFolders.data?.entries.some((entry) => entry.path.endsWith("nested"))) throw new Error(`Non-recursive empty-folder scan descended into nested folders: ${JSON.stringify(shallowFolders)}`)
  const excludedFolders = await scan("empty-folders", fixture, ["--no-cache", "--exclude-item", "*empty-tree*"])
  if (excludedFolders.data?.entries.some((entry) => entry.path.includes("empty-tree"))) throw new Error(`Excluded empty folder was returned: ${JSON.stringify(excludedFolders)}`)

  await run(["delete", join(fixture, "empty-tree"), "--tool", "empty-folders", "--permanent", "--live", "--json"])
  if (await exists(join(fixture, "empty-tree"))) throw new Error("Empty-folder live delete did not remove the empty tree")
  await writeFile(join(fixture, "changed-folder", "new.txt"), "changed after scan")
  const rejected = await run(["delete", join(fixture, "changed-folder"), "--tool", "empty-folders", "--permanent", "--live", "--json"], false)
  if (rejected.success || rejected.value.data?.entries?.[0]?.status !== "error" || !await exists(join(fixture, "changed-folder", "new.txt"))) throw new Error(`Unsafe empty-folder delete was not rejected: ${JSON.stringify(rejected)}`)

  const media = await scan("bad-extensions", fixture, ["--no-cache"])
  if (media.data?.tool !== "bad-extensions" || !media.data.entries.some((entry) => entry.path.endsWith("image.bin"))) throw new Error(`Unexpected media CLI result: ${JSON.stringify(media)}`)

  console.log(JSON.stringify({ duplicateGroups: duplicate.data.groupCount, emptyFiles: basic.data.fileCount, biggestFiles: biggest.data.fileCount, smallestFiles: smallest.data.fileCount, emptyFolders: folders.data.fileCount, shallowEmptyFolders: shallowFolders.data.fileCount, excludedEmptyFolders: excludedFolders.data.fileCount, rejectedChangedFolder: true, badExtensions: media.data.fileCount }))
} finally {
  await rm(fixture, { recursive: true, force: true })
}

async function scan(tool, root, flags) {
  return (await run(["scan", tool, root, ...flags, "--json"])).value
}

async function run(args, expectSuccess = true) {
  const processResult = Bun.spawnSync([process.execPath, cli, ...args], { cwd: packageRoot, stdout: "pipe", stderr: "pipe" })
  const stdout = processResult.stdout.toString().trim()
  const stderr = processResult.stderr.toString().trim()
  if (processResult.success !== expectSuccess) throw new Error(`CLI ${args.join(" ")} exited ${processResult.exitCode}: ${stderr || stdout}`)
  try { return { success: processResult.success, value: JSON.parse(stdout) } }
  catch { throw new Error(`CLI ${args.join(" ")} returned non-JSON output: ${stdout}\n${stderr}`) }
}

function assertNames(result, expected, label) {
  const names = result.data?.entries.map((entry) => entry.name).sort()
  if (JSON.stringify(names) !== JSON.stringify([...expected].sort())) throw new Error(`Unexpected ${label} file set: ${JSON.stringify(result)}`)
}

async function exists(path) { try { await access(path); return true } catch { return false } }
