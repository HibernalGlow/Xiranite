import { expect, test } from "vitest"
// `?raw` 而不是 `node:fs`：浏览器里跑的是测试本体，Node API 到不了（同 `src/styles/design/lonestar-components.browser.test.tsx`）。
import entrySource from "./entry?raw"
import entry from "./entry"

test("loads the ClassF app entry in the browser bundle", () => {
  expect(entry.def).toMatchObject({ id: "classf", name: "ClassF" })
  expect(entry.Component).toBeTypeOf("function")
})

// 反面断言：GUI entry 一旦重新带上 `core`，说明有人又把 `@xiranite/node-classf` 的 core 值导进了浏览器分块，
// 那是在面进程里放了第二份执行宿主（ADR-0074 §5）。`AppNodeEntry.core` 是可选字段且宿主从不读它，
// 所以这条红不会伤到任何真实通路，只挡住回归。
test("ships no in-process node engine with the GUI entry", () => {
  // 用属性存在性而不是 `entry.core`：`satisfies` 保留了入口的实际形状，字段本就不该在类型里。
  expect(Object.hasOwn(entry, "core")).toBe(false)
})

// 第二条反面断言管的是「模块图边」，不是入口对象：裸包名 `@xiranite/node-classf` 本身就是一条 core 边——包根 barrel
// 仍 `export * from "./core.js"`，从包根取值就把整份引擎图重新接回 GUI chunk（`/core` 子路径同罪）。
// 判据与 `scripts/audit-face-execution-path.ts` 的 `isCoreSource()` 对齐，台账尺正是按这条把裸包名记边的。
test("GUI entry registers the node through the definition-only subpath", () => {
  // 先剥注释再取说明符：注释里写的 `./core.js`、裸包名都是反例样本，不剥会把注释当成边（假红）。
  const code = entrySource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
  const specifiers = [
    ...code.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...code.matchAll(/\bimport\s+["']([^"']+)["']/g),
  ].map((match) => match[1])
  // 阳性对照：这把尺必须看得见真边，否则「没有 core 边」是空转的绿。
  expect(specifiers).toContain("@xiranite/node-classf/definition")
  for (const source of specifiers) {
    expect(source === "@xiranite/node-classf" || /(?:^|\/)core(?:\.js)?$/.test(source)).toBe(false)
  }
})
