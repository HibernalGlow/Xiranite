export type RamOptimizerScope = "all" | "JPEG XL" | "SVT-AV1-PSY"
export type RamOptimizerMode = "dynamic" | "static" | "disabled"
export interface RamOptimizationRule { scope: RamOptimizerScope; threshold: number; target: string }
export interface RamOptimizerContext { format: string; avifEncoder?: string; jpegXlEffort: number; jpegXlLossyModular: boolean; jpegXlLossless: boolean; jpegXlIntelligentEffort: boolean }

export const DEFAULT_RAM_OPTIMIZER_RULES = '("all", 3.5, "7/8"), ("all", 4.5, "6/8"), ("all", 5.5, "5/8"), ("all", 6.5, "4/8"), ("all", 7.5, "3/8"), ("all", 8.5, "2/8"), ("all", 9.5, "1/8"), ("all", 10.5, "1")'
const VALID_SCOPES = new Set<RamOptimizerScope>(["all", "JPEG XL", "SVT-AV1-PSY"])

export function parseRamOptimizationRules(value: string): RamOptimizationRule[] {
  const rules: RamOptimizationRule[] = []
  for (const match of value.matchAll(/\("([^"]+)",\s*(\d+(?:\.\d+)?),\s*"([1-9]+\/[1-9]+|1)"\)/g)) {
    const scope = match[1] as RamOptimizerScope, threshold = Number(match[2]), target = match[3]!
    if (!VALID_SCOPES.has(scope) || !Number.isFinite(threshold) || threshold < 0) continue
    if (target !== "1") { const [num, den] = target.split("/").map(Number); if (!num || !den) continue }
    rules.push({ scope, threshold, target })
  }
  return rules
}

export function doesRamRuleApply(rule: RamOptimizationRule, format: string, avifEncoder = ""): boolean {
  const jxl = format === "JPEG XL", svt = format === "AVIF" && ["svt", "SVT-AV1-PSY"].includes(avifEncoder)
  return rule.scope === "all" ? jxl || svt : rule.scope === "JPEG XL" ? jxl : svt
}

export function jpegXlUsesHighRam(effort: number, lossyModular: boolean, lossless: boolean, intelligentEffort: boolean): boolean {
  if (lossyModular) return true
  if (lossless) return effort >= 10
  return effort > 7 || intelligentEffort
}

export function isRamOptimizerNecessary(context: RamOptimizerContext): boolean {
  if (context.format === "JPEG XL") return jpegXlUsesHighRam(context.jpegXlEffort, context.jpegXlLossyModular, context.jpegXlLossless, context.jpegXlIntelligentEffort)
  return context.format === "AVIF" && ["svt", "SVT-AV1-PSY"].includes(context.avifEncoder ?? "")
}

export function maxRamOptimizerWorkers(usedThreads: number, megapixels: number, format: string, avifEncoder: string, rules: RamOptimizationRule[]): number {
  const threads = Math.max(1, Math.floor(usedThreads))
  const rule = [...rules].sort((a, b) => b.threshold - a.threshold).find((item) => megapixels >= item.threshold && doesRamRuleApply(item, format, avifEncoder))
  if (!rule) return threads
  if (rule.target === "1") return 1
  const [num, den] = rule.target.split("/").map(Number)
  return !num || !den ? threads : Math.max(1, Math.floor(threads * num / den))
}

export function optimizedEncoderThreads(mode: RamOptimizerMode, usedThreads: number, megapixels: number, context: RamOptimizerContext, rules: RamOptimizationRule[]): number {
  const threads = Math.max(1, Math.floor(usedThreads))
  if (mode === "disabled" || !isRamOptimizerNecessary(context) || mode === "static") return threads
  return Math.max(1, Math.floor(threads / maxRamOptimizerWorkers(threads, megapixels, context.format, context.avifEncoder ?? "", rules)))
}
