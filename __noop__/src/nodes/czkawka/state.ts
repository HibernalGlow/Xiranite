import { normalizeCzkawkaCardLayout } from "@xiranite/node-czkawka/card-layout";
import { normalizeCzkawkaWorkspaceLayout } from "@xiranite/node-czkawka/workspace-layout";
import type { CzkawkaCardState } from "./types";

export const CZKAWKA_STATE_VERSION = 1 as const;

export function normalizeCzkawkaCardState(
  value: CzkawkaCardState | undefined,
): CzkawkaCardState {
  const current = value ?? {};
  return {
    ...current,
    schemaVersion: CZKAWKA_STATE_VERSION,
    cardLayout: normalizeCzkawkaCardLayout(current.cardLayout),
    workspaceLayout: normalizeCzkawkaWorkspaceLayout(current.workspaceLayout),
  };
}

export function czkawkaStateMigrationPatch(
  value: CzkawkaCardState | undefined,
): Partial<CzkawkaCardState> | undefined {
  const current = value ?? {};
  const normalized = normalizeCzkawkaCardState(current);
  if (
    current.schemaVersion === CZKAWKA_STATE_VERSION &&
    same(current.cardLayout, normalized.cardLayout) &&
    same(current.workspaceLayout, normalized.workspaceLayout)
  )
    return undefined;
  return {
    schemaVersion: CZKAWKA_STATE_VERSION,
    cardLayout: normalized.cardLayout,
    workspaceLayout: normalized.workspaceLayout,
  };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
