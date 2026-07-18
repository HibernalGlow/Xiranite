import { createHash } from "node:crypto"
import { readFile, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { runXlchemy } from "../packages/nodes/xlchemy/src/core.ts"
import { createNodeXlchemyRuntime } from "../packages/nodes/xlchemy/src/platform.ts"

const root = join(process.env.TEMP ?? "D:/1Dev/Python/temp", "xiranite-xlchemy-larger-output")
await rm(root, { recursive: true, force: true }); await mkdir(root, { recursive: true })
const runtime = createNodeXlchemyRuntime(), magick = await runtime.resolveCommand(["magick"])
if (!magick) throw new Error("ImageMagick is required")
const hash = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex")
const report = []
for (const copyIfLarger of [false, true]) {
  const source = join(root, copyIfLarger ? "copy.webp" : "remove.webp")
  const generated = await runtime.runCommand(magick, ["-size", "1x1", "xc:white", source])
  if (generated.exitCode !== 0) throw new Error(generated.stderr)
  const sourceHash = await hash(source)
  const result = await runXlchemy({ action: "convert", paths: [source], format: "TIFF", lossless: true, outputMode: "source", overwrite: true, preserveMetadata: false, metadataMode: "encoder-wipe", excludedFormats: [], keepIfLarger: true, copyIfLarger }, runtime)
  const file = result.data.files[0]!, output = file.outputPath, outputInfo = await runtime.pathInfo(output)
  const copiedExactly = outputInfo.exists ? await hash(output) === sourceHash : false
  const passed = file.status === "skipped" && file.error === "output_not_smaller" && (copyIfLarger ? copiedExactly : !outputInfo.exists)
  report.push({ copyIfLarger, status: file.status, outputExists: outputInfo.exists, copiedExactly, passed })
  if (!passed) throw new Error(JSON.stringify(report.at(-1)))
}
console.log(JSON.stringify({ root, passed: report.length, report }, null, 2))
