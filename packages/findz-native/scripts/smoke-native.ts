import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { strToU8, zipSync } from "fflate"
import { loadFindzNativeClient } from "../dist/index.js"

const root = await mkdtemp(join(tmpdir(), "xiranite-findz-native-"))
const databasePath = join(root, "index.sqlite")
const archivePath = join(root, "sample.cbz")

try {
  await writeFile(archivePath, zipSync({
    "cover.txt": strToU8("Findz native smoke fixture"),
    "nested/notes.txt": strToU8("central directory indexing"),
  }))

  const client = loadFindzNativeClient()
  let libraryId: string | undefined
  try {
    const info = await client.getApiInfo()
    if (info.abiVersion !== 1 || !info.capabilities.includes("scan.start") || !info.capabilities.includes("export.rows")) {
      throw new Error(`Unexpected Findz native info: ${JSON.stringify(info)}`)
    }

    const library = await client.openLibrary({ root, databasePath })
    libraryId = library.libraryId
    const scan = await client.startScan(library.libraryId)
    const completed = await waitForTerminalTask(client, library.libraryId, scan.id)
    if (completed.status !== "completed") {
      throw new Error(`Findz scan did not complete: ${JSON.stringify(completed)}`)
    }

    const archives = await client.queryArchives({ libraryId: library.libraryId })
    if (archives.items.length !== 1 || archives.items[0]?.memberCount !== 2) {
      throw new Error(`Findz scan returned unexpected archives: ${JSON.stringify(archives)}`)
    }
    console.log(JSON.stringify({ abiVersion: info.abiVersion, archiveCount: archives.items.length, memberCount: archives.items[0].memberCount }))
  } finally {
    if (libraryId) await client.closeLibrary(libraryId)
    client.close()
  }
} finally {
  await rm(root, { recursive: true, force: true })
}

async function waitForTerminalTask(client: ReturnType<typeof loadFindzNativeClient>, libraryId: string, taskId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const task = await client.getTask(libraryId, taskId)
    if (["completed", "completed_with_warnings", "cancelled", "failed"].includes(task.status)) return task
    await Bun.sleep(10)
  }
  throw new Error(`Findz task did not finish: ${taskId}`)
}
