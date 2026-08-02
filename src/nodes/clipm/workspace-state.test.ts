import { describe, expect, test } from "vitest"
import type { ScoreLibraryResult, WorkScoreResult } from "@xiranite/node-clipm/contracts"
import { mergeScoreProgress, mergeScoreResult } from "./workspace-state"

describe("ClipM score result merging", () => {
  test("keeps completed works from separate concurrent score operations", () => {
    const first = library("D:/first", [work("work-1", 400)])
    const second = library("D:/second", [work("work-2", 800)])

    const merged = mergeScoreResult(first, second)

    expect(merged).toMatchObject({
      discoveredWorkCount: 2,
      succeededWorkCount: 2,
      failedWorkCount: 0,
    })
    expect(merged.works.map((item) => item.workId)).toEqual(["work-1", "work-2"])
  })

  test("updates a progress row idempotently instead of duplicating it", () => {
    const first = library("D:/library", [work("work-1", 400)])
    const updated = mergeScoreProgress(first, work("work-1", 900))

    expect(updated).toMatchObject({
      discoveredWorkCount: 1,
      succeededWorkCount: 1,
      works: [{ workId: "work-1", score: 900 }],
    })
  })
})

function library(path: string, works: WorkScoreResult[]): ScoreLibraryResult {
  return {
    path,
    discoveredWorkCount: works.length,
    succeededWorkCount: works.length,
    failedWorkCount: 0,
    feedback: {
      path,
      scannedWorkCount: works.length,
      synchronizedWorkCount: 0,
      importedFeedbackCount: 0,
    },
    works,
    failures: [],
  }
}

function work(workId: string, score: number): WorkScoreResult {
  return {
    workId,
    path: `D:/library/${workId}`,
    label: score >= 500 ? "P" : "N",
    score,
    bundleVersion: 1,
    shortCode: workId,
  } as WorkScoreResult
}
