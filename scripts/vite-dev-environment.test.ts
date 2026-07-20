import { expect, test } from "bun:test"
import { viteDevelopmentEnvironment } from "./vite-dev-environment"

test("leaves standard Vite development untouched", () => {
  expect(viteDevelopmentEnvironment("default", { NODE_OPTIONS: "--trace-warnings" })).toEqual({
    NODE_OPTIONS: "--trace-warnings",
  })
})

test("applies the low-memory Vite defaults", () => {
  expect(viteDevelopmentEnvironment("lean", {}).NODE_OPTIONS).toBe("--max-old-space-size=1024")
  expect(viteDevelopmentEnvironment("lean", {}).XIRANITE_REACT_COMPILER_MODE).toBe("off")
})

test("allows the low-memory Vite heap limit to be overridden", () => {
  expect(viteDevelopmentEnvironment("lean", { XIRANITE_VITE_HEAP_MB: "1536" }).NODE_OPTIONS)
    .toBe("--max-old-space-size=1536")
})

test("keeps an explicit Node heap limit", () => {
  expect(viteDevelopmentEnvironment("lean", { NODE_OPTIONS: "--max-old-space-size=2048" }).NODE_OPTIONS)
    .toBe("--max-old-space-size=2048")
})
