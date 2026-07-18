import { describe, expect, test } from "vitest"

import { runXlchemyCommand } from "./command.js"

describe("xlchemy platform runtime", () => {
  test("terminates a running child process when cancellation is requested", async () => {
    let cancelled = false
    const started = Date.now()
    const cancellation = setTimeout(() => { cancelled = true }, 120)

    try {
      const result = await runXlchemyCommand(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], () => cancelled)
      expect(result).toMatchObject({ exitCode: 130, stderr: "Xlchemy command cancelled." })
      expect(Date.now() - started).toBeLessThan(5_000)
    } finally {
      clearTimeout(cancellation)
    }
  }, 8_000)
})
