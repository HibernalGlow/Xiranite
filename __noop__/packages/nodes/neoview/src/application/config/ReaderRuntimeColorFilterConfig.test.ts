import { describe, expect, it } from "vitest"

import { DEFAULT_READER_COLOR_FILTER } from "../../domain/color-filter/ReaderColorFilter.js"
import { parseNeoviewColorFilterPatch, parseNeoviewRuntimeConfig } from "./ReaderRuntimeConfig.js"

describe("ReaderRuntimeConfig color filter", () => {
  it("[neoview.color-filter.config-codec] loads canonical snake_case settings with tolerant normalization", () => {
    expect(parseNeoviewRuntimeConfig(undefined).colorFilter).toEqual(DEFAULT_READER_COLOR_FILTER)
    expect(parseNeoviewRuntimeConfig({
      image: {
        color_filter: {
          colorize_enabled: true,
          colorize_preset: "future-preset",
          custom_colors: [{ h: -20, s: 4, m: 99 }, { h: 240, s: 0.5, m: 2 }],
          only_black_and_white: true,
          brightness: 180,
          contrast: 40,
          saturation: -1,
          sepia: 120,
          hue_rotate: 400,
          invert: true,
          negative: true,
          future_field: "preserved by the TOML merge layer",
        },
      },
    }).colorFilter).toEqual({
      colorizeEnabled: true,
      colorizePreset: "redAndBlueGray",
      customColors: [{ h: 0, s: 2, m: 16 }, { h: 240, s: 0.5, m: 2 }],
      onlyBlackAndWhite: true,
      brightness: 150,
      contrast: 50,
      saturation: 0,
      sepia: 100,
      hueRotate: 360,
      invert: true,
      negative: true,
    })
  })

  it("[neoview.color-filter.toml] validates exact PATCH fields and emits canonical TOML leaves", () => {
    expect(parseNeoviewColorFilterPatch({ colorFilter: {
      colorizeEnabled: true,
      colorizePreset: "blueSky",
      customColors: [{ h: 20, s: 0.75, m: 2 }],
      onlyBlackAndWhite: true,
      brightness: 125,
      hueRotate: 90,
      invert: true,
    } })).toEqual({
      patch: { colorFilter: {
        colorizeEnabled: true,
        colorizePreset: "blueSky",
        customColors: [{ h: 20, s: 0.75, m: 2 }],
        onlyBlackAndWhite: true,
        brightness: 125,
        hueRotate: 90,
        invert: true,
      } },
      tomlPatch: { image: { color_filter: {
        colorize_enabled: true,
        colorize_preset: "blueSky",
        custom_colors: [{ h: 20, s: 0.75, m: 2 }],
        only_black_and_white: true,
        brightness: 125,
        hue_rotate: 90,
        invert: true,
      } } },
    })
    expect(() => parseNeoviewColorFilterPatch({ colorFilter: { brightness: 151 } })).toThrow("brightness")
    expect(() => parseNeoviewColorFilterPatch({ colorFilter: { colorizePreset: "future" } })).toThrow("known preset")
    expect(() => parseNeoviewColorFilterPatch({ colorFilter: { future: true } })).toThrow("Unknown color filter")
    expect(() => parseNeoviewColorFilterPatch({ colorFilter: {} })).toThrow("at least one field")
    expect(() => parseNeoviewColorFilterPatch({ colorFilter: { reset: "defaults", invert: true } })).toThrow("cannot be combined")
    expect(() => parseNeoviewColorFilterPatch({ colorFilter: { reset: "factory" } })).toThrow('must be "defaults"')
    expect(() => parseNeoviewColorFilterPatch({ colorFilter: { brightness: 100 }, media: {} })).toThrow("unsupported fields")
  })

  it("[neoview.color-filter.reset] emits every canonical default in one reset mutation", () => {
    expect(parseNeoviewColorFilterPatch({ colorFilter: { reset: "defaults" } })).toEqual({
      patch: { colorFilter: { reset: "defaults" } },
      tomlPatch: { image: { color_filter: {
        colorize_enabled: false,
        colorize_preset: "redAndBlueGray",
        custom_colors: [],
        only_black_and_white: false,
        brightness: 100,
        contrast: 100,
        saturation: 100,
        sepia: 0,
        hue_rotate: 0,
        invert: false,
        negative: false,
      } } },
    })
  })
})
