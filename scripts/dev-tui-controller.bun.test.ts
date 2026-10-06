import { Terminal } from "@xterm/headless"
import { expect, test } from "bun:test"

import { terminalViewportToStyledText } from "./dev-tui-controller"

test("projects xterm ANSI palette and truecolor cells into OpenTUI chunks", async () => {
  const terminal = new Terminal({ allowProposedApi: true, cols: 32, rows: 4 })
  const escape = String.fromCharCode(27)
  await new Promise<void>((resolve) => terminal.write(
    `${escape}[31mRED${escape}[0m ${escape}[38;2;12;34;56mRGB${escape}[0m`,
    resolve,
  ))

  const chunks = terminalViewportToStyledText(terminal).chunks
  const red = chunks.find((chunk) => chunk.text === "RED")
  const rgb = chunks.find((chunk) => chunk.text === "RGB")
  expect(red?.fg?.toInts()).toEqual([128, 0, 0, 255])
  expect(rgb?.fg?.toInts()).toEqual([12, 34, 56, 255])
  expect(chunks.map((chunk) => chunk.text).join("")).not.toContain(escape)
})

test("preserves color from piped child stdout into xterm parser", async () => {
  const terminal = new Terminal({ allowProposedApi: true, cols: 40, rows: 4 })
  const escape = String.fromCharCode(27)
  const child = Bun.spawn([
    process.execPath,
    "-e",
    `const e=String.fromCharCode(27); console.log(e+'[32mPIPE_GREEN'+e+'[0m')`,
  ], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const output = await new Response(child.stdout).text()
  await child.exited
  expect(output).toContain("PIPE_GREEN")
  await new Promise<void>((resolve) => terminal.write(output.replace(/\n/g, "\r\n"), resolve))

  const green = terminalViewportToStyledText(terminal).chunks.find((chunk) => chunk.text.includes("PIPE_GREEN"))
  expect(green?.fg?.toInts()).toEqual([0, 128, 0, 255])
  expect(output).toContain(`${escape}[32m`)
})
