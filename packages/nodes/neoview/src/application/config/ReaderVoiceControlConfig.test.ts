import { describe, expect, it } from "vitest"
import { parseReaderVoiceControlConfig, parseReaderVoiceControlPatch } from "./ReaderVoiceControlConfig.js"

describe("ReaderVoiceControlConfig", () => {
  it("defaults to disabled and accepts bounded action phrases", () => {
    expect(parseReaderVoiceControlConfig(undefined)).toMatchObject({ enabled: false, language: "zh-CN", minConfidence: 0.6 })
    expect(parseReaderVoiceControlPatch({ voiceControl: { enabled: true, commands: { "reader.next-page": ["下一页"] } } })).toEqual(expect.objectContaining({ tomlPatch: { voice_control: { enabled: true, commands: { "reader.next-page": ["下一页"] } } } }))
  })
  it("rejects unknown actions and invalid confidence", () => {
    expect(() => parseReaderVoiceControlConfig({ commands: { "system.exec": ["run"] } })).toThrow("unsupported")
    expect(() => parseReaderVoiceControlPatch({ voiceControl: { minConfidence: 2 } })).toThrow("between 0 and 1")
  })
})
