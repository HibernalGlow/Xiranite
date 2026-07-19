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
}

export type CzkawkaLaneId = "source" | "results" | "analysis";

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
