import { mkdir, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { runXlchemy, type XlchemyDownscaleSettings } from "../packages/nodes/xlchemy/src/core.ts"
import { createNodeXlchemyRuntime } from "../packages/nodes/xlchemy/src/platform.ts"

const root = join(process.env.TEMP ?? "D:/1Dev/Python/temp", "xiranite-xlchemy-downscale")
await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })
const runtime = createNodeXlchemyRuntime()
const magick = await runtime.resolveCommand(["magick"])
if (!magick) throw new Error("ImageMagick is required")
const source = join(root, "source.png")
const generated = await runtime.runCommand(magick, ["-size", "2400x1600", "plasma:fractal", source])
if (generated.exitCode !== 0) throw new Error(generated.stderr)

const defaults: XlchemyDownscaleSettings = { enabled: true, mode: "resolution", width: 1200, height: 900, percent: 50, fileSizeKb: 80, shortestSide: 700, longestSide: 1000, megapixels: 1, resample: "lanczos" }
const cases: Array<{ id: string; settings: Partial<XlchemyDownscaleSettings>; validate: (width: number, height: number, bytes: number) => boolean }> = [
  { id: "resolution", settings: { mode: "resolution" }, validate: (w, h) => w <= 1200 && h <= 900 },
  { id: "percent", settings: { mode: "percent" }, validate: (w, h) => w === 1200 && h === 800 },
  { id: "shortest-side", settings: { mode: "shortest-side" }, validate: (w, h) => Math.min(w, h) === 700 },
  { id: "longest-side", settings: { mode: "longest-side" }, validate: (w, h) => Math.max(w, h) === 1000 },
  { id: "megapixels", settings: { mode: "megapixels" }, validate: (w, h) => w * h <= 1_010_000 },
  { id: "file-size", settings: { mode: "file-size" }, validate: (_w, _h, bytes) => bytes <= 80 * 1024 * 1.1 },
]
const report = []
for (const item of cases) {
  const caseSource = join(root, `${item.id}.png`)
  await runtime.copyFile(source, caseSource)
  const result = await runXlchemy({ action: "convert", paths: [caseSource], format: "WebP", quality: 60, effort: 6, outputMode: "source", overwrite: true, preserveMetadata: false, downscale: { ...defaults, ...item.settings } }, runtime)
  const file = result.data.files[0]
  if (!file || file.status !== "converted") throw new Error(`${item.id}: ${file?.error ?? "no result"}`)
  const dimensions = await runtime.runCommand(magick, ["identify", "-format", "%w %h", file.outputPath])
  const [width, height] = dimensions.stdout.trim().split(/\s+/).map(Number)
  const bytes = (await stat(file.outputPath)).size
  const passed = item.validate(width!, height!, bytes)
  report.push({ id: item.id, width, height, bytes, passed })
  if (!passed) throw new Error(`${item.id} failed: ${width}x${height}, ${bytes} bytes`)
}
await writeFile(join(root, "verification.json"), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ root, passed: report.length, report }, null, 2))
