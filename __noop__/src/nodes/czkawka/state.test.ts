import { describe, expect, test } from "vitest";
import {
  CZKAWKA_STATE_VERSION,
  czkawkaStateMigrationPatch,
  normalizeCzkawkaCardState,
} from "./state";

describe("Czkawka node state migration", () => {
  test("upgrades legacy state without losing user settings", () => {
    const legacy = {
      tool: "similar-images" as const,
      includedDirectoriesText: "D:/Photos",
      dryRun: false,
    };
    const value = normalizeCzkawkaCardState(legacy);
    expect(value).toMatchObject({
      ...legacy,
      schemaVersion: CZKAWKA_STATE_VERSION,
      cardLayout: { version: 1 },
      workspaceLayout: { version: 1 },
    });
    expect(czkawkaStateMigrationPatch(legacy)).toMatchObject({
      schemaVersion: CZKAWKA_STATE_VERSION,
      cardLayout: { version: 1 },
      workspaceLayout: { version: 1 },
    });
  });

  test("repairs invalid persisted layout once and then becomes stable", () => {
    const broken = {
      schemaVersion: 1 as const,
      workspaceLayout: {
        version: 1 as const,
        toolRailWidth: 999,
        sourcePanelWidth: 1,
        analysisPanelWidth: 300,
        toolRailMinimized: false,
        sourcePanelMinimized: false,
        analysisPanelMinimized: false,
      },
    };
    const patch = czkawkaStateMigrationPatch(broken);
    expect(patch?.workspaceLayout).toMatchObject({
      toolRailWidth: 260,
      sourcePanelWidth: 220,
    });
    expect(czkawkaStateMigrationPatch({ ...broken, ...patch })).toBeUndefined();
  });
});
