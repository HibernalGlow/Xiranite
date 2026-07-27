import { describe, expect, it } from "vitest"
import { parseNeoviewBoardLayoutPatch, parseNeoviewBookPatch, parseNeoviewBookmarkListPatch, parseNeoviewCardLayoutPatch, parseNeoviewEmmPatch, parseNeoviewFolderViewPatch, parseNeoviewHistoryListPatch, parseNeoviewPageListPatch, parseNeoviewPageTransitionPatch, parseNeoviewRuntimeConfig, parseNeoviewShellControlPatch, parseNeoviewSidebarLayoutPatch, parseNeoviewSlideshowPatch, parseNeoviewSystemMonitorPatch, parseNeoviewViewDefaultsPatch } from "./ReaderRuntimeConfig.js"

describe("parseNeoviewRuntimeConfig", () => {
  it("[neoview.settings.shell] normalizes legacy panel settings into bounded shell options", () => {
      const { shellOptions } = parseNeoviewRuntimeConfig({
        panels: {
          left_sidebar_visible: true,
          right_sidebar_visible: false,
          bottom_panel_visible: true,
          auto_hide_toolbar: false,
          sidebar_opacity: 73,
          sidebar_blur: 7,
          hover_areas: { top_trigger_height: 4, bottom_trigger_height: 5, left_trigger_width: 6, right_trigger_width: 7 },
          auto_hide_timing: { show_delay_sec: 0.125, hide_delay_sec: 0.75 },
          sidebars: {
            left: { width: 420, pinned: false, open: false, height: "custom", custom_height: 72, vertical_align: 40, horizontal_position: 15 },
            right: { width: 260, height: "2/3" },
          },
        },
      })
      expect(shellOptions).toMatchObject({
        showDelayMs: 125,
        hideDelayMs: 750,
        opacity: { sidebar: 73 },
        blur: { sidebar: 7 },
        edges: {
          top: { initialVisible: true, pinned: true, triggerSize: 4 },
          right: { enabled: false, triggerSize: 7 },
          bottom: { enabled: true, initialVisible: true, triggerSize: 5 },
          left: { enabled: true, initialVisible: false, pinned: false, triggerSize: 6 },
        },
        sidebars: {
          left: { width: 420, height: "custom", customHeight: 72, verticalAlign: 40, horizontalPosition: 15 },
          right: { width: 260, height: "two-thirds" },
        },
      })
    })

  it("[neoview.card.sidebar-control.data-contract] prefers canonical control tables and reads previously imported legacy values", () => {
      const canonical = parseNeoviewRuntimeConfig({
        reader: { view: { sidebar_control: { enabled: false, position: { x: 17, y: 19 } } } },
        panels: {
          auto_hide_toolbar: false,
          hover_areas: { top_trigger_height: 7 },
          sidebar_control: { enabled: true, position: { x: 120, y: 140 }, future: "preserved-on-disk" },
          edges: {
            top: { enabled: false, initial_visible: false, pinned: false, trigger_size: 11, lock_mode: "locked-hidden", future: 1 },
          },
        },
      }).shellOptions
      expect(canonical.floatingControl).toEqual({ enabled: true, position: { x: 120, y: 140 } })
      expect(canonical.edges.top).toEqual({
        enabled: false,
        initialVisible: false,
        pinned: false,
        triggerSize: 11,
        lockMode: "locked-hidden",
      })
  
      const legacy = parseNeoviewRuntimeConfig({
        reader: { view: { sidebar_control: { enabled: false, position: { x: 23, y: 29 } } } },
      }).shellOptions
      expect(legacy.floatingControl).toEqual({ enabled: false, position: { x: 23, y: 29 } })
    })

  it("[neoview.card.sidebar-control.persistence] validates one revisioned control patch and emits canonical leaf tables", () => {
      expect(parseNeoviewShellControlPatch({
        expectedRevision: 4,
        shellControl: {
          floating: { enabled: false, position: { x: 240, y: 180 } },
          edges: {
            top: { enabled: false, initialVisible: false, pinned: false, triggerSize: 12, lockMode: "locked-hidden" },
            left: { pinned: true, lockMode: "locked-open" },
          },
        },
      })).toEqual({
        patch: {
          expectedRevision: 4,
          shellControl: {
            floating: { enabled: false, position: { x: 240, y: 180 } },
            edges: {
              top: { enabled: false, initialVisible: false, pinned: false, triggerSize: 12, lockMode: "locked-hidden" },
              left: { pinned: true, lockMode: "locked-open" },
            },
          },
        },
        tomlPatch: { panels: {
          sidebar_control: { enabled: false, position: { x: 240, y: 180 } },
          edges: {
            top: { enabled: false, initial_visible: false, pinned: false, trigger_size: 12, lock_mode: "locked-hidden" },
            left: { pinned: true, lock_mode: "locked-open" },
          },
        } },
      })
      const reset = parseNeoviewShellControlPatch({ expectedRevision: 5, shellControl: { reset: "known-defaults" } })
      expect(reset.patch).toEqual({ expectedRevision: 5, shellControl: { reset: "known-defaults" } })
      expect(reset.tomlPatch).toMatchObject({ panels: {
        sidebar_control: { enabled: true, position: { x: 100, y: 100 } },
        edges: {
          top: { enabled: true, initial_visible: true, pinned: false, trigger_size: 32, lock_mode: "auto" },
          left: { enabled: true, initial_visible: true, pinned: true, trigger_size: 32, lock_mode: "auto" },
        },
      } })
      expect(() => parseNeoviewShellControlPatch({ expectedRevision: 0, shellControl: {} })).toThrow("at least one")
      expect(() => parseNeoviewShellControlPatch({ expectedRevision: 0, shellControl: { reset: "known-defaults", floating: { enabled: true } } })).toThrow("cannot be combined")
      expect(() => parseNeoviewShellControlPatch({ expectedRevision: 0, shellControl: { floating: { position: { x: 1 } } } })).toThrow("requires x and y")
      expect(() => parseNeoviewShellControlPatch({ expectedRevision: 0, shellControl: { edges: { center: { pinned: true } } } })).toThrow("unsupported edges")
      expect(() => parseNeoviewShellControlPatch({ expectedRevision: 0, shellControl: { edges: { top: { triggerSize: 129 } } } })).toThrow("triggerSize")
      expect(() => parseNeoviewShellControlPatch({ expectedRevision: 0, shellControl: { edges: { top: { lockMode: "forever" } } } })).toThrow("lockMode")
    })

  it("[neoview.swimlane.config] keeps edge mode as the compatible default and persists an independent lane workspace", () => {
      const defaults = parseNeoviewRuntimeConfig({
        panels: {
          sidebars: {
            left: { width: 438 },
            right: { width: 366 },
          },
        },
      }).shellOptions.workspace
      expect(defaults).toEqual({
        mode: "edges",
        swimlane: {
          laneOrder: ["left", "reader", "right"],
          activeLane: "reader",
          readerSolo: true,
          readerSoloOnFocus: true,
          readerWidthRatio: 0.5,
          edgeRevealDelayMs: 180,
          edgeRevealZones: {
            left: { x: 0, y: 10, width: 1, height: 80 },
            right: { x: 99, y: 10, width: 1, height: 80 },
            top: { x: 10, y: 0, width: 80, height: 1 },
            bottom: { x: 10, y: 99, width: 80, height: 1 },
          },
          readerFocusOnHover: true,
          readerFocusHoverDelayMs: 650,
          manualScrollEnabled: false,
          showLaneNavigatorInReaderSolo: false,
          autoFitToViewport: false,
          barHandleStyle: "grip",
          barHandlePosition: "left",
          laneNavigatorPositionX: 92,
          laneNavigatorPositionY: 96,
          laneNavigatorDock: "floating",
          windowControlsPlacement: "lane",
          windowControlsOwnerLaneId: "right",
          windowControlsExpanded: false,
          lanes: {
            left: { width: 438, collapsed: false, activePanelId: "folder", panelBarMode: "pinned", panelBarDock: "left", panelBarPositionX: 8, panelBarPositionY: 50, panelBarConstrained: true },
            reader: { width: 960, collapsed: false },
            right: { width: 366, collapsed: false, activePanelId: "info", panelBarMode: "pinned", panelBarDock: "right", panelBarPositionX: 92, panelBarPositionY: 50, panelBarConstrained: true },
          },
        },
      })
  
      const parsed = parseNeoviewRuntimeConfig({
        panels: {
          layout_mode: "swimlane",
          swimlane: {
            lane_order: ["right", "reader", "left"],
            active_lane: "right",
            reader_solo: false,
            reader_solo_on_focus: false,
            reader_width_ratio: 0.6,
            edge_reveal_delay_ms: 420,
            left_reveal_zone: { x: 3, y: 18, width: 7, height: 62 },
            right_reveal_zone: { x: 90, y: 18, width: 7, height: 62 },
            top_reveal_zone: { x: 14, y: 2, width: 72, height: 6 },
            bottom_reveal_zone: { x: 14, y: 92, width: 72, height: 6 },
            reader_focus_on_hover: false,
            reader_focus_hover_delay_ms: 900,
            manual_scroll_enabled: true,
            show_lane_navigator_in_reader_solo: true,
            auto_fit_to_viewport: true,
            bar_handle_style: "edge",
            bar_handle_position: "right",
            lane_navigator_position_x: 84,
            lane_navigator_position_y: 91,
            lane_navigator_dock: "window-title",
            window_controls_placement: "titlebar",
            window_controls_owner_lane_id: "left",
            window_controls_expanded: true,
            left: { width: 512, collapsed: true, active_panel_id: "history", panel_bar_mode: "floating", panel_bar_dock: "bottom", panel_bar_position_x: 42, panel_bar_position_y: 88, panel_bar_constrained: false },
            reader: { width: 1440, collapsed: false },
            right: { width: 640, collapsed: false, active_panel_id: "properties", panel_bar_mode: "pinned", panel_bar_dock: "top" },
          },
        },
      }).shellOptions.workspace
      expect(parsed).toEqual({
        mode: "swimlane",
        swimlane: {
          laneOrder: ["right", "reader", "left"],
          activeLane: "right",
          readerSolo: false,
          readerSoloOnFocus: false,
          readerWidthRatio: 0.6,
          edgeRevealDelayMs: 420,
          edgeRevealZones: {
            left: { x: 3, y: 18, width: 7, height: 62 },
            right: { x: 90, y: 18, width: 7, height: 62 },
            top: { x: 14, y: 2, width: 72, height: 6 },
            bottom: { x: 14, y: 92, width: 72, height: 6 },
          },
          readerFocusOnHover: false,
          readerFocusHoverDelayMs: 900,
          manualScrollEnabled: true,
          showLaneNavigatorInReaderSolo: true,
          autoFitToViewport: true,
          barHandleStyle: "edge",
          barHandlePosition: "right",
          laneNavigatorPositionX: 84,
          laneNavigatorPositionY: 91,
          laneNavigatorDock: "window-title",
          windowControlsPlacement: "titlebar",
          windowControlsOwnerLaneId: "left",
          windowControlsExpanded: true,
          lanes: {
            left: { width: 512, collapsed: true, activePanelId: "history", panelBarMode: "floating", panelBarDock: "bottom", panelBarPositionX: 42, panelBarPositionY: 88, panelBarConstrained: false },
            reader: { width: 1440, collapsed: false },
            right: { width: 640, collapsed: false, activePanelId: "properties", panelBarMode: "pinned", panelBarDock: "top", panelBarPositionX: 92, panelBarPositionY: 50, panelBarConstrained: true },
          },
        },
      })
  
      expect(parseNeoviewShellControlPatch({
        expectedRevision: 8,
        shellControl: {
          workspace: {
            mode: "swimlane",
            laneOrder: ["right", "reader", "left"],
            activeLane: "right",
            readerSolo: true,
            readerSoloOnFocus: false,
            soloLaneId: "left",
            readerWidthRatio: 0.65,
            edgeRevealDelayMs: 300,
            edgeRevealZones: {
              left: { x: 4, y: 12, width: 8, height: 70 },
              right: { x: 88, y: 12, width: 8, height: 70 },
              top: { x: 12, y: 3, width: 76, height: 5 },
              bottom: { x: 12, y: 92, width: 76, height: 5 },
            },
            readerFocusOnHover: true,
            readerFocusHoverDelayMs: 800,
            manualScrollEnabled: true,
            showLaneNavigatorInReaderSolo: true,
            barHandleStyle: "edge",
            barHandlePosition: "right",
            laneNavigatorPositionX: 82,
            laneNavigatorPositionY: 93,
            laneNavigatorDock: "window-title",
            windowControlsPlacement: "titlebar",
            windowControlsOwnerLaneId: "left",
            windowControlsExpanded: true,
            lanes: {
              left: { width: 512, collapsed: true, activePanelId: "history", panelBarMode: "floating", panelBarDock: "bottom", panelBarPositionX: 44, panelBarPositionY: 92, panelBarConstrained: false },
              reader: { width: 1320 },
            },
          },
        },
      })).toEqual({
        patch: {
          expectedRevision: 8,
          shellControl: {
            workspace: {
              mode: "swimlane",
              laneOrder: ["right", "reader", "left"],
              activeLane: "right",
              readerSolo: true,
              readerSoloOnFocus: false,
              soloLaneId: "left",
              readerWidthRatio: 0.65,
              edgeRevealDelayMs: 300,
              edgeRevealZones: {
                left: { x: 4, y: 12, width: 8, height: 70 },
                right: { x: 88, y: 12, width: 8, height: 70 },
                top: { x: 12, y: 3, width: 76, height: 5 },
                bottom: { x: 12, y: 92, width: 76, height: 5 },
              },
              readerFocusOnHover: true,
              readerFocusHoverDelayMs: 800,
              manualScrollEnabled: true,
              showLaneNavigatorInReaderSolo: true,
              barHandleStyle: "edge",
              barHandlePosition: "right",
              laneNavigatorPositionX: 82,
              laneNavigatorPositionY: 93,
              laneNavigatorDock: "window-title",
              windowControlsPlacement: "titlebar",
              windowControlsOwnerLaneId: "left",
              windowControlsExpanded: true,
              lanes: {
                left: { width: 512, collapsed: true, activePanelId: "history", panelBarMode: "floating", panelBarDock: "bottom", panelBarPositionX: 44, panelBarPositionY: 92, panelBarConstrained: false },
                reader: { width: 1320 },
              },
            },
          },
        },
        tomlPatch: {
          panels: {
            layout_mode: "swimlane",
            swimlane: {
              lane_order: ["right", "reader", "left"],
              reader_solo_on_focus: false,
              reader_width_ratio: 0.65,
              edge_reveal_delay_ms: 300,
              left_reveal_zone: { x: 4, y: 12, width: 8, height: 70 },
              right_reveal_zone: { x: 88, y: 12, width: 8, height: 70 },
              top_reveal_zone: { x: 12, y: 3, width: 76, height: 5 },
              bottom_reveal_zone: { x: 12, y: 92, width: 76, height: 5 },
              reader_focus_on_hover: true,
              reader_focus_hover_delay_ms: 800,
              manual_scroll_enabled: true,
              show_lane_navigator_in_reader_solo: true,
              bar_handle_style: "edge",
              bar_handle_position: "right",
              lane_navigator_position_x: 82,
              lane_navigator_position_y: 93,
              lane_navigator_dock: "window-title",
              window_controls_placement: "titlebar",
              window_controls_owner_lane_id: "left",
              window_controls_expanded: true,
              left: { width: 512, collapsed: true, active_panel_id: "history", panel_bar_mode: "floating", panel_bar_dock: "bottom", panel_bar_position_x: 44, panel_bar_position_y: 92, panel_bar_constrained: false },
              reader: { width: 1320 },
            },
          },
        },
      })
      expect(parseNeoviewRuntimeConfig({
        panels: {
          swimlane: {
            left: {
              width: 320,
              landscape_width: 360,
              portrait_width: 280,
              landscape_reader_solo_width: 440,
              portrait_reader_solo_width: 300,
            },
          },
        },
      }).shellOptions.workspace.swimlane.lanes.left).toMatchObject({
        width: 320,
        landscapeWidth: 360,
        portraitWidth: 280,
        landscapeReaderSoloWidth: 440,
        portraitReaderSoloWidth: 300,
      })
      expect(parseNeoviewShellControlPatch({
        expectedRevision: 9,
        shellControl: {
          workspace: {
            lanes: {
              left: { landscapeReaderSoloWidth: 456 },
            },
          },
        },
      })).toMatchObject({
        patch: { shellControl: { workspace: { lanes: { left: { landscapeReaderSoloWidth: 456 } } } } },
        tomlPatch: { panels: { swimlane: { left: { landscape_reader_solo_width: 456 } } } },
      })
      expect(() => parseNeoviewShellControlPatch({
        expectedRevision: 0,
        shellControl: { workspace: { lanes: { reader: { width: 80 } } } },
      })).toThrow("workspace.lanes.reader.width")
      expect(() => parseNeoviewShellControlPatch({
        expectedRevision: 0,
        shellControl: { workspace: { readerWidthRatio: 1.1 } },
      })).toThrow("workspace.readerWidthRatio")
      expect(() => parseNeoviewShellControlPatch({
        expectedRevision: 0,
        shellControl: { workspace: { readerFocusHoverDelayMs: 100 } },
      })).toThrow("workspace.readerFocusHoverDelayMs")
      expect(() => parseNeoviewShellControlPatch({
        expectedRevision: 0,
        shellControl: { workspace: { edgeRevealDelayMs: 50 } },
      })).toThrow("workspace.edgeRevealDelayMs")
      expect(parseNeoviewShellControlPatch({
        expectedRevision: 0,
        shellControl: { workspace: { laneOrder: ["left", "future", "reader"] } },
      }).patch.shellControl.workspace?.laneOrder).toEqual(["left", "future", "reader", "right"])
      expect(parseNeoviewShellControlPatch({
        expectedRevision: 1,
        shellControl: {
          workspace: {
            laneOrder: ["left", "reader", "research", "right"],
            activeLane: "research",
            lanes: { research: { width: 420, collapsed: false, title: "资料" } },
          },
        },
      }).tomlPatch.panels).toMatchObject({
        swimlane: {
          lane_order: ["left", "reader", "research", "right"],
          research: { width: 420, collapsed: false, title: "资料" },
        },
      })
      expect(parseNeoviewShellControlPatch({
        expectedRevision: 1,
        shellControl: { workspace: { activeLane: "research", readerSolo: true, soloLaneId: "research" } },
      }).tomlPatch).toEqual({})
    })

  it("[neoview.material.persistence] reads and atomically writes the complete shell material", () => {
      const shell = parseNeoviewRuntimeConfig({
        panels: {
          top_toolbar_opacity: 76,
          bottom_bar_opacity: 82,
          sidebar_opacity: 68,
          top_toolbar_blur: 14,
          bottom_bar_blur: 10,
          sidebar_blur: 18,
          material: {
            preset: "custom",
            top_saturation: 132,
            bottom_saturation: 118,
            sidebar_saturation: 144,
            top_highlight: 28,
            bottom_highlight: 34,
            sidebar_highlight: 42,
            top_shadow: 51,
            bottom_shadow: 47,
            sidebar_shadow: 56,
          },
        },
      }).shellOptions
      expect(shell).toMatchObject({
        opacity: { top: 76, bottom: 82, sidebar: 68 },
        blur: { top: 14, bottom: 10, sidebar: 18 },
        material: {
          preset: "custom",
          saturation: { top: 132, bottom: 118, sidebar: 144 },
          highlight: { top: 28, bottom: 34, sidebar: 42 },
          shadow: { top: 51, bottom: 47, sidebar: 56 },
        },
      })
  
      expect(parseNeoviewShellControlPatch({
        expectedRevision: 9,
        shellControl: {
          material: {
            preset: "custom",
            opacity: { top: 76, bottom: 82, sidebar: 68 },
            blur: { top: 14, bottom: 10, sidebar: 18 },
            saturation: { top: 132, bottom: 118, sidebar: 144 },
            highlight: { top: 28, bottom: 34, sidebar: 42 },
            shadow: { top: 51, bottom: 47, sidebar: 56 },
          },
        },
      })).toEqual({
        patch: {
          expectedRevision: 9,
          shellControl: {
            material: {
              preset: "custom",
              opacity: { top: 76, bottom: 82, sidebar: 68 },
              blur: { top: 14, bottom: 10, sidebar: 18 },
              saturation: { top: 132, bottom: 118, sidebar: 144 },
              highlight: { top: 28, bottom: 34, sidebar: 42 },
              shadow: { top: 51, bottom: 47, sidebar: 56 },
            },
          },
        },
        tomlPatch: { panels: {
          top_toolbar_opacity: 76,
          bottom_bar_opacity: 82,
          sidebar_opacity: 68,
          top_toolbar_blur: 14,
          bottom_bar_blur: 10,
          sidebar_blur: 18,
          material: {
            preset: "custom",
            top_saturation: 132,
            bottom_saturation: 118,
            sidebar_saturation: 144,
            top_highlight: 28,
            bottom_highlight: 34,
            sidebar_highlight: 42,
            top_shadow: 51,
            bottom_shadow: 47,
            sidebar_shadow: 56,
          },
        } },
      })
      expect(() => parseNeoviewShellControlPatch({
        expectedRevision: 0,
        shellControl: { material: { saturation: { top: 181 } } },
      })).toThrow("material.saturation.top")
    })

  it("rejects shell values outside safe rendering and timer limits", () => {
      expect(() => parseNeoviewRuntimeConfig({ panels: { hover_areas: { top_trigger_height: 0 } } })).toThrow("top trigger")
      expect(() => parseNeoviewRuntimeConfig({ panels: { auto_hide_timing: { hide_delay_sec: 6 } } })).toThrow("hide_delay_sec")
      expect(() => parseNeoviewRuntimeConfig({ panels: { sidebars: { left: { width: 1000 } } } })).toThrow("left.width")
    })

  it("[neoview.settings.shell-patch] validates and converts sidebar patches to TOML shape", () => {
      expect(parseNeoviewSidebarLayoutPatch({
        side: "right",
        pinned: false,
        width: 412,
        height: "two-thirds",
        customHeight: 72,
        verticalAlign: 35,
        horizontalPosition: 18,
      })).toEqual({
        patch: { side: "right", pinned: false, width: 412, height: "two-thirds", customHeight: 72, verticalAlign: 35, horizontalPosition: 18 },
        tomlPatch: { panels: {
          sidebars: { right: { pinned: false, width: 412, height: "2/3", custom_height: 72, vertical_align: 35, horizontal_position: 18 } },
          edges: { right: { pinned: false } },
        } },
      })
      expect(() => parseNeoviewSidebarLayoutPatch({ side: "left" })).toThrow("at least one")
      expect(() => parseNeoviewSidebarLayoutPatch({ side: "left", width: 199 })).toThrow("width")
      expect(() => parseNeoviewSidebarLayoutPatch({ side: "left", width: 320, token: "no" })).toThrow("unsupported")
    })

  it("[neoview.settings.panel-layout] preserves unknown panels and normalizes legacy sidebarConfig arrays", () => {
      const parsed = parseNeoviewRuntimeConfig({
        panels: {
          layout: {
            sidebarConfig: {
              panels: [
                { id: "pageList", visible: false, order: 20, position: "left" },
                { id: "futurePanel", visible: true, order: 1, position: "floating" },
              ],
            },
          },
        },
      })
      expect(parsed.shellOptions.panelLayout).toMatchObject({
        pageList: { visible: false, order: 20, position: "left" },
        futurePanel: { visible: true, order: 1, position: "floating" },
        info: { visible: true, position: "right" },
      })
    })

  it("[neoview.settings.card-layout] imports v14 card arrays and lets canonical state override them", () => {
      expect(parseNeoviewRuntimeConfig({}).shellOptions.cardLayout["sidebar-control"]).toEqual({
        panelId: "control", visible: true, expanded: true, order: 1,
      })
      const parsed = parseNeoviewRuntimeConfig({
        panels: {
          card_configs: {
            key: "neoview_card_configs_v14",
            data: {
              pageList: [{ id: "page-navigation", visible: true, expanded: false, order: 4, height: 240 }],
              future: [{ id: "future-card", visible: false, expanded: true, order: 2 }],
            },
          },
          card_state: {
            "page-navigation": { expanded: true, order: 1 },
          },
        },
      })
      expect(parsed.shellOptions.cardLayout).toMatchObject({
        "page-navigation": { panelId: "pageList", visible: true, expanded: true, order: 1, height: 240 },
        "future-card": { panelId: "future", visible: false, expanded: true, order: 2 },
      })
    })

  it("[neoview.card.sidebar-height.config] normalizes and persists real sidebar interaction behavior", () => {
      expect(parseNeoviewRuntimeConfig({
        panels: {
          sidebar_interaction: {
            show_drag_handle: true,
            enable_blank_area_collapse: false,
            blank_area_collapse_mode: "double",
          },
        },
      }).shellOptions.sidebarInteraction).toEqual({
        showDragHandle: true,
        enableBlankAreaCollapse: false,
        blankAreaCollapseMode: "double",
      })
  
      expect(parseNeoviewShellControlPatch({
        expectedRevision: 7,
        shellControl: {
          sidebarInteraction: {
            showDragHandle: true,
            enableBlankAreaCollapse: true,
            blankAreaCollapseMode: "double",
          },
        },
      })).toEqual({
        patch: {
          expectedRevision: 7,
          shellControl: {
            sidebarInteraction: {
              showDragHandle: true,
              enableBlankAreaCollapse: true,
              blankAreaCollapseMode: "double",
            },
          },
        },
        tomlPatch: {
          panels: {
            sidebar_interaction: {
              show_drag_handle: true,
              enable_blank_area_collapse: true,
              blank_area_collapse_mode: "double",
            },
          },
        },
      })
      expect(() => parseNeoviewShellControlPatch({
        expectedRevision: 0,
        shellControl: { sidebarInteraction: { blankAreaCollapseMode: "triple" } },
      })).toThrow("blankAreaCollapseMode")
    })
})
