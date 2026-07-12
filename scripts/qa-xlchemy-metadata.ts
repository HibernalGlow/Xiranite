import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { runXlchemy, type XlchemyInput } from "../packages/nodes/xlchemy/src/core.ts"
import { createNodeXlchemyRuntime } from "../packages/nodes/xlchemy/src/platform.ts"

const root = join(process.env.TEMP ?? "D:/1Dev/Python/temp", "xiranite-xlchemy-metadata")
await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })
const runtime = createNodeXlchemyRuntime()
const magick = await runtime.resolveCommand(["magick"]), exiftool = await runtime.resolveCommand(["exiftool"])
if (!magick || !exiftool) throw new Error("ImageMagick and ExifTool are required")
const source = join(root, "source.jpg")
let command = await runtime.runCommand(magick, ["-size", "640x480", "gradient:#123456-#abcdef", source])
if (command.exitCode !== 0) throw new Error(command.stderr)
command = await runtime.runCommand(exiftool, ["-overwrite_original", "-Artist=Xlchemy QA", "-Copyright=2026 Xiranite", source])
if (command.exitCode !== 0) throw new Error(command.stderr)

const cases: Array<{ id: string; mode: NonNullable<XlchemyInput["metadataMode"]>; custom?: string; artist?: string }> = [
  { id: "encoder-wipe", mode: "encoder-wipe" },
  { id: "encoder-preserve", mode: "encoder-preserve", artist: "Xlchemy QA" },
  { id: "exiftool-wipe", mode: "exiftool-wipe" },
  { id: "exiftool-preserve", mode: "exiftool-preserve", artist: "Xlchemy QA" },
  { id: "exiftool-unsafe-wipe", mode: "exiftool-unsafe-wipe" },
  { id: "exiftool-custom", mode: "exiftool-custom", custom: '-overwrite_original -Artist="Custom metadata" "$dst"', artist: "Custom metadata" },
]
const report = []
for (const item of cases) {
  const caseSource = join(root, `${item.id}.jpg`)
  await runtime.copyFile(source, caseSource)
  const result = await runXlchemy({ action: "convert", paths: [caseSource], format: "WebP", quality: 60, effort: 6, outputMode: "source", overwrite: true, preserveMetadata: item.mode === "encoder-preserve", metadataMode: item.mode, exiftoolCustomArgs: item.custom }, runtime)
  const file = result.data.files[0]
  if (!file || file.status !== "converted") throw new Error(`${item.id}: ${file?.error ?? result.message}`)
  const read = await runtime.runCommand(exiftool, ["-j", "-Artist", "-Copyright", "-Comment", file.outputPath])
  const tags = JSON.parse(read.stdout)[0] as Record<string, unknown>
  const passed = (tags.Artist ?? undefined) === item.artist
  report.push({ id: item.id, artist: tags.Artist ?? null, copyright: tags.Copyright ?? null, comment: tags.Comment ?? null, passed })
  if (!passed) throw new Error(`${item.id} failed: ${JSON.stringify(tags)}`)
}
await writeFile(join(root, "verification.json"), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ root, passed: report.length, report }, null, 2))
