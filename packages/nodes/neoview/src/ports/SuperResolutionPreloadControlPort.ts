import type {
  SuperResolutionPreloadLiveSnapshot,
  SuperResolutionPreloadPlanInput,
  SuperResolutionProgressiveInput,
} from "./SuperResolutionPreload.js"

export type SuperResolutionPreloadPageState = "none" | "pending" | "settled"

export interface SuperResolutionPreloadControlPort {
  startPlan(input: Omit<SuperResolutionPreloadPlanInput, "signal">, signal?: AbortSignal): Promise<readonly SuperResolutionPreloadLiveSnapshot[]>
  startProgressive(input: Omit<SuperResolutionProgressiveInput, "signal">, signal?: AbortSignal): Promise<readonly SuperResolutionPreloadLiveSnapshot[]>
  snapshots(contextId: string, signal?: AbortSignal): Promise<readonly SuperResolutionPreloadLiveSnapshot[]>
  pageState?(contextId: string, pageIndex: number): SuperResolutionPreloadPageState
  pause(contextId: string, signal?: AbortSignal): Promise<readonly SuperResolutionPreloadLiveSnapshot[]>
  retry(
    contextId: string,
    mode: "nearby" | "progressive",
    signal?: AbortSignal,
  ): Promise<readonly SuperResolutionPreloadLiveSnapshot[]>
  advanceGeneration(contextId: string, generation: number): Promise<void>
  releaseContext(contextId: string): Promise<void>
}
