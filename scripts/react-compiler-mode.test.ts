import { expect, test } from "bun:test"
import { reactCompilerModeForCommand } from "./react-compiler-mode"

test("disables React Compiler for ordinary development", () => {
  expect(reactCompilerModeForCommand("serve", {})).toBe("off")
  expect(reactCompilerModeForCommand("serve", { XIRANITE_REACT_COMPILER_MODE: "infer" })).toBe("off")
})

test("enables infer mode for production builds", () => {
  expect(reactCompilerModeForCommand("build", {})).toBe("infer")
})

test("preserves explicit benchmark and production overrides", () => {
  expect(reactCompilerModeForCommand("serve", {
    XIRANITE_REACT_COMPILER_DIAGNOSTIC: "1",
    XIRANITE_REACT_COMPILER_MODE: "annotation",
  })).toBe("annotation")
  expect(reactCompilerModeForCommand("build", { XIRANITE_REACT_COMPILER_MODE: "off" })).toBe("off")
})

test("rejects invalid compiler modes", () => {
  expect(() => reactCompilerModeForCommand("build", { XIRANITE_REACT_COMPILER_MODE: "invalid" })).toThrow()
})
