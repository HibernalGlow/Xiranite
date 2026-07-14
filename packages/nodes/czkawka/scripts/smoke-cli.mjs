import { access, link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const cli = join(packageRoot, "dist", "cli.js")
const fixture = await mkdtemp(join(tmpdir(), "xiranite-czkawka-cli-"))
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
const SIMILAR_BMP = createBmp(256, false)
const SIMILAR_VARIANT_BMP = createBmp(256, true)

try {
  await Promise.all([
    writeFile(join(fixture, "duplicate-a.txt"), "same-content"),
    writeFile(join(fixture, "duplicate-b.txt"), "same-content"),
    writeFile(join(fixture, "different.txt"), "different-content"),
    writeFile(join(fixture, "empty.txt"), ""),
    writeFile(join(fixture, "image.bin"), PNG),
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

  const duplicateMatrix = await createDuplicateMatrix(fixture)
  const minimumGroup = await scan("duplicate-files", duplicateMatrix.minimumGroup, ["--no-cache", "--check", "hash", "--min-group", "3"])
  if (minimumGroup.data?.groupCount !== 1 || minimumGroup.data.groups[0]?.entries.length !== 3) throw new Error(`Minimum duplicate group size did not filter the pair: ${JSON.stringify(minimumGroup)}`)

  const insensitiveNames = await scan("duplicate-files", duplicateMatrix.names, ["--no-cache", "--check", "name", "--no-case-sensitive"])
  const sensitiveNames = await scan("duplicate-files", duplicateMatrix.names, ["--no-cache", "--check", "name", "--case-sensitive"])
  if (insensitiveNames.data?.groupCount !== 1 || sensitiveNames.data?.groupCount !== 0) throw new Error(`Duplicate name case sensitivity mismatch: ${JSON.stringify({ insensitiveNames, sensitiveNames })}`)

  const bySize = await scan("duplicate-files", duplicateMatrix.size, ["--no-cache", "--check", "size"])
  const byHash = await scan("duplicate-files", duplicateMatrix.size, ["--no-cache", "--check", "hash"])
  const bySizeAndName = await scan("duplicate-files", duplicateMatrix.sizeAndName, ["--no-cache", "--check", "size-and-name"])
  if (bySize.data?.groupCount !== 1 || byHash.data?.groupCount !== 0 || bySizeAndName.data?.groupCount !== 1) throw new Error(`Duplicate check method mismatch: ${JSON.stringify({ bySize, byHash, bySizeAndName })}`)

  for (const hash of ["crc32", "xxh3", "blake3"]) {
    const result = await scan("duplicate-files", duplicateMatrix.hash, ["--no-cache", "--check", "hash", "--hash", hash])
    if (result.data?.groupCount !== 1) throw new Error(`${hash} did not find the duplicate pair: ${JSON.stringify(result)}`)
  }
  for (const prehash of ["--prehash", "--no-prehash"]) {
    const result = await scan("duplicate-files", duplicateMatrix.hash, ["--no-cache", "--check", "hash", prehash])
    if (result.data?.groupCount !== 1) throw new Error(`${prehash} changed duplicate correctness: ${JSON.stringify(result)}`)
  }

  const hiddenHardLink = await scan("duplicate-files", duplicateMatrix.hardLinks, ["--no-cache", "--check", "hash", "--ignore-hard-links"])
  const visibleHardLink = await scan("duplicate-files", duplicateMatrix.hardLinks, ["--no-cache", "--check", "hash", "--no-ignore-hard-links"])
  if (hiddenHardLink.data?.groupCount !== 0 || visibleHardLink.data?.groupCount !== 1) throw new Error(`Hard-link filtering mismatch: ${JSON.stringify({ hiddenHardLink, visibleHardLink })}`)

  const referenced = await scanRoots("duplicate-files", [duplicateMatrix.reference, duplicateMatrix.referenceOther], ["--no-cache", "--check", "hash", "--reference", duplicateMatrix.reference])
  if (referenced.data?.groupCount !== 1 || referenced.data.groups[0]?.entries.filter((entry) => entry.isReference).length !== 1) throw new Error(`Reference duplicate group mismatch: ${JSON.stringify(referenced)}`)

  const similarImages = await createSimilarImages(fixture)
  for (const hashSize of ["8", "16", "32", "64"]) await assertSimilarImages(similarImages, ["--image-hash-size", hashSize])
  for (const hash of ["mean", "gradient", "blockhash", "vert-gradient", "double-gradient", "median"]) await assertSimilarImages(similarImages, ["--image-hash", hash])
  for (const resize of ["lanczos3", "gaussian", "catmull-rom", "triangle", "nearest"]) await assertSimilarImages(similarImages, ["--image-resize", resize])
  await assertSimilarImages(similarImages, ["--similarity", "0", "--folder-threshold", "2"], 1)
  const highFolderThreshold = await scan("similar-images", similarImages, ["--no-cache", "--similarity", "10", "--folder-threshold", "3"])
  if (highFolderThreshold.data?.similarFolders?.length !== 0) throw new Error(`Similar-image folder threshold was ignored: ${JSON.stringify(highFolderThreshold)}`)
  const ignoredSameSize = await scan("similar-images", similarImages, ["--no-cache", "--image-ignore-same-size"])
  if (ignoredSameSize.data?.groupCount !== 0) throw new Error(`Similar-image same-size filter was ignored: ${JSON.stringify(ignoredSameSize)}`)

  const similarVideos = await createSimilarVideos(fixture)
  for (const crop of ["letterbox", "motion", "none"]) {
    const result = await scan("similar-videos", similarVideos, ["--no-cache", "--similarity", "20", "--video-skip", "0", "--video-duration", "2", "--video-crop", crop])
    const distances = result.data?.entries.map((entry) => Number(entry.similarity)) ?? []
    if (result.data?.groupCount !== 1 || !distances.includes(0) || !distances.some((distance) => distance > 0)) throw new Error(`Similar-video ${crop} scan did not expose real distances: ${JSON.stringify(result)}`)
  }
  const strictVideos = await scan("similar-videos", similarVideos, ["--no-cache", "--similarity", "0", "--video-skip", "0", "--video-duration", "2", "--video-crop", "none"])
  const alternateWindowVideos = await scan("similar-videos", similarVideos, ["--no-cache", "--similarity", "20", "--video-skip", "2", "--video-duration", "4", "--video-crop", "none"])
  const ignoredSameSizeVideos = await scan("similar-videos", similarVideos, ["--no-cache", "--similarity", "20", "--video-skip", "0", "--video-duration", "2", "--video-crop", "none", "--video-ignore-same-size"])
  if (strictVideos.data?.groupCount !== 0 || alternateWindowVideos.data?.groupCount !== 1 || ignoredSameSizeVideos.data?.groupCount !== 0) throw new Error(`Similar-video tolerance, window, or same-size filter was ignored: ${JSON.stringify({ strictVideos, alternateWindowVideos, ignoredSameSizeVideos })}`)

  const brokenFiles = await createBrokenFiles(fixture)
  for (const [kind, filename] of [["audio", "broken.mp3"], ["pdf", "broken.pdf"], ["archive", "broken.zip"], ["image", "broken.png"]]) {
    const flags = ["audio", "pdf", "archive", "image"].map((candidate) => candidate === kind ? `--broken-${candidate}` : `--no-broken-${candidate}`)
    const result = await scan("broken-files", brokenFiles, ["--no-cache", ...flags])
    const found = result.data?.entries.find((entry) => entry.name === filename)
    if (!found?.detail || result.data?.entries.some((entry) => entry.name !== filename)) throw new Error(`Broken ${kind} scanner did not isolate a detailed result: ${JSON.stringify(result)}`)
  }

  console.log(JSON.stringify({ duplicateGroups: duplicate.data.groupCount, duplicateMethods: 4, duplicateHashes: 3, duplicateMinimumGroup: minimumGroup.data.groupCount, duplicateReferenceItems: 1, similarImageHashSizes: 4, similarImageHashes: 6, similarImageResizeAlgorithms: 5, similarImageFolderThreshold: true, similarImageIgnoreSameSize: true, similarVideoCropModes: 3, similarVideoDistance: true, similarVideoTolerance: true, similarVideoIgnoreSameSize: true, brokenFileTypes: 4, brokenFileDetails: true, emptyFiles: basic.data.fileCount, biggestFiles: biggest.data.fileCount, smallestFiles: smallest.data.fileCount, emptyFolders: folders.data.fileCount, shallowEmptyFolders: shallowFolders.data.fileCount, excludedEmptyFolders: excludedFolders.data.fileCount, rejectedChangedFolder: true, badExtensions: media.data.fileCount }))
} finally {
  await rm(fixture, { recursive: true, force: true })
}

async function scan(tool, root, flags) {
  return scanRoots(tool, [root], flags)
}

async function scanRoots(tool, roots, flags) { return (await run(["scan", tool, ...roots, ...flags, "--json"])).value }

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

async function createDuplicateMatrix(root) {
  const base = join(root, "duplicate-matrix")
  const paths = Object.fromEntries(["minimumGroup", "names", "size", "sizeAndName", "hash", "hardLinks", "reference", "referenceOther"].map((name) => [name, join(base, name)]))
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })))
  await Promise.all([
    writeFile(join(paths.minimumGroup, "triple-a.bin"), "triple"), writeFile(join(paths.minimumGroup, "triple-b.bin"), "triple"), writeFile(join(paths.minimumGroup, "triple-c.bin"), "triple"),
    writeFile(join(paths.minimumGroup, "pair-a.bin"), "pair"), writeFile(join(paths.minimumGroup, "pair-b.bin"), "pair"),
    mkdir(join(paths.names, "a")), mkdir(join(paths.names, "b")),
    writeFile(join(paths.size, "a.dat"), "1234567"), writeFile(join(paths.size, "b.dat"), "7654321"),
    mkdir(join(paths.sizeAndName, "a")), mkdir(join(paths.sizeAndName, "b")),
    writeFile(join(paths.hash, "a.bin"), "hash-pair"), writeFile(join(paths.hash, "b.bin"), "hash-pair"),
    writeFile(join(paths.hardLinks, "original.bin"), "hard-link"),
    writeFile(join(paths.reference, "reference.bin"), "reference-pair"), writeFile(join(paths.referenceOther, "other.bin"), "reference-pair"),
  ])
  await Promise.all([
    writeFile(join(paths.names, "a", "Same.txt"), "one"), writeFile(join(paths.names, "b", "same.txt"), "different"),
    writeFile(join(paths.sizeAndName, "a", "shared.bin"), "abcdefg"), writeFile(join(paths.sizeAndName, "b", "shared.bin"), "gfedcba"),
    link(join(paths.hardLinks, "original.bin"), join(paths.hardLinks, "alias.bin")),
  ])
  return paths
}

