import type {
  SuperResolutionArtifactPageInput,
  SuperResolutionArtifactPageResult,
} from "./SuperResolutionArtifact.js"
import type { SuperResolutionExecutionContext } from "./SuperResolutionProvider.js"
import type {
  SuperResolutionCapabilitySnapshot,
  SuperResolutionModelManifest,
} from "./SuperResolutionProvider.js"

export type SuperResolutionModelCapabilitySnapshot =
  | { available: false; reason: string; models: readonly []; engines: readonly [] }
  | {
      available: true
      models: readonly SuperResolutionModelManifest[]
      engines: SuperResolutionCapabilitySnapshot["engines"]
      probedAt: number
    }

export interface SuperResolutionArtifactPagePort extends AsyncDisposable {
  acquireOrGenerate(
    input: SuperResolutionArtifactPageInput,
    context?: SuperResolutionExecutionContext,
  ): Promise<SuperResolutionArtifactPageResult>
  inspect?(options?: { refresh?: boolean; signal?: AbortSignal }): Promise<SuperResolutionModelCapabilitySnapshot>
}
