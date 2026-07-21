import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import VoiceControlCard from "./VoiceControlCard"

class Recognition {
  static latest: Recognition | undefined
  continuous = false; interimResults = false; lang = ""
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null = null
  onerror = null; onend = null
  constructor() { Recognition.latest = this }
  start() {}
  stop() {}
}

describe("VoiceControlCard", () => {
  it("dispatches recognized commands through the shared input action callback", () => {
    Object.assign(globalThis, { SpeechRecognition: Recognition })
    const onInputAction = vi.fn()
    render(<VoiceControlCard client={{} as never} disabled={false} panelActive onInputAction={onInputAction} onGoTo={vi.fn()}/>)
    fireEvent.click(screen.getByRole("switch")); fireEvent.click(screen.getByText("开始监听"))
    Recognition.latest?.onresult?.({ results: [[{ transcript: "下一页" }]] })
    expect(onInputAction).toHaveBeenCalledWith("reader.next-page")
    delete (globalThis as { SpeechRecognition?: unknown }).SpeechRecognition
  })
})