async function createSimilarImages(root) {
  const directory = join(root, "similar-images-matrix")
  await mkdir(directory, { recursive: true })
  await Promise.all([writeFile(join(directory, "a.bmp"), SIMILAR_BMP), writeFile(join(directory, "b.bmp"), SIMILAR_VARIANT_BMP)])
  return directory
}

async function assertSimilarImages(root, flags, expectedFolders) {
  const result = await scan("similar-images", root, ["--no-cache", "--similarity", "10", ...flags])
  if (result.data?.groupCount !== 1 || expectedFolders !== undefined && result.data.similarFolders?.length !== expectedFolders) throw new Error(`Similar-image options failed (${flags.join(" ")}): ${JSON.stringify(result)}`)
}

async function createSimilarVideos(root) {
  const directory = join(root, "similar-videos-matrix")
  await mkdir(directory, { recursive: true })
  runExternal(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15", "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(directory, "a.mp4")])
  runExternal(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15", "-vf", "eq=brightness=0.02", "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(directory, "b.mp4")])
  return directory
}

async function createBrokenFiles(root) {
  const directory = join(root, "broken-files-matrix")
  await mkdir(directory, { recursive: true })
  await Promise.all([
    writeFile(join(directory, "broken.mp3"), Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2048, 0xff)])),
    writeFile(join(directory, "broken.pdf"), Buffer.from("%PDF-1.7\nthis is not a valid PDF body")),
    writeFile(join(directory, "broken.zip"), Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(2048, 0xaa)])),
    writeFile(join(directory, "broken.png"), Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n"), Buffer.alloc(2048, 0xbb)])),
  ])
  return directory
}

function runExternal(command) {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" })
  if (!result.success) throw new Error(`${command[0]} failed (${result.exitCode}): ${result.stderr.toString()}`)
}

function createBmp(size, variant) {
  const rowSize = Math.ceil(size * 3 / 4) * 4, pixelBytes = rowSize * size, buffer = Buffer.alloc(54 + pixelBytes)
  buffer.write("BM"); buffer.writeUInt32LE(buffer.length, 2); buffer.writeUInt32LE(54, 10); buffer.writeUInt32LE(40, 14); buffer.writeInt32LE(size, 18); buffer.writeInt32LE(size, 22); buffer.writeUInt16LE(1, 26); buffer.writeUInt16LE(24, 28); buffer.writeUInt32LE(pixelBytes, 34)
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) { const offset = 54 + y * rowSize + x * 3; buffer[offset] = (x + y) % 256; buffer[offset + 1] = y; buffer[offset + 2] = variant && x === 128 && y === 128 ? 255 : x }
  return buffer
}
