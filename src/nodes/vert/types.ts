import type { VertData, VertEnginePreference, VertFormatCategory } from "@xiranite/node-vert/core"
export type VertPhase = "idle" | "running" | "completed" | "error"
export interface VertCardState { pathsText?: string; outputCategory?: Exclude<VertFormatCategory, "unknown">; targetFormat?: string; outputDirectory?: string; engine?: VertEnginePreference; overwrite?: boolean; quality?: number; result?: VertData | null; logs?: string[]; phase?: VertPhase; progress?: number; progressText?: string }
export const CONFIG_FIELDS = ["outputCategory", "targetFormat", "outputDirectory", "engine", "overwrite", "quality"] as const satisfies ReadonlyArray<keyof VertCardState>
