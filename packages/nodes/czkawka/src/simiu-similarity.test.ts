import { expect, test } from "vitest"
import { clusterSimiuImagePaths, scoreSimiuImagePair, type SimiuImageFeature } from "./simiu-similarity.js"

function feature(path: string, bits = 0, ratio = 1, color: readonly [number, number, number] = [0, 0, 0], size = 100): SimiuImageFeature {
  return {
    path,
    size,
    modifiedDate: 1,
    width: 100,
    height: Math.round(100 / ratio),
    ratio,
    meanRgb: color,
    phash: `${"1".repeat(bits)}${"0".repeat(64 - bits)}`,
  }
}

test("preserves the four source score terms", () => {
  const source = feature("a.png")
  const comparable = feature("b.png", 8, 1.1, [255, 0, 0], 50)

  expect(scoreSimiuImagePair(source, comparable)).toBeCloseTo(
    0.68 * 0.125 + 0.14 * 0.1 + 0.10 / Math.sqrt(3) + 0.08 * 0.5,
  )
})

test("prunes dissimilar aspect ratios before scoring", () => {
  const paths = ["a.png", "b.png"]
  const groups = clusterSimiuImagePaths(paths, [feature("a.png", 0, 1), feature("b.png", 0, 1.21)], 1)

  expect(groups).toEqual([["b.png"], ["a.png"]])
})

test("uses source-style transitive union-find groups", () => {
  const paths = ["a.png", "b.png", "c.png"]
  const groups = clusterSimiuImagePaths(paths, [feature("a.png", 0), feature("b.png", 1), feature("c.png", 2)], 0.011)

  expect(groups).toEqual([paths])
})
