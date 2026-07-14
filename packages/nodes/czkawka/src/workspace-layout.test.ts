import { describe, expect, test } from "vitest";
import {
  CZKAWKA_WORKSPACE_DEFAULTS,
  normalizeCzkawkaWorkspaceLayout,
  updateCzkawkaWorkspaceLayout,
} from "./workspace-layout.js";

describe("Czkawka workspace layout", () => {
  test("creates independent defaults and rejects unknown versions", () => {
    const first = normalizeCzkawkaWorkspaceLayout(undefined);
    const second = normalizeCzkawkaWorkspaceLayout({ version: 2 } as never);
    expect(first).toEqual(CZKAWKA_WORKSPACE_DEFAULTS);
    expect(second).toEqual(CZKAWKA_WORKSPACE_DEFAULTS);
    expect(first).not.toBe(CZKAWKA_WORKSPACE_DEFAULTS);
  });

  test("clamps widths and preserves panel minimization", () => {
    expect(
      normalizeCzkawkaWorkspaceLayout({
        version: 1,
        toolRailWidth: 999,
        sourcePanelWidth: 1,
        analysisPanelWidth: 410,
        sourcePanelMinimized: true,
      }),
    ).toMatchObject({
      toolRailWidth: 260,
      sourcePanelWidth: 220,
      analysisPanelWidth: 410,
      sourcePanelMinimized: true,
    });
    expect(
      updateCzkawkaWorkspaceLayout(CZKAWKA_WORKSPACE_DEFAULTS, {
        analysisPanelMinimized: true,
        analysisPanelWidth: 480,
      }),
    ).toMatchObject({ analysisPanelMinimized: true, analysisPanelWidth: 480 });
  });
});
