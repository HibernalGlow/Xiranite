import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { cancelCzkawkaScan, createExifCandidate, createVideoOptimizerCandidate, getCzkawkaInfo, getCzkawkaScanProgress, scanBasicFiles, scanDuplicateFiles, scanExifFiles, scanMediaFiles, scanVideoOptimizer } from "../dist/index.js"

const info = getCzkawkaInfo()
const requiredCapabilities = ["scan.duplicate", "scan.progress.v2", "scan.cancel", "scan.bad-names", "scan.exif-remover", "operation.exif.candidate", "scan.video-optimizer", "operation.video-optimizer.candidate", "similar-videos.similario", "similar-videos.same-resolution-exclusion", "similar-videos.audio", "broken-files.multi-checker", "empty-files.content-checkers", "temporary-files.custom-extensions"]
const missingCapabilities = requiredCapabilities.filter((capability) => !info.capabilities.includes(capability))
if (info.apiVersion !== 5 || missingCapabilities.length) {
  throw new Error(`Unexpected Czkawka info: ${JSON.stringify(info)}`)
}
console.log(JSON.stringify(info))

const directory = await mkdtemp(join(tmpdir(), "xiranite-czkawka-native-"))
let exifCandidatePath
let videoCandidatePath
let cropCandidatePath
try {
  await Promise.all([
    writeFile(join(directory, "one.bin"), "same-content"),
    writeFile(join(directory, "two.bin"), "same-content"),
    writeFile(join(directory, "different.bin"), "different-content"),
    writeFile(join(directory, "empty.bin"), ""),
    writeFile(join(directory, "nul-only.bin"), new Uint8Array([0, 0, 0])),
    writeFile(join(directory, "non-printable.txt"), " \t\r\n"),
    writeFile(join(directory, "printable.txt"), "visible"),
    writeFile(join(directory, "custom-temporary.xiranite-tmp"), "temporary"),
    writeFile(join(directory, "broken.json"), '{"broken":'),
    writeFile(join(directory, "report-🙂.TXT"), "report"),
    writeFile(join(directory, "photo.jpg"), await jpegWithImageDescription()),
  ])
  const result = await scanDuplicateFiles({ includedDirectories: [directory], useCache: false })
  if (result.groups.length !== 1 || result.groups[0]?.files.length !== 2) {
    throw new Error(`Unexpected duplicate result: ${JSON.stringify(result)}`)
  }
  console.log(JSON.stringify({ duplicateGroups: result.groups.length }))
  const basic = await scanBasicFiles({ tool: "empty-files", includedDirectories: [join(directory, "empty.bin")], minimumFileSize: 0, useCache: false })
  if (!basic.entries.some((entry) => entry.path.endsWith("empty.bin"))) {
    throw new Error(`Unexpected basic result: ${JSON.stringify(basic)}`)
  }
  const zeroByteContent = await scanBasicFiles({
    tool: "empty-files",
    includedDirectories: [directory],
    minimumFileSize: 0,
    useCache: false,
    emptyFilesSearchZeroByteContent: true,
  })
  if (!zeroByteContent.entries.some((entry) => entry.path.endsWith("nul-only.bin"))) {
    throw new Error(`Zero-byte content checker did not report the NUL-only file: ${JSON.stringify(zeroByteContent)}`)
  }
  const nonPrintableContent = await scanBasicFiles({
    tool: "empty-files",
    includedDirectories: [directory],
    minimumFileSize: 0,
    useCache: false,
    emptyFilesSearchNonPrintableContent: true,
  })
  if (!nonPrintableContent.entries.some((entry) => entry.path.endsWith("non-printable.txt"))) {
    throw new Error(`Non-printable content checker did not report the whitespace-only file: ${JSON.stringify(nonPrintableContent)}`)
  }
  console.log(JSON.stringify({ zeroByteContentFiles: zeroByteContent.entries.length, nonPrintableContentFiles: nonPrintableContent.entries.length }))
  const temporary = await scanBasicFiles({
    tool: "temporary-files",
    includedDirectories: [directory],
    useCache: false,
    temporaryFileExtensions: ".xiranite-tmp",
  })
  if (!temporary.entries.some((entry) => entry.path.endsWith("custom-temporary.xiranite-tmp"))) {
    throw new Error(`Custom temporary extension did not report the matching file: ${JSON.stringify(temporary)}`)
  }
  console.log(JSON.stringify({ customTemporaryFiles: temporary.entries.length }))
  const badNames = await scanBasicFiles({ tool: "bad-names", includedDirectories: [directory], useCache: false })
  if (!badNames.entries.some((entry) => entry.path.endsWith("report-🙂.TXT") && entry.secondaryPath?.endsWith("report-.txt"))) {
    throw new Error(`Bad-name scanner did not return the proposed same-directory target: ${JSON.stringify(badNames)}`)
  }
  console.log(JSON.stringify({ badNameFiles: badNames.entries.length }))
  const photoPath = join(directory, "photo.jpg")
  const sourceBefore = await readFile(photoPath)
  const exif = await scanExifFiles({ includedDirectories: [photoPath], useCache: false })
  const exifEntry = exif.entries.find((entry) => entry.path.endsWith("photo.jpg"))
  if (!exifEntry?.tags.some((tag) => tag.code === 270 && tag.group === "GENERIC")) {
    throw new Error(`EXIF scan did not report the injected ImageDescription tag: ${JSON.stringify(exif)}`)
  }
  const candidate = await createExifCandidate({ sourcePath: photoPath, tags: exifEntry.tags })
  exifCandidatePath = candidate.candidatePath
  if (candidate.removedTags < 1 || Buffer.compare(sourceBefore, await readFile(photoPath)) !== 0) {
    throw new Error(`EXIF candidate changed the source or removed no metadata: ${JSON.stringify(candidate)}`)
  }
  const cleanedExif = await scanExifFiles({ includedDirectories: [candidate.candidatePath], useCache: false })
  if (cleanedExif.entries.length) {
    throw new Error(`EXIF candidate still has metadata: ${JSON.stringify(cleanedExif)}`)
  }
  await rm(exifCandidatePath, { force: true })
  exifCandidatePath = undefined
  console.log(JSON.stringify({ exifTags: exifEntry.tags.length, removedExifTags: candidate.removedTags }))

  const videoPath = join(directory, "source-h264.mp4")
  await createH264Video(videoPath)
  const videoOptimizer = await scanVideoOptimizer({
    mode: "transcode",
    includedDirectories: [directory],
    useCache: false,
  })
  const videoEntry = videoOptimizer.entries.find((entry) => entry.path.endsWith("source-h264.mp4"))
  if (!videoEntry) {
    throw new Error(`Video optimizer did not report the H.264 fixture: ${JSON.stringify(videoOptimizer)}`)
  }
  const videoSource = await readFile(videoPath)
  const videoCandidate = await createVideoOptimizerCandidate({
    sourcePath: videoEntry.path,
    mode: "transcode",
    targetCodec: "h265",
    quality: 35,
    failIfNotSmaller: false,
    limitVideoSize: false,
    maximumWidth: 1920,
    maximumHeight: 1080,
    noiseReduction: "none",
    noiseReductionStrength: 5,
    currentCodec: videoEntry.codec,
  })
  videoCandidatePath = videoCandidate.candidatePath
  if (videoCandidate.candidateSize < 1 || Buffer.compare(videoSource, await readFile(videoPath)) !== 0) {
    throw new Error(`Video optimizer changed the source or produced no candidate: ${JSON.stringify(videoCandidate)}`)
  }
  await rm(videoCandidatePath, { force: true })
  videoCandidatePath = undefined
  console.log(JSON.stringify({ videoOptimizerEntries: videoOptimizer.entries.length, videoCandidateBytes: videoCandidate.candidateSize }))

  const cropVideoPath = join(directory, "source-black-bars.mp4")
  await createBlackBarH264Video(cropVideoPath)
  const cropOptimizer = await scanVideoOptimizer({
    mode: "crop",
    includedDirectories: [directory],
    useCache: false,
  })
  const cropEntry = cropOptimizer.entries.find((entry) => entry.path.endsWith("source-black-bars.mp4"))
  if (!cropEntry || cropEntry.cropLeft === undefined || cropEntry.cropTop === undefined || cropEntry.cropRight === undefined || cropEntry.cropBottom === undefined) {
    throw new Error(`Video optimizer did not report a crop rectangle for the black-bar fixture: ${JSON.stringify(cropOptimizer)}`)
  }
  const cropSource = await readFile(cropVideoPath)
  const cropCandidate = await createVideoOptimizerCandidate({
    sourcePath: cropEntry.path,
    mode: "crop",
    targetCodec: "h265",
    quality: 35,
    failIfNotSmaller: false,
    limitVideoSize: false,
    maximumWidth: 1920,
    maximumHeight: 1080,
    noiseReduction: "none",
    noiseReductionStrength: 5,
    cropLeft: cropEntry.cropLeft,
    cropTop: cropEntry.cropTop,
    cropRight: cropEntry.cropRight,
    cropBottom: cropEntry.cropBottom,
    cropTranscode: false,
    currentCodec: cropEntry.codec,
  })
  cropCandidatePath = cropCandidate.candidatePath
  if (cropCandidate.candidateSize < 1 || Buffer.compare(cropSource, await readFile(cropVideoPath)) !== 0) {
    throw new Error(`Video crop changed the source or produced no candidate: ${JSON.stringify(cropCandidate)}`)
  }
  await rm(cropCandidatePath, { force: true })
  cropCandidatePath = undefined
  console.log(JSON.stringify({ videoCropEntries: cropOptimizer.entries.length, videoCropCandidateBytes: cropCandidate.candidateSize }))
  const media = await scanMediaFiles({
    tool: "bad-extensions",
    includedDirectories: [directory],
    useCache: false,
    imageHashSize: 64,
    imageHashAlgorithm: "double-gradient",
    imageResizeAlgorithm: "catmull-rom",
    imageIgnoreSameSize: true,
    videoIgnoreSameSize: true,
    videoIgnoreSameResolution: true,
    videoSkipForward: 45,
    videoHashDuration: 20,
    videoCropDetect: "motion",
    videoWindowCount: 12,
    videoDurationTolerancePct: 35,
    videoMinMatchingWindows: 0.75,
    videoSubclipMinMatch: 0.4,
    videoCheckAudioContent: true,
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

  const broken = await scanMediaFiles({
    tool: "broken-files",
    includedDirectories: [directory],
    useCache: false,
    brokenAudio: false,
    brokenPdf: false,
    brokenArchive: false,
    brokenImage: false,
    brokenVideoFfprobe: false,
    brokenVideoFfmpeg: false,
    brokenFont: false,
    brokenMarkup: true,
  })
  if (!broken.groups.some((group) => group.entries.some((entry) => entry.path.endsWith("broken.json")))) {
    throw new Error(`Markup checker did not report the malformed JSON: ${JSON.stringify(broken)}`)
  }
  console.log(JSON.stringify({ brokenMarkupFiles: broken.groups.flatMap((group) => group.entries).length }))

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
  if (exifCandidatePath) await rm(exifCandidatePath, { force: true })
  if (videoCandidatePath) await rm(videoCandidatePath, { force: true })
  if (cropCandidatePath) await rm(cropCandidatePath, { force: true })
  await rm(directory, { recursive: true, force: true })
}

async function createH264Video(path) {
  const process = Bun.spawn([
    "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=64x48:rate=1", "-t", "1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", path,
  ], { stdout: "pipe", stderr: "pipe" })
  if (await process.exited !== 0) {
    throw new Error(`FFmpeg could not create the Video Optimizer fixture: ${await new Response(process.stderr).text()}`)
  }
}

async function createBlackBarH264Video(path) {
  const process = Bun.spawn([
    "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30", "-vf", "pad=320:240:0:30:black", "-t", "3",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", path,
  ], { stdout: "pipe", stderr: "pipe" })
  if (await process.exited !== 0) {
    throw new Error(`FFmpeg could not create the Video Optimizer crop fixture: ${await new Response(process.stderr).text()}`)
  }
}

async function jpegWithImageDescription() {
  const base = await readFile(new URL("../../../vendor/folia-major/assets/placeholder_cover.jpg", import.meta.url))
  const exifSegment = new Uint8Array([
    0xff, 0xe1, 0x00, 0x28, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49,
    0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x0e, 0x01, 0x02, 0x00,
    0x06, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00,
  ])
  if (base[0] !== 0xff || base[1] !== 0xd8) throw new Error("EXIF smoke fixture is not a JPEG")
  return Buffer.concat([base.subarray(0, 2), exifSegment, base.subarray(2)])
}
