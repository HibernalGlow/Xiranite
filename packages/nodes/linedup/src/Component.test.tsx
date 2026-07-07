// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"
import React from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import type { NodeHostApi } from "@xiranite/contract"
import { Component } from "./Component.js"

afterEach(() => cleanup())

describe("linedup Component", () => {
  test("pastes clipboard text into source state", async () => {
    const host = createHost({})
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByTitle("Paste source"))

    expect(host.state.sourceText).toBe("alpha\nbeta-one\ngamma")
  })

  test("filters content locally and exposes copy/download actions", async () => {
    const host = createHost({
      sourceText: "gamma\nbeta-one\nalpha\nbeta-two",
      filterText: "beta",
    })
    renderComponent(host)
    const user = userEvent.setup()

    await user.click(screen.getByText("Filter"))

    await waitFor(() => expect(screen.getByText("kept=2 removed=2")).toBeTruthy())
    expect(screen.getByText("alpha")).toBeTruthy()
    expect(screen.getByText("gamma")).toBeTruthy()
    expect(screen.getByText("beta-one")).toBeTruthy()

    await user.click(screen.getByText("Kept"))
    expect(host.copiedText).toBe("alpha\ngamma")

    await user.click(screen.getByText("Save"))
    expect(host.downloads).toEqual([{ filename: "linedup-output.txt", content: "alpha\ngamma" }])
  })
})

function renderComponent(host: TestHost) {
  return render(
    <I18nextProvider i18n={i18n}>
      <Component compId="comp-linedup" host={host} />
    </I18nextProvider>,
  )
}

interface LinedupCardState {
  sourceText?: string
  filterText?: string
}

type TestHost = NodeHostApi & {
  state: LinedupCardState
  copiedText: string
  downloads: Array<{ filename: string; content: string }>
}

function createHost(initial: LinedupCardState): TestHost {
  const host: TestHost = {
    state: { ...initial },
    copiedText: "",
    downloads: [],
    getData: <T,>() => host.state as T,
    patchData: (_compId, patch) => {
      host.state = { ...host.state, ...patch }
    },
    listComponents: () => [],
    updateComponent: () => undefined,
    actions: {
      run: vi.fn(),
    },
    clipboard: {
      readText: async () => "alpha\nbeta-one\ngamma",
      writeText: async (text) => {
        host.copiedText = text
      },
    },
    downloadText: (filename, content) => {
      host.downloads.push({ filename, content })
    },
    env: {
      theme: "light",
      platform: "node",
    },
  }
  return host
}

const i18n = i18next.createInstance()
await i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  ns: ["module"],
  defaultNS: "module",
  interpolation: { escapeValue: false },
  resources: {
    en: {
      module: {
        linedup: {
          title: "linedup",
          meta: "{{source}} source / {{filters}} filters",
          pasteSource: "Paste source",
          pasteFilters: "Paste filters",
          filter: "Filter",
          reset: "Reset",
          sourceLabel: "source",
          sourcePlaceholder: "one item per line",
          filtersLabel: "filters",
          filtersPlaceholder: "remove source lines containing these tokens",
          statKept: "kept",
          statRemoved: "removed",
          kept: "Kept",
          removed: "Removed",
          save: "Save",
          runToPreview: "Run filter to preview removed lines.",
        },
      },
    },
  },
})
