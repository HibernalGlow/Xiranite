import { describe, expect, it } from "vitest"

import { analyzeTsxModule, splitTsxModule } from "../../../scripts/lib/tsx-module-split"

const SOURCE = `import WidgetBase, { type Model, make as build, unused } from "./dependency"

/** Shared state used by the rendered widget. */
type LocalMode = "grid" | "list"

export interface PublicState {
  model: Model
  mode: LocalMode
}

const localHelper = (model: Model) => build(model)

export function Widget({ model, mode }: PublicState) {
  return <WidgetBase data-mode={mode}>{localHelper(model)}</WidgetBase>
}
`

describe("tsx-module-split", () => {
  it("reports top-level declaration dependencies from the OXC AST", () => {
    const analysis = analyzeTsxModule(SOURCE, "src/Widget.tsx")
    expect(analysis.lines).toBe(15)
    expect(analysis.declarations.map((entry) => ({ names: entry.names, local: entry.localDependencies }))).toEqual([
      { names: ["LocalMode"], local: [] },
      { names: ["PublicState"], local: ["LocalMode"] },
      { names: ["localHelper"], local: [] },
      { names: ["Widget"], local: ["PublicState", "localHelper"] },
    ])
  })

  it("extracts complete declarations, minimizes imports, and preserves source exports", () => {
    const split = splitTsxModule(
      SOURCE,
      "src/Widget.tsx",
      "src/WidgetState.ts",
      ["LocalMode", "PublicState"],
    )

    expect(split.module).toContain('import type { Model } from "./dependency"')
    expect(split.module).not.toContain("unused")
    expect(split.module).toContain("/** Shared state used by the rendered widget. */")
    expect(split.module).toContain('export type LocalMode = "grid" | "list"')
    expect(split.module).toContain("export interface PublicState")
    expect(split.source).toContain('import type { PublicState } from "./WidgetState"')
    expect(split.source).not.toContain('import type { LocalMode, PublicState }')
    expect(split.source).toContain('export type { PublicState } from "./WidgetState"')
    expect(split.source).not.toContain("interface PublicState")
    expect(split.source).not.toContain("Shared state used by the rendered widget")
  })

  it("refuses to move a declaration without its local dependency", () => {
    expect(() => splitTsxModule(
      SOURCE,
      "src/Widget.tsx",
      "src/WidgetView.tsx",
      ["Widget"],
    )).toThrow("PublicState, localHelper")
  })

  it("tracks JSX component identifiers across the extracted module boundary", () => {
    const split = splitTsxModule(
      SOURCE,
      "src/Widget.tsx",
      "src/WidgetView.tsx",
      ["LocalMode", "PublicState", "localHelper", "Widget"],
    )

    expect(split.module).toContain('import WidgetBase, { type Model, make as build } from "./dependency"')
    expect(split.source).toContain('export { Widget } from "./WidgetView"')
  })

  it("refuses declarations whose nested bindings shadow top-level dependencies", () => {
    const source = `import { build } from "./dependency"

export function run(build: () => string) {
  return build()
}
`
    expect(() => splitTsxModule(source, "src/run.ts", "src/run-module.ts", ["run"]))
      .toThrow("shadows top-level dependencies: build")
  })

  it("preserves default exports and type-only default imports", () => {
    const source = `import type Model from "./model"

export default function Widget(model: Model) {
  return <div title="Model">{model.name}</div>
}
`
    const split = splitTsxModule(source, "src/Widget.tsx", "src/WidgetView.tsx", ["Widget"])

    expect(split.module).toContain('import type Model from "./model"')
    expect(split.module).toContain("export default function Widget")
    expect(split.module).not.toContain('import { Model }')
    expect(split.source).toContain('export { default } from "./WidgetView"')
    expect(split.source).not.toContain('export { Widget }')

    const typeSource = `export default interface PublicState {
  name: string
}

export const initialState: PublicState = { name: "ready" }
`
    const typeSplit = splitTsxModule(typeSource, "src/state.ts", "src/state-types.ts", ["PublicState"])
    expect(typeSplit.source).toContain('import type PublicState from "./state-types"')
    expect(typeSplit.source).toContain('export type { default } from "./state-types"')
  })

  it("treats JSX attributes and static properties as names rather than dependencies", () => {
    const source = `const title = "unused dependency"

export function Widget() {
  return <section title={window.location.title}>content</section>
}
`
    const split = splitTsxModule(source, "src/Widget.tsx", "src/WidgetView.tsx", ["Widget"])

    expect(split.module).not.toContain("title from")
    expect(split.report.targetImports).toEqual([])
    expect(split.source).toContain('export { Widget } from "./WidgetView"')
  })

  it("moves top-level destructuring only as a complete declaration", () => {
    const source = `import { values } from "./dependency"

export const { primary, secondary: fallback } = values
`
    expect(() => splitTsxModule(source, "src/values.ts", "src/value-state.ts", ["primary"]))
      .toThrow("also defines fallback")

    const split = splitTsxModule(source, "src/values.ts", "src/value-state.ts", ["primary", "fallback"])
    expect(split.module).toContain('import { values } from "./dependency"')
    expect(split.module).toContain("export const { primary, secondary: fallback } = values")
  })

  it("keeps module directives ahead of generated bridges and extracted code", () => {
    const source = `"use client"

export function Widget() {
  return <button>open</button>
}
`
    const split = splitTsxModule(source, "src/Widget.tsx", "src/WidgetView.tsx", ["Widget"])

    expect(split.source.startsWith('"use client"\nexport { Widget } from "./WidgetView"')).toBe(true)
    expect(split.module.startsWith('"use client"\n\nexport function Widget')).toBe(true)
  })
})
