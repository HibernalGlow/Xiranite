import { pathToFileURL } from "node:url"
import { createLibsqlNodeRunHistoryRepository } from "../packages/repository/src/libsql.ts"

const path = `${process.env.LOCALAPPDATA}/Xiranite/xiranite.db`
const repo = await createLibsqlNodeRunHistoryRepository({ url: pathToFileURL(path).href })

const hugeUi = {
  version: 2,
  workspace: {
    bgImageUrl: "",
    theme: "spatial",
    activeCustomThemeName: "symphonic-night",
    fontPreset: "industrial",
    notes: "x".repeat(100_000),
  },
  melodeck: { mode: "bottom", savedTracks: [], floatingOffset: { x: 0, y: 0 } },
}

const baseId = `hist-repo-repro-${Date.now()}`
const item = {
  id: baseId,
  kind: "config" as const,
  operation: "config.app.update",
  status: "success" as const,
  title: "ui",
  message: "Updated app config: ui",
  target: { type: "app-config" as const, id: "ui", label: "ui" },
  input: hugeUi,
  inputSummary: "",
  result: { path: path.replace("xiranite.db", "xiranite.config.toml") },
  resultSummary: path.replace("xiranite.db", "xiranite.config.toml"),
  startedAt: Date.now(),
  finishedAt: Date.now() + 7,
  durationMs: 7,
}

try {
  await repo.createRuntimeHistory(item)
  console.log("repo create ok")
  await repo.deleteRuntimeHistory(item.id)
} catch (error) {
  console.error("repo FAIL message:", error instanceof Error ? error.message : error)
  console.error("repo FAIL cause:", error instanceof Error ? error.cause : undefined)
  console.error("repo FAIL full:", error)
}

const ids = Array.from({ length: 20 }, (_, i) => `${baseId}-c${i}`)
const tasks = ids.map((id, i) =>
  repo.createRuntimeHistory({
    ...item,
    id,
    input: { ...hugeUi, i },
  }).then(() => `ok${i}`).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : ""
    return `fail${i}:${message.slice(0, 160)} | cause=${cause.slice(0, 160)}`
  }),
)
console.log(await Promise.all(tasks))

for (const id of ids) {
  try { await repo.deleteRuntimeHistory(id) } catch { /* ignore */ }
}

console.log("done")
