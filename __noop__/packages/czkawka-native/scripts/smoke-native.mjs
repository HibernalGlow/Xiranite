import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { cancelCzkawkaScan, getCzkawkaInfo, getCzkawkaScanProgress, scanBasicFiles, scanDuplicateFiles, scanMediaFiles } from "../dist/index.js"

const info = getCzkawkaInfo()
if (info.apiVersion !== 4 || info.sourceVersion !== "10.0.0") {
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

  const progressDirectory = join(directory, "progress")
  await mkdir(progressDirectory)
  for (let offset = 0; offset < 2_000; offset += 200) {
    await Promise.all(Array.from({ length: 200 }, (_, index) => writeFile(join(progressDirectory, `${offset + index}.bin`), `${offset + index}:`.padEnd(1024, "x"))))
  }
  const scanId = `smoke-${process.pid}`
  let finished = false
  const cancellable = scanDuplicateFiles({ includedDirectories: [progressDirectory], useCache: false, scanId }).finally(() => { finished = true })
  let progress
  while (!finished && !progress) {
    progress = getCzkawkaScanProgress(scanId)
    if (!progress) await Bun.sleep(5)
  }
  if (!progress) throw new Error("Native scan completed without publishing session progress")
  if (!cancelCzkawkaScan(scanId)) throw new Error("Native scan session rejected cancellation")
  const cancelled = await cancellable
  if (!cancelled.stopped) throw new Error(`Native scan did not report stopped state: ${JSON.stringify(cancelled)}`)
  if (getCzkawkaScanProgress(scanId) !== undefined) throw new Error("Finished native scan session was not released")
  console.log(JSON.stringify({ progressStage: progress.stage, cancelled: cancelled.stopped }))
} finally {
  await rm(directory, { recursive: true, force: true })
}
