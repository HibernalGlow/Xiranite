import { expect, test } from "vitest"
import entry from "./entry"

test("loads the ClipM app entry in the browser bundle", () => {
  expect(entry.def).toMatchObject({ id: "clipm", name: "ClipM" })
  expect(entry.Component).toBeTypeOf("function")
})

// 反面断言：GUI entry 一旦重新带上 `core`，说明有人又把 `@xiranite/node-clipm/core` 值导进了浏览器分块，
// 那是在面进程里放了第二份执行宿主（ADR-0074 §5）。`AppNodeEntry.core` 是可选字段且宿主从不读它，
// 所以这条红不会伤到任何真实通路，只挡住回归。
test("ships no in-process node engine with the GUI entry", () => {
  // 用属性存在性而不是 `entry.core`：`satisfies` 保留了入口的实际形状，字段本就不该在类型里。
  expect(Object.hasOwn(entry, "core")).toBe(false)
})
