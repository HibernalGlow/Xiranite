export type SuperResolutionPolicyTrigger = "automatic-current" | "preload" | "manual"

export interface SuperResolutionPolicyInput {
  trigger: SuperResolutionPolicyTrigger
  width: number
  height: number
  bookPath: string
  imagePath: string
  innerPath?: string
  createdAt?: number
  modifiedAt?: number
  metadata?: Readonly<Record<string, unknown>>
}

export type SuperResolutionPolicyDecision =
  | {
      kind: "disabled" | "skip"
      reason: string
      conditionId?: string
      conditionName?: string
    }
  | {
      kind: "run"
      reason: string
      conditionId?: string
      conditionName?: string
      modelId: string
      scale: number
      noise?: number
      tileSize?: number
      tta?: boolean
      gpuId?: string
      useCache: boolean
    }
