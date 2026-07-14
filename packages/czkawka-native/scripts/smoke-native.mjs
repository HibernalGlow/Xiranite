import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getCzkawkaInfo, scanBasicFiles, scanDuplicateFiles, scanMediaFiles } from "../dist/index.js"

const info = getCzkawkaInfo()
if (info.apiVersion !== 2 || info.sourceVersion !== "10.0.0") {
  throw new Error(`Unexpected Czkawka info: ${JSON.stringify(info)}`)
}
console.log(JSON.stringify(info))

const directory = await mkdtemp(join(tmpdir(), "xiranite-czkawka-native-"))
try {
  await Promise.all([
    writeFile(join(directory, "one.bin"), "same-content"),
    writeFile(join(directory, "two.bin"), "same-content"),
    writeFile(join(directory, "different.bin"), "different-content"),
    writeFile(join(directory, "empty.bin"), ""),
  ])
  const result = await scanDuplicateFiles({ includedDirectories: [directory], useCache: false })
  if (result.groups.length !== 1 || result.groups[0]?.files.length !== 2) {
    throw new Error(`Unexpected duplicate result: ${JSON.stringify(result)}`)
  }
  console.log(JSON.stringify({ duplicateGroups: result.groups.length }))
  const basic = await scanBasicFiles({ tool: "empty-files", includedDirectories: [directory], minimumFileSize: 0, useCache: false })
  if (!basic.entries.some((entry) => entry.path.endsWith("empty.bin"))) {
    throw new Error(`Unexpected basic result: ${JSON.stringify(basic)}`)
  }
  const media = await scanMediaFiles({
    tool: "bad-extensions",
    includedDirectories: [directory],
    useCache: false,
    imageHashSize: 64,
    imageHashAlgorithm: "double-gradient",
    imageResizeAlgorithm: "catmull-rom",
    imageIgnoreSameSize: true,
    videoIgnoreSameSize: true,
    videoSkipForward: 45,
    videoHashDuration: 20,
    videoCropDetect: "motion",
    musicCheckType: "fingerprint",
    musicMaximumDifference: 4,
    musicMinimumFragmentDuration: 30,
    brokenAudio: true,
    brokenPdf: false,
    brokenArchive: false,
    brokenImage: true,
  })
  if (!Array.isArray(media.groups)) throw new Error(`Unexpected media result: ${JSON.stringify(media)}`)
  console.log(JSON.stringify({ emptyFiles: basic.entries.length, mediaGroups: media.groups.length }))
} finally {
  await rm(directory, { recursive: true, force: true })
}
