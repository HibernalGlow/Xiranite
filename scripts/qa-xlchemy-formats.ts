import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { normalizeXlchemyInput, runXlchemy, type XlchemyFormat, type XlchemyInput } from "../packages/nodes/xlchemy/src/core.js"
import { createNodeXlchemyRuntime } from "../packages/nodes/xlchemy/src/platform.js"

interface MatrixCase { id: string; format: XlchemyFormat; source: "png" | "jpg" | "lossless-jxl"; options?: Partial<XlchemyInput> }
const cases: MatrixCase[] = [
  { id: "jpeg-xl", format: "JPEG XL", source: "png" },
  { id: "avif-aom", format: "AVIF", source: "png", options: { avifEncoder: "aom" } },
  { id: "avif-svt", format: "AVIF", source: "png", options: { avifEncoder: "svt" } },
  { id: "avif-slimg", format: "AVIF", source: "png", options: { avifEncoder: "slimg" } },
  { id: "webp", format: "WebP", source: "png" },
  { id: "png", format: "PNG", source: "jpg" },
  { id: "tiff", format: "TIFF", source: "png" },
  { id: "jpeg-jpegli", format: "JPEG", source: "png", options: { jpegEncoder: "jpegli" } },
  { id: "jpeg-libjpeg", format: "JPEG", source: "png", options: { jpegEncoder: "libjpeg" } },
  { id: "lossless-jpeg", format: "Lossless JPEG Transcoding", source: "jpg" },
  { id: "jpeg-reconstruction", format: "JPEG Reconstruction", source: "lossless-jxl" },
  { id: "smallest-lossless", format: "Smallest Lossless", source: "png" },
]

const runtime = createNodeXlchemyRuntime()
const outputRoot = process.argv[2] || join(tmpdir(), `xiranite-xlchemy-matrix-${new Date().toISOString().replace(/[:.]/g, "-")}`)
await mkdir(outputRoot, { recursive: true })
const png = join(outputRoot, "source.png"), jpg = join(outputRoot, "source.jpg")
const magick = await required("magick")
await command(magick, ["-size", "320x240", "gradient:#2f8f83-#d8b45c", "-fill", "white", "-gravity", "center", "-pointsize", "28", "-annotate", "0", "Xlchemy QA", png])
await command(magick, [png, "-quality", "93", jpg])

const records: Array<Record<string, unknown>> = []
let losslessJxl = ""
for (const item of cases) {
  const directory = join(outputRoot, item.id)
  await mkdir(directory, { recursive: true })
  const source = item.source === "png" ? png : item.source === "jpg" ? jpg : losslessJxl
  if (!source) throw new Error(`${item.id}: lossless JPEG prerequisite was not produced.`)
  const result = await runXlchemy(normalizeXlchemyInput({ action: "convert", paths: [source], format: item.format, outputMode: "directory", outputDir: directory, preserveStructure: false, preserveMetadata: false, existingPolicy: "replace", overwrite: true, ramOptimizer: "disabled", ...item.options }), runtime)
  const file = result.data?.files[0]
  if (!result.success || !file || file.status !== "converted") throw new Error(`${item.id}: ${result.message} ${file?.error ?? ""}`.trim())
  if (item.id === "lossless-jpeg") losslessJxl = file.outputPath
  const verificationPath = await verifyDecode(item.id, item.format, file.outputPath)
  records.push({ id: item.id, format: item.format, encoder: item.options?.avifEncoder ?? item.options?.jpegEncoder, source, output: file.outputPath, outputBytes: file.outputBytes, verificationPath })
}

const rebuilt = String(records.find((item) => item.id === "jpeg-reconstruction")?.output ?? "")
const sourceHash = await sha256(jpg), rebuiltHash = await sha256(rebuilt)
if (sourceHash !== rebuiltHash) throw new Error(`JPEG reconstruction hash mismatch: ${sourceHash} != ${rebuiltHash}`)
const report = { outputRoot, passed: records.length, sourceHash, rebuiltHash, records }
await writeFile(join(outputRoot, "verification.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8")
console.log(JSON.stringify(report, null, 2))

async function verifyDecode(id: string, format: XlchemyFormat, output: string): Promise<string> {
  const decoded = join(outputRoot, `${id}-decoded.png`)
  if (format === "JPEG XL" || format === "Lossless JPEG Transcoding") await command(await required("djxl"), [output, decoded])
  else if (format === "AVIF") await command(await required("avifdec"), [output, decoded])
  else { await command(magick, [output, "-format", "%m %wx%h", "info:"]); return output }
  await command(magick, [decoded, "-format", "%m %wx%h", "info:"])
  return decoded
}
async function required(name: string): Promise<string> { const resolved = await runtime.resolveCommand([name]); if (!resolved) throw new Error(`Missing required command: ${name}`); return resolved }
async function command(executable: string, args: string[]): Promise<void> { const result = await runtime.runCommand(executable, args); if (result.exitCode !== 0) throw new Error(`${executable} ${args.join(" ")}\n${result.stderr || result.stdout}`) }
async function sha256(path: string): Promise<string> { return createHash("sha256").update(await readFile(path)).digest("hex") }
