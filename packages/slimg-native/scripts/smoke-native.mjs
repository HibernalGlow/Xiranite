import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { convertBatch, getSlimgInfo } from "../dist/index.js"

const directory = await mkdtemp(join(tmpdir(), "xiranite-slimg-smoke-"))
try {
  const sourcePath = join(directory, "source.png")
  const outputPath = join(directory, "output.qoi")
  await writeFile(sourcePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"))
  const info = getSlimgInfo()
  const result = await convertBatch({
    files: [{ sourcePath, outputPath }],
    format: "qoi",
    quality: 60,
    jobs: 1,
  })
  if (info.apiVersion !== 1 || result.succeeded !== 1 || result.failed !== 0) {
    throw new Error(`Unexpected slimg smoke result: ${JSON.stringify({ info, result })}`)
  }
  const output = await readFile(outputPath)
  if (output.subarray(0, 4).toString() !== "qoif") throw new Error("slimg smoke output is not QOI")
  console.log(JSON.stringify({ info, result }, null, 2))
} finally {
  await rm(directory, { recursive: true, force: true })
}
