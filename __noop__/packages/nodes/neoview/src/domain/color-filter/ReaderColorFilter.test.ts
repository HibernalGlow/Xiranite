import { describe, expect, it } from "vitest"
import {
  applyReaderColorFilterPatch,
  DEFAULT_READER_COLOR_FILTER,
  normalizeReaderColorFilter,
  parseReaderColorFilterPatch,
  projectReaderColorFilterCss,
  projectReaderColorFilterTables,
  READER_COLOR_FILTER_PRESET_IDS,
  READER_COLOR_FILTER_PRESET_LABELS,
  READER_COLOR_FILTER_PRESETS,
} from "./ReaderColorFilter.js"

describe("ReaderColorFilter", () => {
  it("[neoview.color-filter.defaults] preserves the legacy defaults", () => {
    expect(DEFAULT_READER_COLOR_FILTER).toEqual({
      colorizeEnabled: false,
      colorizePreset: "redAndBlueGray",
      customColors: [],
      onlyBlackAndWhite: false,
      brightness: 100,
      contrast: 100,
      saturation: 100,
      sepia: 0,
      hueRotate: 0,
      invert: false,
      negative: false,
    })
  })

  it("[neoview.color-filter.presets] exposes all legacy preset IDs, labels and color points", () => {
    expect(READER_COLOR_FILTER_PRESET_IDS).toEqual([
      "redAndBlue", "redAndBlueGray", "blueSky", "violetAndBrown", "violetAndCarnation",
      "paleYellowAndBrown", "red", "orange", "yellow", "green", "blue", "violet",
    ])
    expect(READER_COLOR_FILTER_PRESET_LABELS).toEqual({
      redAndBlue: "红蓝", redAndBlueGray: "红蓝灰", blueSky: "蓝天", violetAndBrown: "紫棕",
      violetAndCarnation: "紫粉", paleYellowAndBrown: "淡黄棕", red: "红色", orange: "橙色",
      yellow: "黄色", green: "绿色", blue: "蓝色", violet: "紫色",
    })
    expect(READER_COLOR_FILTER_PRESET_IDS.map((id) => (
      `${id}:${READER_COLOR_FILTER_PRESETS[id].map(({ h, s, m }) => `${h},${s},${m}`).join(";")}`
    ))).toEqual([
      "redAndBlue:0,0,1;240,0.6,1;0,0.7,1;50,1.5,1;0,0,1",
      "redAndBlueGray:0,0,1;240,0.4,1;0,0.5,1;50,1,1;0,0,1",
      "blueSky:0,0,1;204,0.73,1;200,0.79,1;206,0.84,1",
      "violetAndBrown:323,0.37,1;321,0.42,1;314,0.49,2;18,0.72,3;28,0.83,1",
      "violetAndCarnation:0,0,1;300,0.7,1;300,0.4,2;1,0.4,1;0,0,1",
      "paleYellowAndBrown:203,0,1;238,0.14,1;15,0.55,1;14,0.63,1;41,0.5,1;44,0.58,1;45,0.78,1;48,0.93,1;52,0.95,1",
      "red:0,0,1;0,0.7,1;0,0,1",
      "orange:0,0,1;30,1.33,1;0,0,1",
      "yellow:0,0,1;50,2,1;0,0,1",
      "green:0,0,1;120,0.7,1;0,0,1",
      "blue:0,0,1;230,0.7,1;0,0,1",
      "violet:0,0,1;280,0.7,1;0,0,1",
    ])
  })

  it("[neoview.color-filter.bounds] clamps trusted loaded values and strictly rejects invalid patches", () => {
    expect(normalizeReaderColorFilter({
      brightness: -1,
      contrast: 999,
      saturation: Number.POSITIVE_INFINITY,
      sepia: 101,
      hueRotate: -90,
      colorizeEnabled: "yes",
    })).toMatchObject({ brightness: 50, contrast: 150, saturation: 100, sepia: 100, hueRotate: 0, colorizeEnabled: false })
    expect(parseReaderColorFilterPatch({ brightness: 50, saturation: 200, hueRotate: 360 })).toEqual({
      brightness: 50,
      saturation: 200,
      hueRotate: 360,
    })
    expect(() => parseReaderColorFilterPatch({ brightness: 49 })).toThrow(RangeError)
    expect(() => parseReaderColorFilterPatch({ surprise: true })).toThrow(/Unknown/)
    expect(applyReaderColorFilterPatch(DEFAULT_READER_COLOR_FILTER, { invert: true }).invert).toBe(true)
  })

  it("[neoview.color-filter.css-order] projects filters in the legacy order with caller-owned colorization", () => {
    const settings = normalizeReaderColorFilter({
      colorizeEnabled: true,
      brightness: 110,
      contrast: 120,
      saturation: 130,
      sepia: 10,
      hueRotate: 20,
      invert: true,
      negative: true,
    })
    expect(projectReaderColorFilterCss(settings, { filterId: "reader-page-7-color", colorizeAllowed: true })).toBe(
      "grayscale(100%) url(#reader-page-7-color) brightness(110%) saturate(130%) contrast(120%) sepia(10%) hue-rotate(20deg) invert(100%) invert(100%) hue-rotate(180deg)",
    )
    expect(projectReaderColorFilterCss(settings, { filterId: "reader-page-7-color", colorizeAllowed: false }))
      .not.toContain("url(")
    expect(() => projectReaderColorFilterCss(settings, { filterId: "bad id);", colorizeAllowed: true })).toThrow(TypeError)
  })

  it("[neoview.color-filter.preset-fallback] falls back to redAndBlueGray for an invalid loaded preset", () => {
    const settings = normalizeReaderColorFilter({ colorizePreset: "removed-preset" })
    expect(settings.colorizePreset).toBe("redAndBlueGray")
    expect(projectReaderColorFilterTables(settings)).toEqual(
      projectReaderColorFilterTables({ ...settings, colorizePreset: "redAndBlueGray" }),
    )
  })

  it("[neoview.color-filter.table-values] projects finite SVG component-transfer tables without markup", () => {
    for (const colorizePreset of READER_COLOR_FILTER_PRESET_IDS) {
      const tables = projectReaderColorFilterTables({ ...DEFAULT_READER_COLOR_FILTER, colorizePreset })
      expect(tables.r.length).toBeGreaterThanOrEqual(READER_COLOR_FILTER_PRESETS[colorizePreset].length)
      expect(tables.r).toHaveLength(tables.g.length)
      expect(tables.g).toHaveLength(tables.b.length)
      expect([...tables.r, ...tables.g, ...tables.b].every(Number.isFinite)).toBe(true)
      expect(JSON.stringify(tables)).not.toContain("<")
    }
  })
})
