import { existsSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import { parseDissolveHistory } from "./dist/core.js"

const historyPath = "C:/Users/30902/.dissolvef/undo/dissolve-20260721-160454-e7438559.json"
const [record] = parseDissolveHistory(readFileSync(historyPath, "utf8"))
const missing = record.operations.filter((operation) => (
  operation.type === "move"
  && operation.targetPath
  && !existsSync(operation.sourcePath)
  && !existsSync(operation.targetPath)
))
const groups = Object.entries(Object.groupBy(missing, (operation) => dirname(operation.targetPath)))
  .map(([path, operations]) => ({ path, count: operations.length }))
  .sort((left, right) => right.count - left.count)
console.log(JSON.stringify({ missingCount: missing.length, groups, missing }, null, 2))
