export interface CzkawkaWorkspaceLayout {
  version: 1;
  toolRailWidth: number;
  sourcePanelWidth: number;
  analysisPanelWidth: number;
  toolRailMinimized: boolean;
  sourcePanelMinimized: boolean;
  analysisPanelMinimized: boolean;
}

export const CZKAWKA_WORKSPACE_DEFAULTS: CzkawkaWorkspaceLayout = {
  version: 1,
  toolRailWidth: 176,
  sourcePanelWidth: 300,
  analysisPanelWidth: 300,
  toolRailMinimized: false,
  sourcePanelMinimized: false,
  analysisPanelMinimized: false,
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
    analysisPanelWidth: clamp(
      value.analysisPanelWidth,
      210,
      520,
      CZKAWKA_WORKSPACE_DEFAULTS.analysisPanelWidth,
    ),
    toolRailMinimized: value.toolRailMinimized === true,
    sourcePanelMinimized: value.sourcePanelMinimized === true,
    analysisPanelMinimized: value.analysisPanelMinimized === true,
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
