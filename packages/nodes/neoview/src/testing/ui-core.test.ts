import { describe, expect, it } from "vitest"

import {
  DEFAULT_READER_COLOR_FILTER,
  DEFAULT_READER_PAGE_TRANSITION,
  projectReaderColorFilterCss,
  projectReaderPageTransitionCss,
} from "../ui-core.js"

describe("ui-core browser facade", () => {
  it("exports color-filter and page-transition runtime APIs", () => {
    expect(DEFAULT_READER_COLOR_FILTER).toBeDefined()
    expect(DEFAULT_READER_PAGE_TRANSITION).toBeDefined()
    expect(projectReaderColorFilterCss).toBeTypeOf("function")
    expect(projectReaderPageTransitionCss).toBeTypeOf("function")
  })
})
