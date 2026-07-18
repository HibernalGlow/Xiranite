export type ReaderMemoryPressureLevel = "normal" | "elevated" | "critical"

export interface ReaderMemoryPressureSnapshot {
  level: ReaderMemoryPressureLevel
  availableBytes?: number
  samples: number
  elevatedReliefs: number
  criticalReliefs: number
  admissionRejections: number
  lastReliefAtMs?: number
}
