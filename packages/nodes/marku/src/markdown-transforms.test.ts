import { expect, test } from "vitest"
import { applyMarkuModule } from "./core.js"

test("uses remark boundaries when deduplicating headings and standalone images", () => {
  const source = [
    "```md",
    "# Duplicate",
    "![cover](old/cover.png)",
    "```",
    "",
    "# Duplicate",
    "",
    "# Duplicate",
    "",
    "![cover](old/cover.png)",
    "",
    "![cover](old/cover.png)",
  ].join("\n")

  const output = applyMarkuModule("content_dedup", source)

  expect(output.match(/# Duplicate/g)).toHaveLength(2)
  expect(output.match(/!\[cover]\(old\/cover\.png\)/g)).toHaveLength(2)
})

test("does not normalize headings or image syntax inside fenced code", () => {
  const titleSource = "```md\n##   Code heading\n```\n\n##   Real   heading"
  expect(applyMarkuModule("title_convert", titleSource, { offset: 1 })).toBe("```md\n##   Code heading\n```\n\n### Real heading")

  const imageSource = "```md\n![code](images/code.png)\n```\n\n![cover](images/cover.png)"
  expect(applyMarkuModule("image_path_replacer", imageSource, { baseUrl: "https://cdn.example/images" })).toBe("```md\n![code](images/code.png)\n```\n\n![cover](https://cdn.example/images/images/cover.png)")
})

test("converts only parsed Markdown headings to lists", () => {
  const source = "```md\n# Code heading\n```\n\n# Real heading"
  expect(applyMarkuModule("markt", source, { mode: "h2l" })).toBe("```md\n# Code heading\n```\n\n- Real heading")
})
