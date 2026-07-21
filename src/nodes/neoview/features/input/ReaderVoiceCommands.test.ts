import { describe, expect, it } from "vitest"
import { readerVoiceCommandAction } from "./ReaderVoiceCommands"

describe("readerVoiceCommandAction", () => {
  it("maps normalized speech phrases to the shared Reader action registry", () => {
    expect(readerVoiceCommandAction("请 翻页！")).toBe("reader.next-page")
    expect(readerVoiceCommandAction("打开设置")).toBe("reader.open-settings")
    expect(readerVoiceCommandAction("unknown words")).toBeUndefined()
  })
})
