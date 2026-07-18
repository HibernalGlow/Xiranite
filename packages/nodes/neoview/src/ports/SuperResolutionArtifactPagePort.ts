import type {
  SuperResolutionArtifactPageInput,
  SuperResolutionArtifactPageResult,
} from "./SuperResolutionArtifact.js"
import type { SuperResolutionExecutionContext } from "./SuperResolutionProvider.js"

export interface SuperResolutionArtifactPagePort extends AsyncDisposable {
  acquireOrGenerate(
    input: SuperResolutionArtifactPageInput,
    context?: SuperResolutionExecutionContext,
  ): Promise<SuperResolutionArtifactPageResult>
}
