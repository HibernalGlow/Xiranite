import type {
  SuperResolutionArtifactPageInput,
  SuperResolutionArtifactPageResult,
} from "../application/super-resolution/SuperResolutionArtifactPageService.js"
import type { SuperResolutionExecutionContext } from "./SuperResolutionProvider.js"

export interface SuperResolutionArtifactPagePort extends AsyncDisposable {
  acquireOrGenerate(
    input: SuperResolutionArtifactPageInput,
    context?: SuperResolutionExecutionContext,
  ): Promise<SuperResolutionArtifactPageResult>
}
