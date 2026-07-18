import type { VertData, VertEnginePreference, VertFormatCategory } from "@xiranite/node-vert/core"
export type VertPhase = "idle" | "running" | "completed" | "error"
export type VertOutputCategory = Exclude<VertFormatCategory, "unknown">
export interface VertConversionGroupConfig { sourceFormat?: string; outputCategory: VertOutputCategory; targetFormat: string; deleteSourceAfterSuccess?: boolean }
export interface VertCardState { pathsText?: string; outputCategory?: VertOutputCategory; targetFormat?: string; conversionGroups?: Record<string, VertConversionGroupConfig>; outputDirectory?: string; engine?: VertEnginePreference; overwrite?: boolean; quality?: number; result?: VertData | null; logs?: string[]; phase?: VertPhase; progress?: number; progressText?: string }
export const CONFIG_FIELDS = ["outputCategory", "targetFormat", "conversionGroups", "outputDirectory", "engine", "overwrite", "quality"] as const satisfies ReadonlyArray<keyof VertCardState>
