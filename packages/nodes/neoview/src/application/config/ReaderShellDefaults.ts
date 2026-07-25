import { READER_CARD_MANIFEST, READER_PANEL_MANIFEST } from "./ReaderLayoutManifest.js"
import type { NeoviewShellConfig, NeoviewShellMaterialConfig } from "./ReaderRuntimeConfigModels.js"

export const DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG: NeoviewShellMaterialConfig = {
  preset: "frosted",
  saturation: { top: 115, bottom: 115, sidebar: 115 },
  highlight: { top: 35, bottom: 35, sidebar: 35 },
  shadow: { top: 45, bottom: 45, sidebar: 45 },
}

export const DEFAULT_NEOVIEW_SHELL_CONFIG: NeoviewShellConfig = {
  showDelayMs: 0,
  hideDelayMs: 0,
  opacity: { top: 85, bottom: 85, sidebar: 85 },
  blur: { top: 12, bottom: 12, sidebar: 12 },
  material: DEFAULT_NEOVIEW_SHELL_MATERIAL_CONFIG,
  floatingControl: { enabled: true, position: { x: 100, y: 100 } },
  edges: {
    top: {
      enabled: true,
      initialVisible: true,
      pinned: false,
      triggerSize: 32,
      lockMode: "auto",
    },
    right: {
      enabled: true,
      initialVisible: true,
      pinned: false,
      triggerSize: 32,
      lockMode: "auto",
    },
    bottom: {
      enabled: true,
      initialVisible: false,
      pinned: false,
      triggerSize: 32,
      lockMode: "auto",
    },
    left: {
      enabled: true,
      initialVisible: true,
      pinned: true,
      triggerSize: 32,
      lockMode: "auto",
    },
  },
  sidebars: {
    left: {
      width: 320,
      height: "full",
      customHeight: 100,
      verticalAlign: 0,
      horizontalPosition: 0,
    },
    right: {
      width: 280,
      height: "full",
      customHeight: 100,
      verticalAlign: 0,
      horizontalPosition: 0,
    },
  },
  sidebarInteraction: {
    showDragHandle: false,
    enableBlankAreaCollapse: true,
    blankAreaCollapseMode: "single",
  },
  workspace: {
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
        left: { width: 320, collapsed: false, activePanelId: "folder", panelBarMode: "pinned", panelBarDock: "left", panelBarPositionX: 8, panelBarPositionY: 50, panelBarConstrained: true },
        reader: { width: 960, collapsed: false },
        right: { width: 280, collapsed: false, activePanelId: "info", panelBarMode: "pinned", panelBarDock: "right", panelBarPositionX: 92, panelBarPositionY: 50, panelBarConstrained: true },
      },
    },
  },
  panelLayout: Object.fromEntries(
    READER_PANEL_MANIFEST.map((panel) => [
      panel.id,
      {
        visible: panel.defaultVisible,
        order: panel.defaultOrder,
        position: panel.defaultPosition,
      },
    ]),
  ),
  cardLayout: Object.fromEntries(
    READER_CARD_MANIFEST.map((card) => [
      card.id,
      {
        panelId: card.defaultPanelId,
        visible: card.defaultVisible,
        expanded: card.defaultExpanded,
        order: card.defaultOrder,
      },
    ]),
  ),
}
