import { describe, expect, it } from "vitest"
import { parseNeoviewBoardLayoutPatch, parseNeoviewBookPatch, parseNeoviewBookmarkListPatch, parseNeoviewCardLayoutPatch, parseNeoviewEmmPatch, parseNeoviewFolderViewPatch, parseNeoviewHistoryListPatch, parseNeoviewPageListPatch, parseNeoviewPageTransitionPatch, parseNeoviewRuntimeConfig, parseNeoviewShellControlPatch, parseNeoviewSidebarLayoutPatch, parseNeoviewSlideshowPatch, parseNeoviewSystemMonitorPatch, parseNeoviewViewDefaultsPatch } from "./ReaderRuntimeConfig.js"

describe("parseNeoviewRuntimeConfig", () => {
  it("[neoview.page-transition.config] [neoview.page-transition.toml] parses canonical settings and emits strict leaf patches", () => {
      expect(parseNeoviewRuntimeConfig({ image: { page_transition: {
        enabled: true,
        type: "slideUp",
        duration: 750,
        easing: "easeOutCubic", render_every_repeated_page: false,
        future_field: "preserved-on-disk",
      } } }).pageTransition).toEqual({
        enabled: true,
        type: "slideUp",
        duration: 750,
        easing: "easeOutCubic", renderEveryRepeatedPage: false,
      })
      expect(parseNeoviewPageTransitionPatch({ pageTransition: { enabled: true, type: "flip", duration: 320, renderEveryRepeatedPage: false } })).toEqual({
        patch: { pageTransition: { enabled: true, type: "flip", duration: 320, renderEveryRepeatedPage: false } },
        tomlPatch: { image: { page_transition: { enabled: true, type: "flip", duration: 320, render_every_repeated_page: false } } },
      })
      expect(() => parseNeoviewPageTransitionPatch({ pageTransition: { duration: 501 } })).toThrow("duration")
      expect(() => parseNeoviewPageTransitionPatch({ pageTransition: { type: "fold" } })).toThrow("type")
      expect(() => parseNeoviewPageTransitionPatch({ pageTransition: {} })).toThrow("at least one")
      expect(() => parseNeoviewPageTransitionPatch({ pageTransition: { enabled: true }, other: true })).toThrow("unsupported")
    })

  it("[neoview.page-transition.reset] emits one exclusive full canonical reset", () => {
      expect(parseNeoviewPageTransitionPatch({ pageTransition: { reset: "defaults" } })).toEqual({
        patch: { pageTransition: { reset: "defaults" } },
        tomlPatch: { image: { page_transition: {
          enabled: false,
          type: "none",
          duration: 0,
          easing: "easeOutQuad", render_every_repeated_page: true,
        } } },
      })
      expect(() => parseNeoviewPageTransitionPatch({ pageTransition: { reset: "defaults", enabled: true } }))
        .toThrow("cannot be combined")
      expect(() => parseNeoviewPageTransitionPatch({ pageTransition: { reset: true } })).toThrow('must be "defaults"')
    })

  it("[neoview.thumbnail-maintenance.layout] keeps maintenance hidden until explicitly docked", () => {
      expect(parseNeoviewRuntimeConfig({}).shellOptions.cardLayout["thumbnail-maintenance"]).toEqual({
        panelId: "control", visible: false, expanded: true, order: 2,
      })
    })

  it("[neoview.thumbnail-architecture-metrics.registry] preserves the legacy properties placement without requiring a book", () => {
      expect(parseNeoviewRuntimeConfig({}).shellOptions.cardLayout["thumbnail-architecture-metrics"]).toEqual({
        panelId: "properties", visible: true, expanded: true, order: 7,
      })
    })

  it("[neoview.emm-tags.registry] preserves the non-hideable first properties Card without requiring a book", () => {
      expect(parseNeoviewRuntimeConfig({}).shellOptions.cardLayout["emm-tags"]).toEqual({
        panelId: "properties", visible: true, expanded: true, order: 0,
      })
    })

  it("[neoview.emm-auxiliary.registry] restores the missing legacy properties cards", () => {
      const cards = parseNeoviewRuntimeConfig({}).shellOptions.cardLayout
      expect(["folder-ratings", "favorite-tags", "emm-sync", "emm-config", "emm-raw-data"].map((id) => cards[id])).toEqual([
        { panelId: "properties", visible: true, expanded: true, order: 2 },
        { panelId: "properties", visible: true, expanded: true, order: 3 },
        { panelId: "properties", visible: true, expanded: true, order: 4 },
        { panelId: "properties", visible: true, expanded: true, order: 5 },
        { panelId: "properties", visible: true, expanded: true, order: 6 },
      ])
    })

  it("[neoview.emm-config.runtime] parses and writes the canonical EMM source section", () => {
      expect(parseNeoviewRuntimeConfig({ emm: {
        enabled: true,
        database_paths: ["D:/EMM/database.sqlite", "d:\\emm\\database.sqlite", "E:/Alt/database.sqlite"],
        setting_path: "D:/EMM/setting.json",
        translation_database_path: "D:/EMM/translations.db",
        translation_path: "D:/EMM/db.text.json",
        default_rating: 4.2,
      } }).emm).toEqual({
        enabled: true,
        databasePaths: ["D:/EMM/database.sqlite", "E:/Alt/database.sqlite"],
        settingPath: "D:/EMM/setting.json",
        translationDatabasePath: "D:/EMM/translations.db",
        translationPath: "D:/EMM/db.text.json",
        defaultRating: 4.2,
      })
      expect(parseNeoviewEmmPatch({ emm: { enabled: false, databasePaths: [], settingPath: "", translationDatabasePath: "", translationPath: "", defaultRating: 4.5 } })).toEqual({
        patch: { emm: { enabled: false, databasePaths: [], settingPath: undefined, translationDatabasePath: undefined, translationPath: undefined, defaultRating: 4.5 } },
        tomlPatch: { emm: { enabled: false, database_paths: [], setting_path: "", translation_database_path: "", translation_path: "", default_rating: 4.5 } },
      })
    })

  it("[neoview.color-filter.layout] keeps the legacy filter visible in the control panel without a session", () => {
      expect(parseNeoviewRuntimeConfig({}).shellOptions.cardLayout["color-filter"]).toEqual({
        panelId: "control", visible: true, expanded: true, order: 2,
      })
    })

  it("[neoview.ambient-background.layout] restores the Control panel for partial persisted Card state", () => {
      expect(parseNeoviewRuntimeConfig({
        panels: { card_state: { "ambient-background": { expanded: false } } },
      }).shellOptions.cardLayout["ambient-background"]).toEqual({
        panelId: "control", visible: true, expanded: false, order: 7,
      })
    })

  it("[neoview.ambient-background.layout-compat] imports the removed Appearance Card id without reviving it", () => {
      const legacyOnly = parseNeoviewRuntimeConfig({
        panels: { card_state: { "ambient-background-settings": { expanded: false } } },
      }).shellOptions.cardLayout
      expect(legacyOnly["ambient-background"]).toEqual({
        panelId: "control", visible: true, expanded: false, order: 7,
      })
      expect(legacyOnly["ambient-background-settings"]).toBeUndefined()
  
      const mixed = parseNeoviewRuntimeConfig({
        panels: { card_state: {
          "ambient-background-settings": { expanded: false },
          "ambient-background": { expanded: true },
        } },
      }).shellOptions.cardLayout
      expect(mixed["ambient-background"]?.expanded).toBe(true)
    })

  it("[neoview.settings.card-patch] validates card state and writes canonical TOML", () => {
      expect(parseNeoviewCardLayoutPatch({ cardId: "page-navigation", expanded: false, height: 320 })).toEqual({
        patch: { cardId: "page-navigation", expanded: false, height: 320 },
        tomlPatch: { panels: { card_state: { "page-navigation": { expanded: false, height: 320 } } } },
      })
      expect(parseNeoviewCardLayoutPatch({ cardId: "page-navigation", height: null })).toEqual({
        patch: { cardId: "page-navigation", height: null },
        tomlPatch: { panels: { card_state: { "page-navigation": { height: "auto" } } } },
      })
      expect(parseNeoviewRuntimeConfig({ panels: {
        card_configs: { data: { pageList: [{ id: "page-navigation", height: 240 }] } },
        card_state: { "page-navigation": { height: "auto" } },
      } }).shellOptions.cardLayout["page-navigation"]?.height).toBeUndefined()
      expect(() => parseNeoviewCardLayoutPatch({ cardId: "../bad", expanded: false })).toThrow("cardId")
      expect(() => parseNeoviewCardLayoutPatch({ cardId: "page-navigation" })).toThrow("at least one")
      expect(() => parseNeoviewCardLayoutPatch({ cardId: "page-navigation", height: 20 })).toThrow("height")
      expect(() => parseNeoviewCardLayoutPatch({ cardId: "page-navigation", visible: false })).toThrow("cannot hide")
      expect(() => parseNeoviewCardLayoutPatch({ cardId: "book-information", panelId: "cardwindow" })).toThrow("cannot place")
    })

  it("[neoview.settings.board-patch] compacts a complete editor draft into one canonical patch", () => {
      expect(parseNeoviewBoardLayoutPatch({ expectedRevision: 7, board: {
        panels: [{ id: "pageList", visible: true, order: 0, position: "left" }],
        cards: [{ cardId: "book-information", panelId: "pageList", visible: true, order: 0 }],
      } })).toEqual({
        patch: { expectedRevision: 7, board: {
          panels: [{ id: "pageList", visible: true, order: 0, position: "left" }],
          cards: [{ cardId: "book-information", panelId: "pageList", visible: true, order: 0 }],
        } },
        tomlPatch: { panels: {
          panel_state: { pageList: { visible: true, order: 0, position: "left" } },
          card_state: { "book-information": { visible: true, order: 0, panel_id: "pageList" } },
        } },
      })
      expect(() => parseNeoviewBoardLayoutPatch({ expectedRevision: 0, board: { panels: [], cards: [
        { cardId: "same", panelId: "info", visible: true, order: 0 },
        { cardId: "same", panelId: "info", visible: true, order: 1 },
      ] } })).toThrow("duplicate card")
      expect(() => parseNeoviewBoardLayoutPatch({ expectedRevision: 0, board: {
        panels: [{ id: "pageList", visible: true, order: 0, position: "left" }],
        cards: [{ cardId: "page-navigation", panelId: "pageList", visible: false, order: 0 }],
      } })).toThrow("cannot hide card page-navigation")
      expect(() => parseNeoviewBoardLayoutPatch({ expectedRevision: 0, board: {
        panels: [{ id: "cardwindow", visible: true, order: 0, position: "floating" }],
        cards: [{ cardId: "book-information", panelId: "cardwindow", visible: true, order: 0 }],
      } })).toThrow("cannot be placed in a floating panel")
      expect(() => parseNeoviewBoardLayoutPatch({ expectedRevision: 0, board: {
        panels: [{ id: "history", visible: true, order: 0, position: "left" }],
        cards: [
          { cardId: "history-list", panelId: "history", visible: true, order: 0 },
          { cardId: "book-information", panelId: "history", visible: true, order: 1 },
        ],
      } })).toThrow("history-list requires exclusive panel history")
      expect(() => parseNeoviewBoardLayoutPatch({ expectedRevision: 0, board: {
        panels: [{ id: "history", visible: true, order: 0, position: "left" }],
        cards: [
          { cardId: "history-list", panelId: "history", visible: true, order: 0 },
          { cardId: "book-information", panelId: "history", visible: false, order: 1 },
        ],
      } })).toThrow("cannot hide card book-information")
    })
})
