export interface CzkawkaWorkspaceLayout {
  version: 1;
  toolRailWidth: number;
  sourcePanelWidth: number;
  resultPanelWidth: number;
  analysisPanelWidth: number;
  toolRailMinimized: boolean;
  sourcePanelMinimized: boolean;
  resultPanelMinimized: boolean;
  analysisPanelMinimized: boolean;
  laneOrder: CzkawkaLaneId[];
  activeLane: CzkawkaLaneId;
  soloLane: CzkawkaLaneId | null;
  focusOnHover: boolean;
  soloOnFocus: boolean;
  showNavigatorInSolo: boolean;
  focusDelayMs: number;
  edgeRevealDelayMs: number;
  barHandleStyle: CzkawkaBarHandleStyle;
  barHandlePosition: CzkawkaBarHandlePosition;
  navigatorPositionX: number;
  navigatorPositionY: number;
  navigatorDock: "floating" | "title";
  autoFitToViewport: boolean;
}

export type CzkawkaLaneId = "source" | "results" | "analysis";
export type CzkawkaBarHandleStyle = "grip" | "groove" | "move" | "grab" | "edge";
export type CzkawkaBarHandlePosition = "left" | "right";

export const CZKAWKA_WORKSPACE_DEFAULTS: CzkawkaWorkspaceLayout = {
  version: 1,
  toolRailWidth: 176,
  sourcePanelWidth: 300,
  resultPanelWidth: 720,
  analysisPanelWidth: 300,
  toolRailMinimized: false,
  sourcePanelMinimized: false,
  resultPanelMinimized: false,
  analysisPanelMinimized: false,
  laneOrder: ["source", "results", "analysis"],
  activeLane: "results",
  soloLane: null,
  focusOnHover: false,
  soloOnFocus: false,
  showNavigatorInSolo: true,
  focusDelayMs: 650,
  edgeRevealDelayMs: 250,
  barHandleStyle: "grip",
  barHandlePosition: "left",
  navigatorPositionX: 96,
  navigatorPositionY: 94,
  navigatorDock: "floating",
  autoFitToViewport: false,
};

export function normalizeCzkawkaWorkspaceLayout(
  value: Partial<CzkawkaWorkspaceLayout> | undefined,
): CzkawkaWorkspaceLayout {
  if (!value || value.version !== 1) return { ...CZKAWKA_WORKSPACE_DEFAULTS };
  return {
    version: 1,
    toolRailWidth: clamp(
      value.toolRailWidth,
      120,
      260,
      CZKAWKA_WORKSPACE_DEFAULTS.toolRailWidth,
    ),
    sourcePanelWidth: clamp(
      value.sourcePanelWidth,
      220,
      560,
      CZKAWKA_WORKSPACE_DEFAULTS.sourcePanelWidth,
    ),
    resultPanelWidth: clamp(
      value.resultPanelWidth,
      360,
      1200,
      CZKAWKA_WORKSPACE_DEFAULTS.resultPanelWidth,
    ),
    analysisPanelWidth: clamp(
      value.analysisPanelWidth,
      210,
      520,
      CZKAWKA_WORKSPACE_DEFAULTS.analysisPanelWidth,
    ),
    toolRailMinimized: value.toolRailMinimized === true,
    sourcePanelMinimized: value.sourcePanelMinimized === true,
    resultPanelMinimized: value.resultPanelMinimized === true,
    analysisPanelMinimized: value.analysisPanelMinimized === true,
    laneOrder: normalizeLaneOrder(value.laneOrder),
    activeLane: normalizeLaneId(value.activeLane, CZKAWKA_WORKSPACE_DEFAULTS.activeLane),
    soloLane: value.soloLane == null ? null : normalizeLaneId(value.soloLane, null),
    focusOnHover: value.focusOnHover === true,
    soloOnFocus: value.soloOnFocus === true,
    showNavigatorInSolo: value.showNavigatorInSolo !== false,
    focusDelayMs: clamp(value.focusDelayMs, 200, 5000, CZKAWKA_WORKSPACE_DEFAULTS.focusDelayMs),
    edgeRevealDelayMs: clamp(value.edgeRevealDelayMs, 100, 5000, CZKAWKA_WORKSPACE_DEFAULTS.edgeRevealDelayMs),
    barHandleStyle: normalizeHandleStyle(value.barHandleStyle),
    barHandlePosition: value.barHandlePosition === "right" ? "right" : "left",
    navigatorPositionX: clamp(value.navigatorPositionX, 0, 100, CZKAWKA_WORKSPACE_DEFAULTS.navigatorPositionX),
    navigatorPositionY: clamp(value.navigatorPositionY, 0, 100, CZKAWKA_WORKSPACE_DEFAULTS.navigatorPositionY),
    navigatorDock: value.navigatorDock === "title" ? "title" : "floating",
    autoFitToViewport: value.autoFitToViewport === true,
  };
}

export function updateCzkawkaWorkspaceLayout(
  layout: CzkawkaWorkspaceLayout,
  patch: Partial<Omit<CzkawkaWorkspaceLayout, "version">>,
): CzkawkaWorkspaceLayout {
  return normalizeCzkawkaWorkspaceLayout({ ...layout, ...patch });
}

function clamp(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  return Math.min(
    max,
    Math.max(min, Number.isFinite(value) ? value! : fallback),
  );
}

function normalizeLaneOrder(value: CzkawkaLaneId[] | undefined): CzkawkaLaneId[] {
  const valid = new Set<CzkawkaLaneId>(["source", "results", "analysis"]);
  const next = (value ?? []).filter((id, index, items) => valid.has(id) && items.indexOf(id) === index);
  for (const id of CZKAWKA_WORKSPACE_DEFAULTS.laneOrder) if (!next.includes(id)) next.push(id);
  return next;
}

function normalizeLaneId<Fallback extends CzkawkaLaneId | null>(value: unknown, fallback: Fallback): CzkawkaLaneId | Fallback {
  return value === "source" || value === "results" || value === "analysis" ? value : fallback;
}

function normalizeHandleStyle(value: unknown): CzkawkaBarHandleStyle {
  return value === "groove" || value === "move" || value === "grab" || value === "edge" ? value : "grip";
}
