/* @jsxImportSource @opentui/react */
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { describe, expect, test } from "bun:test"
import { createMelodeckInteractionSchema } from "./interaction.js"
import { MelodeckTui } from "./Tui.js"

describe("Melodeck OpenTUI screen", () => {
  test("renders queue and playback controls", async () => {
    const setup = await testRender(<MelodeckTui definition={{ schema: createMelodeckInteractionSchema({ paths: "D:/Music/demo.flac" }, "en"), run: async () => ({ success: true, message: "Ready", data: { command: [], status: { running: true, paused: false, path: "demo.flac", title: "Demo", artist: "Artist", album: "Album", duration: 120, position: 10, volume: 80, playlist: ["D:/Music/demo.flac"] }, output: "", errors: [] } }) }} language="en" onExit={() => undefined} observe={async () => () => undefined} />, { width: 128, height: 34, useMouse: true })
    try { await act(async () => setup.renderOnce()); const frame = setup.captureCharFrame(); expect(frame).toContain("MELODECK // LOCAL PLAYER"); expect(frame).toContain("QUEUE"); expect(frame).toContain("NOW PLAYING"); expect(frame).toContain("D:/Music/demo.flac") } finally { await act(async () => setup.renderer.destroy()) }
  })

  test("executes the clicked playback action instead of stale status state", async () => {
    const inputs: unknown[] = []
    const setup = await testRender(
      <MelodeckTui
        definition={{
          schema: createMelodeckInteractionSchema({ paths: "D:/Music/demo.flac" }, "en"),
          run: async (input) => {
            inputs.push(input)
            return {
              success: true,
              message: "Started",
              data: {
                command: [],
                status: { running: true, paused: false, path: "demo.flac", title: "Demo", artist: "Artist", album: "Album", duration: 120, position: 0, volume: 80, playlist: ["D:/Music/demo.flac"] },
                output: "",
                errors: [],
              },
            }
          },
        }}
        language="en"
        onExit={() => undefined}
        observe={async () => () => undefined}
      />,
      { width: 128, height: 34, useMouse: true },
    )
    try {
      await act(async () => setup.renderOnce())
      const play = setup.renderer.root.findDescendantById("melodeck-play")!
      await act(async () => setup.mockMouse.click(play.x + 1, play.y + 1))
      await act(async () => setup.flush())
      expect(inputs).toHaveLength(1)
      expect(inputs[0]).toMatchObject({ action: "play", paths: ["D:/Music/demo.flac"] })
    } finally {
      await act(async () => setup.renderer.destroy())
    }
  })

  test("updates progress from the mpv event stream without polling the command runner", async () => {
    const inputs: unknown[] = []
    const setup = await testRender(
      <MelodeckTui
        definition={{
          schema: createMelodeckInteractionSchema({}, "en"),
          run: async (input) => {
            inputs.push(input)
            return { success: true, message: "Unexpected poll", data: { command: [], status: { running: false, paused: false, path: "", title: "", artist: "", album: "", duration: 0, position: 0, volume: 80, playlist: [] }, output: "", errors: [] } }
          },
        }}
        language="en"
        onExit={() => undefined}
        observe={async (_ipc, onStatus) => {
          onStatus({ running: true, paused: false, path: "D:/Music/live.flac", title: "Live Track", artist: "Live Artist", album: "Live Album", duration: 120, position: 30, volume: 65, playlist: ["D:/Music/live.flac"] })
          return () => undefined
        }}
      />,
      { width: 128, height: 34, useMouse: true },
    )
    try {
      await act(async () => setup.renderOnce())
      await act(async () => setup.flush())
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Live Artist")
      expect(frame).toContain("0:30 / 2:00 | volume 65%")
      expect(inputs).toHaveLength(0)
    } finally {
      await act(async () => setup.renderer.destroy())
    }
  })
})
