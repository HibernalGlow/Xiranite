import { mkdir, rm, stat, utimes } from "node:fs/promises"
import { join } from "node:path"
import { runXlchemy } from "../packages/nodes/xlchemy/src/core.ts"
import { createNodeXlchemyRuntime } from "../packages/nodes/xlchemy/src/platform.ts"

const root = join(process.env.TEMP ?? "D:/1Dev/Python/temp", "xiranite-xlchemy-file-policies")
await rm(root, { recursive: true, force: true }); await mkdir(join(root, "input", "nested"), { recursive: true }); await mkdir(join(root, "output"), { recursive: true })
const runtime = createNodeXlchemyRuntime(), magick = await runtime.resolveCommand(["magick"])
if (!magick) throw new Error("ImageMagick is required")
const makeSource = async (name: string) => { const path = join(root, "input", "nested", name); const result = await runtime.runCommand(magick, ["-size", "64x48", "gradient:#123456-#abcdef", path]); if (result.exitCode !== 0) throw new Error(result.stderr); return path }
const records: Array<{ id: string; passed: boolean; detail: string }> = []
const check = (id: string, passed: boolean, detail: string) => { records.push({ id, passed, detail }); if (!passed) throw new Error(`${id}: ${detail}`) }

const plannedSource = await makeSource("planned.png")
const plan = await runXlchemy({ action: "plan", paths: [plannedSource], format: "WebP", outputMode: "directory", outputDir: join(root, "output"), preserveStructure: true, preserveMetadata: false, existingPolicy: "replace" }, runtime)
check("plan-no-write", plan.success && !(await runtime.pathInfo(plan.data.files[0]!.outputPath)).exists, plan.data.files[0]?.outputPath ?? "missing plan")

const timestampSource = await makeSource("timestamp.png"), expectedTime = new Date("2024-05-06T07:08:10.000Z")
await utimes(timestampSource, expectedTime, expectedTime)
const converted = await runXlchemy({ action: "convert", paths: [join(root, "input")], format: "WebP", outputMode: "directory", outputDir: join(root, "output"), preserveStructure: true, preserveTimestamps: true, preserveMetadata: false, existingPolicy: "replace" }, runtime)
const timestampFile = converted.data.files.find((file) => file.sourcePath === timestampSource)!, timestampStat = await stat(timestampFile.outputPath)
check("directory-structure", timestampFile.outputPath.includes(join("nested", "timestamp.webp")), timestampFile.outputPath)
check("preserve-timestamp", Math.abs(timestampStat.mtimeMs - expectedTime.getTime()) < 2_000, `${timestampStat.mtime.toISOString()} vs ${expectedTime.toISOString()}`)

const skip = await runXlchemy({ action: "convert", paths: [timestampSource], format: "WebP", outputMode: "directory", outputDir: join(root, "output", "nested"), preserveStructure: false, preserveMetadata: false, existingPolicy: "skip" }, runtime)
check("existing-skip", skip.data.files[0]?.status === "skipped", skip.data.files[0]?.status ?? "missing")
const rename = await runXlchemy({ action: "convert", paths: [timestampSource], format: "WebP", outputMode: "directory", outputDir: join(root, "output", "nested"), preserveStructure: false, preserveMetadata: false, existingPolicy: "rename" }, runtime)
check("existing-rename", rename.data.files[0]?.status === "converted" && /_1\.webp$/i.test(rename.data.files[0]!.outputPath), rename.data.files[0]?.outputPath ?? "missing")

const permanentSource = await makeSource("permanent.png")
const permanent = await runXlchemy({ action: "convert", paths: [permanentSource], format: "WebP", outputMode: "source", preserveMetadata: false, existingPolicy: "replace", deleteOriginal: true, deleteOriginalMode: "permanent" }, runtime)
check("permanent-delete", permanent.success && !(await runtime.pathInfo(permanentSource)).exists, permanent.message)

const trashSource = await makeSource("trash.png")
const trash = await runXlchemy({ action: "convert", paths: [trashSource], format: "WebP", outputMode: "source", preserveMetadata: false, existingPolicy: "replace", deleteOriginal: true, deleteOriginalMode: "trash" }, runtime)
check("recycle-bin", trash.success && !(await runtime.pathInfo(trashSource)).exists, trash.message)

console.log(JSON.stringify({ root, passed: records.length, records }, null, 2))
