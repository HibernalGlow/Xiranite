import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runFindz } from "../dist/core.js"
import { stopFindzWorker } from "../dist/worker-client.js"

const root = await mkdtemp(join(tmpdir(), "xiranite-findz-worker-"))
let libraryId: string | undefined

try {
  await writeFile(join(root, "empty.cbz"), Buffer.from("UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==", "base64"))
  const opened = await runFindz({ action: "open_library", library: { root, databasePath: join(root, "index.sqlite") } })
  if (!opened.success || !opened.data?.library) throw new Error(`Findz worker could not open a library: ${opened.message}`)
  libraryId = opened.data.library.libraryId

  const scan = await runFindz({ action: "scan", libraryId })
  if (!scan.success || !scan.data?.task) throw new Error(`Findz worker could not start a scan: ${scan.message}`)
  const task = await waitForTask(libraryId, scan.data.task.id)
  if (task.status !== "completed") throw new Error(`Findz worker scan did not complete: ${JSON.stringify(task)}`)

  const queried = await runFindz({ action: "query_archives", libraryId })
  const archive = queried.data?.archives?.items[0]
  if (!queried.success || queried.data?.archives?.items.length !== 1 || archive?.memberCount !== 0) {
    throw new Error(`Findz worker returned an unexpected index: ${JSON.stringify(queried)}`)
  }
  const exported = await runFindz({ action: "export_rows", libraryId })
  if (!exported.success || exported.data?.archives?.total !== 1) {
    throw new Error(`Findz worker could not export the filtered rows: ${JSON.stringify(exported)}`)
  }
  console.log(JSON.stringify({ libraryId, watcherHealth: opened.data.library.watcherHealth, archiveCount: queried.data.archives.total }))
} finally {
  if (libraryId) await runFindz({ action: "close_library", libraryId })
  await stopFindzWorker()
  await rm(root, { recursive: true, force: true })
}

async function waitForTask(libraryId: string, taskId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await runFindz({ action: "task", libraryId, taskId })
    if (!result.success || !result.data?.task) throw new Error(`Findz worker could not read the task: ${result.message}`)
    if (["completed", "completed_with_warnings", "cancelled", "failed"].includes(result.data.task.status)) return result.data.task
    await Bun.sleep(10)
  }
  throw new Error(`Findz worker task did not finish: ${taskId}`)
}
