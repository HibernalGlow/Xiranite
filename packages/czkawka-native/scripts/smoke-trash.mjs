import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getTrashCapabilities, listTrashItems, restoreTrashItem, trashPath } from "../dist/index.js"

const root = await mkdtemp(join(tmpdir(), "xiranite-trash-smoke-"))
const sourcePath = join(root, `restore-${crypto.randomUUID()}.txt`)
const content = `xiranite trash smoke ${crypto.randomUUID()}`
let receipt

try {
  const capabilities = getTrashCapabilities()
  assert.equal(capabilities.provider, "trash-rs")
  assert.equal(capabilities.providerVersion, "5.2.6")
  assert.equal(capabilities.restore, process.platform === "win32")

  await writeFile(sourcePath, content, "utf8")
  const deleteStartedAt = performance.now()
  const result = await trashPath(sourcePath)
  const deleteDurationMs = performance.now() - deleteStartedAt
  assert.equal(result.trashed, true)
  assert.ok(result.receipt, "trash-rs did not return a receipt for the deleted fixture")
  assert.ok(deleteDurationMs < 1_000, `trashPath took ${deleteDurationMs.toFixed(1)}ms; expected under 1000ms`)
  receipt = result.receipt
  await assert.rejects(stat(sourcePath), { code: "ENOENT" })
  console.log(JSON.stringify({ stage: "deleted", deleteDurationMs: Math.round(deleteDurationMs), receipt }))

  await restoreTrashItem(receipt)
  assert.equal(await readFile(sourcePath, "utf8"), content)
  console.log(JSON.stringify({ capabilities, deleteDurationMs: Math.round(deleteDurationMs), restored: sourcePath }))
} finally {
  if (!receipt && !await exists(sourcePath)) {
    receipt = await findReceipt(sourcePath)
  }
  if (receipt && !await exists(sourcePath)) {
    await restoreTrashItem(receipt).catch(() => undefined)
  }
  await rm(root, { recursive: true, force: true })
}

async function findReceipt(sourcePath) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const receipt = (await listTrashItems()).find((item) =>
      join(item.originalParent, item.name).toLocaleLowerCase("en-US") === sourcePath.toLocaleLowerCase("en-US"))
    if (receipt) return receipt
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}
