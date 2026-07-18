import type {
  SuperResolutionPreloadLiveSnapshot,
  SuperResolutionPreloadPlanInput,
  SuperResolutionProgressiveInput,
} from "./SuperResolutionPreload.js"

export interface SuperResolutionPreloadControlPort {
  startPlan(input: Omit<SuperResolutionPreloadPlanInput, "signal">, signal?: AbortSignal): Promise<readonly SuperResolutionPreloadLiveSnapshot[]>
  startProgressive(input: Omit<SuperResolutionProgressiveInput, "signal">, signal?: AbortSignal): Promise<readonly SuperResolutionPreloadLiveSnapshot[]>
  snapshots(contextId: string, signal?: AbortSignal): Promise<readonly SuperResolutionPreloadLiveSnapshot[]>
  pause(contextId: string, signal?: AbortSignal): Promise<readonly SuperResolutionPreloadLiveSnapshot[]>
  retry(
    contextId: string,
    mode: "nearby" | "progressive",
    signal?: AbortSignal,
  ): Promise<readonly SuperResolutionPreloadLiveSnapshot[]>
  releaseContext(contextId: string): Promise<void>
}
