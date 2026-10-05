import { expect, test } from "vitest"
import entry from "./entry"
import entrySource from "./entry.ts?raw"

test("loads the Sleept app entry in the browser bundle", () => {
  expect(entry.def).toMatchObject({ id: "sleept", name: "Sleept" })
  expect(entry.Component).toBeTypeOf("function")
})

// 反面断言：GUI entry 一旦重新带上 `core`，说明有人又把 `@xiranite/node-sleept` 的 core 值导进了浏览器分块，
// 那是在面进程里放了第二份执行宿主（ADR-0074 §5）。`AppNodeEntry.core` 是可选字段且宿主从不读它，
// 所以这条红不会伤到任何真实通路，只挡住回归。
// 范围只到 entry.ts 自己：`./Component.tsx` 仍值导入 core 的两个纯计时函数，下面两条断言都不管辖它。
test("ships no in-process node engine with the GUI entry", () => {
  // 用属性存在性而不是 `entry.core`：`satisfies` 保留了入口的实际形状，字段本就不该在类型里。
  expect(Object.hasOwn(entry, "core")).toBe(false)
})

// 第二把尺，读源码文本而不是运行时对象：包根 barrel 写着 `export * from "./core.js"`，所以「只要 def」
// 从裸包名取值仍会把整份引擎图拉进 GUI chunk——而上面那条属性断言对此全盲（`entry` 上本就没有 core 字段）。
// 判据与 `scripts/audit-face-execution-path.ts` 的 `isCoreSource` 同形：裸包名，或任何 `/core` 子路径。
function engineEdges(source: string): string[] {
  // 先剥行注释：入口的原因注释会点名 `@xiranite/node-sleept`，那是散文不是 import。
  const code = source.replace(/\/\/[^\n]*/g, "")
  return [...code.matchAll(/["'](@xiranite\/node-[^"']*)["']/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier === "@xiranite/node-sleept" || /\/core(\.js)?$/.test(specifier))
}

test("keeps the GUI entry off the node package's engine graph", () => {
  // 阳性对照（合成夹具，口径同那条尺自己的 `--self-check`）：看不见这两种边的话，末行断言就是假绿。
  expect(engineEdges('import { def } from "@xiranite/node-sleept"')).toEqual(["@xiranite/node-sleept"])
  expect(engineEdges('import { core } from "@xiranite/node-sleept/core"')).toEqual(["@xiranite/node-sleept/core"])
  // 被测对象是真实入口的源码文本；Component 那条残留边由 UI 那条 lane 另案处理。
  expect(engineEdges(entrySource)).toEqual([])
})
