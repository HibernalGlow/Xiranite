import { describe, expect, test, vi } from "vitest"

import {
  bitrateLevelFor,
  createBitrateLevels,
  normalizeBitvReport,
  parseFfprobeVideo,
  runBitv,
  type BitvRuntime,
} from "./core.js"

describe("native BitV core", () => {
  test("calculates bitrate from ffprobe duration and file stat instead of trusting probe bitrate", () => {
    const levels = createBitrateLevels(5, 2)
    const video = parseFfprobeVideo(
      "D:/videos/demo.mp4",
      "nested/demo.mp4",
      { sizeBytes: 12_500_000 },
      {
        format: { duration: "100", bit_rate: "999999999" },
        streams: [{ codec_type: "video", width: 1920, height: 1080, avg_frame_rate: "30000/1001" }],
      },
      levels,
    )

    expect(video.bitrateBps).toBe(1_000_000)
    expect(video.bitrateMbps).toBe(1)
    expect(video.bitrateLevel).toBe("5Mbps")
    expect(video.fps).toBeCloseTo(29.97, 2)
    expect(video.resolution).toBe("1920x1080")
  })

  test("creates deterministic bitrate bands with an overflow band", () => {
    const levels = createBitrateLevels(2.5, 3)

    expect(levels.map((level) => level.label)).toEqual(["2.5Mbps", "5Mbps", "7.5Mbps", "over-7.5Mbps"])
    expect(bitrateLevelFor(7_500_001, levels)).toBe("over-7.5Mbps")
  })

  test("analyzes discovered files and writes a collision-safe native report through the runtime", async () => {
    const writeJson = vi.fn(async () => "D:/reports/analysis (1).json")
    const events: string[] = []
    const runtime = createRuntime({ writeJson })

    const result = await runBitv({
      action: "analyze",
      paths: ["D:/videos"],
      recursive: true,
      outputPath: "D:/reports/analysis.json",
    }, runtime, (event) => events.push(event.message))

    expect(result.success).toBe(true)
    expect(result.data?.videos).toHaveLength(1)
    expect(result.data?.stats.totalVideos).toBe(1)
    expect(result.data?.reportPath).toBe("D:/reports/analysis (1).json")
    expect(writeJson).toHaveBeenCalledTimes(1)
    expect(writeJson.mock.calls[0]?.[1]).toMatchObject({ schemaVersion: 1, requestedPaths: ["D:/videos"] })
    expect(events.at(-1)).toBe("Video analysis completed.")
  })

  test("classify defaults to dry-run and never invokes the transfer executor", async () => {
    const transferFile = vi.fn(async () => "D:/sorted/5Mbps/demo.mp4")
    const resolveAvailablePath = vi.fn(async () => "D:/sorted/5Mbps/demo (1).mp4")
    const runtime = createRuntime({ transferFile, resolveAvailablePath })

    const result = await runBitv({
      action: "classify",
      paths: ["D:/videos"],
      targetPath: "D:/sorted",
      transferMode: "move",
    }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.dryRun).toBe(true)
    expect(result.data?.operations[0]).toMatchObject({
      mode: "move",
      dryRun: true,
      targetPath: "D:/sorted/5Mbps/demo (1).mp4",
    })
    expect(resolveAvailablePath).toHaveBeenCalledWith("D:/sorted/5Mbps/nested/demo.mp4")
    expect(transferFile).not.toHaveBeenCalled()
  })

  test("live classification delegates collision-safe transfer and records the returned destination", async () => {
    const transferFile = vi.fn(async () => "D:/sorted/5Mbps/nested/demo (2).mp4")
    const runtime = createRuntime({ transferFile })

    const result = await runBitv({
      action: "classify",
      paths: ["D:/videos"],
      targetPath: "D:/sorted",
      transferMode: "copy",
      dryRun: false,
    }, runtime)

    expect(result.success).toBe(true)
    expect(transferFile).toHaveBeenCalledWith(
      "D:/videos/nested/demo.mp4",
      "D:/sorted/5Mbps/nested/demo.mp4",
      "copy",
    )
    expect(result.data?.operations[0]?.targetPath).toBe("D:/sorted/5Mbps/nested/demo (2).mp4")
  })

  test("normalizes legacy Python reports and previews report classification", async () => {
    const legacy = {
      folder_path: "D:/videos",
      timestamp: "2025-08-19T12:00:00",
      videos: [{
        path: "D:/videos/old.mp4",
        info: {
          filename: "old.mp4",
          bitrate_mbps: 8,
          width: 1280,
          height: 720,
          fps: 24,
          size_mb: 10,
        },
        bitrate_level: "10MB",
      }],
    }
    const normalized = normalizeBitvReport(legacy)
    expect(normalized.requestedPaths).toEqual(["D:/videos"])
    expect(normalized.videos[0]?.bitrateBps).toBe(8_000_000)

    const runtime = createRuntime({ readJson: async () => legacy })
    const result = await runBitv({
      action: "report",
      reportPath: "D:/reports/legacy.json",
      targetPath: "D:/sorted",
    }, runtime)

    expect(result.success).toBe(true)
    expect(result.data?.videos[0]?.bitrateLevel).toBe("10Mbps")
    expect(result.data?.operations[0]).toMatchObject({ dryRun: true, targetPath: "D:/sorted/10Mbps/old.mp4" })
  })

  test("reports a missing ffprobe before analysis", async () => {
    const runtime = createRuntime({ findFfprobe: async () => null })

    const result = await runBitv({ action: "analyze", paths: ["D:/videos"] }, runtime)

    expect(result.success).toBe(false)
    expect(result.message).toContain("ffprobe was not found")
    expect(runtime.discoverVideos).not.toHaveBeenCalled()
  })
})

function createRuntime(overrides: Partial<BitvRuntime> = {}): BitvRuntime {
  return {
    findFfprobe: vi.fn(async () => "C:/ffmpeg/bin/ffprobe.exe"),
    discoverVideos: vi.fn(async () => ({
      files: [{
        path: "D:/videos/nested/demo.mp4",
        basePath: "D:/videos",
        relativePath: "nested/demo.mp4",
      }],
      errors: [],
    })),
    statFile: vi.fn(async () => ({ sizeBytes: 12_500_000 })),
    runFfprobeJson: vi.fn(async () => ({
      format: { duration: "100" },
      streams: [{ codec_type: "video", width: 1920, height: 1080, avg_frame_rate: "30/1" }],
    })),
    readJson: vi.fn(async () => ({})),
    writeJson: vi.fn(async (path) => path),
    resolveAvailablePath: vi.fn(async (path) => path),
    transferFile: vi.fn(async (_source, path) => path),
    now: () => new Date("2026-07-11T00:00:00.000Z"),
    dirname: (path) => path.replace(/[\\/][^\\/]+$/, ""),
    ...overrides,
  }
}
