import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getCoreInfo, scanDuplicateFiles } from "../dist/index.js"

const info = getCoreInfo()
if (info.apiVersion !== 1 || info.czkawkaVersion !== "10.0.0") {
  throw new Error(`Unexpected native core info: ${JSON.stringify(info)}`)
}
console.log(JSON.stringify(info))

const directory = await mkdtemp(join(tmpdir(), "xiranite-image-native-"))
try {
  await Promise.all([
    writeFile(join(directory, "one.bin"), "same-content"),
    writeFile(join(directory, "two.bin"), "same-content"),
    writeFile(join(directory, "different.bin"), "different-content"),
  ])
  const result = await scanDuplicateFiles({ includedDirectories: [directory], useCache: false })
  if (result.groups.length !== 1 || result.groups[0]?.files.length !== 2) {
    throw new Error(`Unexpected duplicate result: ${JSON.stringify(result)}`)
  }
  console.log(JSON.stringify({ duplicateGroups: result.groups.length }))
} finally {
  await rm(directory, { recursive: true, force: true })
}
