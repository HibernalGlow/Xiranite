import { normalizeCzkawkaCardLayout } from "@xiranite/node-czkawka/card-layout";
import { appendCzkawkaActivityLog } from "@xiranite/node-czkawka/activity-log";
import { resolveCzkawkaSimilarVideoCrop } from "@xiranite/node-czkawka/similar-video-crop";
import { normalizeCzkawkaWorkspaceLayout } from "@xiranite/node-czkawka/workspace-layout";
import type { CzkawkaCardState } from "./types";

export const CZKAWKA_STATE_VERSION = 2 as const;
const MOTION_CROP_MIGRATION_MESSAGE = "Similar video motion crop detection now uses Czkawka 12 static letterbox detection.";

export function normalizeCzkawkaCardState(
  value: CzkawkaCardState | undefined,
): CzkawkaCardState {
  const current = value ?? {};
  const similarVideoCrop = resolveCzkawkaSimilarVideoCrop(current);
  return {
    ...current,
    schemaVersion: CZKAWKA_STATE_VERSION,
    similarVideosLetterboxCrop: similarVideoCrop.letterboxCrop,
    cardLayout: normalizeCzkawkaCardLayout(current.cardLayout),
    workspaceLayout: normalizeCzkawkaWorkspaceLayout(current.workspaceLayout),
  };
}

export function czkawkaStateMigrationPatch(
  value: CzkawkaCardState | undefined,
): Partial<CzkawkaCardState> | undefined {
  const current = value ?? {};
  const normalized = normalizeCzkawkaCardState(current);
  const needsMotionCropNotice = resolveCzkawkaSimilarVideoCrop(current).motionDetectionRemoved
    && current.czkawka12MotionCropMigrationNotified !== true;
  if (
    current.schemaVersion === CZKAWKA_STATE_VERSION &&
    current.similarVideosLetterboxCrop === normalized.similarVideosLetterboxCrop &&
    same(current.cardLayout, normalized.cardLayout) &&
    same(current.workspaceLayout, normalized.workspaceLayout) &&
    !needsMotionCropNotice
  )
    return undefined;
  return {
    schemaVersion: CZKAWKA_STATE_VERSION,
    similarVideosLetterboxCrop: normalized.similarVideosLetterboxCrop,
    cardLayout: normalized.cardLayout,
    workspaceLayout: normalized.workspaceLayout,
    ...(needsMotionCropNotice
      ? {
          czkawka12MotionCropMigrationNotified: true,
          activityLog: appendCzkawkaActivityLog(current.activityLog ?? [], {
            tool: current.tool ?? "similar-videos",
            kind: "system",
            level: "warning",
            message: MOTION_CROP_MIGRATION_MESSAGE,
          }),
        }
      : {}),
  };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
