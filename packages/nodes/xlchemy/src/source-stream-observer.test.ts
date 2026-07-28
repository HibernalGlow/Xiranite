import { describe, expect, test, vi } from "vitest"
import { observeAcceptedSourceStream } from "./source-stream-observer.js"

describe("XLchemy source stream observer", () => {
  test("reports a single-pass direct stream without retaining rejected paths", async () => {
    const onLog = vi.fn()
    const output: string[] = []
    async function* sources() {
      yield "D:/images/a.png"
      yield "D:/images/b.txt"
      yield "D:/images/c.webp"
    }

    for await (const path of observeAcceptedSourceStream(
      sources(),
      (path) => !path.endsWith(".txt"),
      { label: "Direct source stream", sourceCount: 1, activeWorkers: () => 2, onLog, now: () => 1_000 },
    )) output.push(path)

    expect(output).toEqual(["D:/images/a.png", "D:/images/c.webp"])
    expect(onLog.mock.calls.map(([message]) => message)).toEqual([
      "Direct source stream opened: 1 root(s); single-pass scan started.",
      "Direct source stream first accepted input after 0.00s.",
      "Direct source stream completed: discovered 3, accepted 2, filtered 1 in 0.00s; single pass.",
    ])
  })
})
