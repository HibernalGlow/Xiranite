import { LRUCache } from "lru-cache"

import type {
  SuperResolutionCondition,
  SuperResolutionConditionExpression,
  SuperResolutionPreferences,
} from "../../domain/super-resolution/super-resolution-preferences.js"
import type {
  SuperResolutionPolicyDecision,
  SuperResolutionPolicyInput,
} from "../../ports/SuperResolutionPolicy.js"

export type {
  SuperResolutionPolicyDecision,
  SuperResolutionPolicyInput,
  SuperResolutionPolicyTrigger,
} from "../../ports/SuperResolutionPolicy.js"

export interface SuperResolutionPolicyServiceOptions {
  regexCacheSize?: number
}

export class SuperResolutionPolicyService {
  readonly #preferences: SuperResolutionPreferences
  readonly #regexCache: LRUCache<string, RegExp>
  readonly #conditions: readonly SuperResolutionCondition[]

  constructor(preferences: SuperResolutionPreferences, options: SuperResolutionPolicyServiceOptions = {}) {
    const regexCacheSize = options.regexCacheSize ?? 128
    if (!Number.isInteger(regexCacheSize) || regexCacheSize < 1 || regexCacheSize > 4_096) {
      throw new RangeError("Super-resolution regex cache size must be an integer between 1 and 4096.")
    }
    this.#preferences = preferences
    this.#regexCache = new LRUCache({ max: regexCacheSize })
    this.#conditions = Object.freeze([...preferences.conditions]
      .filter((condition) => condition.enabled)
      .sort((left, right) => left.priority - right.priority))
  }

  decide(input: SuperResolutionPolicyInput): SuperResolutionPolicyDecision {
    validateInput(input)
    if (input.trigger !== "manual") {
      if (this.#preferences.globalUpscaleEnabled === false || this.#preferences.autoUpscaleEnabled !== true) {
        return { kind: "disabled", reason: "automatic-upscale-disabled" }
      }
      if (input.trigger === "preload" && this.#preferences.preUpscaleEnabled === false) {
        return { kind: "disabled", reason: "preload-upscale-disabled" }
      }
      if (this.#preferences.conditionalEnabled === true && (
        (this.#preferences.conditionalMinWidth ?? 0) > input.width
        || (this.#preferences.conditionalMinHeight ?? 0) > input.height
      )) {
        return { kind: "skip", reason: "below-conditional-minimum" }
      }
    }

    const condition = this.#preferences.conditionalEnabled === true
      ? this.#firstMatchingCondition(input)
      : undefined
    if (condition?.action.skip === true) {
      return {
        kind: "skip",
        reason: "condition-skip",
        conditionId: condition.id,
        conditionName: condition.name,
      }
    }
    if (condition?.match.excludeFromPreload === true && input.trigger === "preload") {
      return {
        kind: "skip",
        reason: "condition-excludes-preload",
        conditionId: condition.id,
        conditionName: condition.name,
      }
    }

    const modelId = condition?.action.modelId ?? this.#preferences.defaultModelId
    const scale = condition?.action.scale ?? this.#preferences.defaultScale
    if (!modelId || scale === undefined) {
      return {
        kind: "disabled",
        reason: "missing-model-defaults",
        conditionId: condition?.id,
        conditionName: condition?.name,
      }
    }
    const tileEnabled = condition?.action.tileEnabled ?? this.#preferences.defaultTileEnabled
    return {
      kind: "run",
      reason: condition ? "condition-match" : "default-policy",
      conditionId: condition?.id,
      conditionName: condition?.name,
      modelId,
      scale,
      noise: condition?.action.noise ?? this.#preferences.defaultNoise,
      tileSize: tileEnabled === false
        ? undefined
        : condition?.action.tileSize ?? this.#preferences.defaultTileSize,
      tta: condition?.action.tta ?? this.#preferences.defaultTta,
      gpuId: condition?.action.gpuId ?? this.#preferences.defaultGpuId,
      useCache: condition?.action.useCache ?? true,
    }
  }

  #firstMatchingCondition(input: SuperResolutionPolicyInput): SuperResolutionCondition | undefined {
    return this.#conditions.find((condition) => this.#matches(condition, input))
  }

  #matches(condition: SuperResolutionCondition, input: SuperResolutionPolicyInput): boolean {
    const match = condition.match
    const hasWidthRule = match.minWidth !== undefined || match.maxWidth !== undefined
    const hasHeightRule = match.minHeight !== undefined || match.maxHeight !== undefined
    const widthMatches = within(input.width, match.minWidth, match.maxWidth)
    const heightMatches = within(input.height, match.minHeight, match.maxHeight)
    if (match.dimensionMode === "or" && hasWidthRule && hasHeightRule) {
      if (!widthMatches && !heightMatches) return false
    } else if ((hasWidthRule && !widthMatches) || (hasHeightRule && !heightMatches)) {
      return false
    }

    const megapixels = input.width * input.height / 1_000_000
    if (!within(megapixels, match.minMegapixels, match.maxMegapixels)) return false
    if (!withinRequired(input.createdAt, match.createdBetween)) return false
    if (!withinRequired(input.modifiedAt, match.modifiedBetween)) return false
    if (match.bookPathRegex && !this.#regex(match.bookPathRegex).test(normalizePath(input.bookPath))) return false
    if (match.imagePathRegex) {
      const imageTarget = match.matchInnerPath === true && input.innerPath
        ? input.innerPath
        : input.imagePath
      if (!this.#regex(match.imagePathRegex).test(normalizePath(imageTarget))) return false
    }
    if (match.metadata) {
      for (const [key, expression] of Object.entries(match.metadata)) {
        if (!evaluateExpression(expression, input.metadata?.[key], (pattern) => this.#regex(pattern))) return false
      }
    }
    return true
  }

  #regex(pattern: string): RegExp {
    const cached = this.#regexCache.get(pattern)
    if (cached) {
      cached.lastIndex = 0
      return cached
    }
    const regex = new RegExp(pattern, "u")
    this.#regexCache.set(pattern, regex)
    return regex
  }
}

function evaluateExpression(
  expression: SuperResolutionConditionExpression,
  actual: unknown,
  regex: (pattern: string) => RegExp,
): boolean {
  switch (expression.operator) {
    case "eq": return actual === expression.value
    case "ne": return actual !== expression.value
    case "gt": return comparableNumber(actual) > comparableNumber(expression.value)
    case "gte": return comparableNumber(actual) >= comparableNumber(expression.value)
    case "lt": return comparableNumber(actual) < comparableNumber(expression.value)
    case "lte": return comparableNumber(actual) <= comparableNumber(expression.value)
    case "regex": return regex(String(expression.value)).test(String(actual ?? ""))
    case "contains": return String(actual ?? "").includes(String(expression.value))
  }
}

function validateInput(input: SuperResolutionPolicyInput): void {
  if (!Number.isFinite(input.width) || input.width <= 0) throw new RangeError("Super-resolution policy width must be positive.")
  if (!Number.isFinite(input.height) || input.height <= 0) throw new RangeError("Super-resolution policy height must be positive.")
  if (!input.bookPath.trim()) throw new TypeError("Super-resolution policy book path is required.")
  if (!input.imagePath.trim()) throw new TypeError("Super-resolution policy image path is required.")
}

function within(value: number, minimum?: number, maximum?: number): boolean {
  return (minimum === undefined || value >= minimum) && (maximum === undefined || value <= maximum)
}

function withinRequired(value: number | undefined, range: readonly [number, number] | undefined): boolean {
  if (!range) return true
  return value !== undefined && value >= range[0] && value <= range[1]
}

function comparableNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN
  if (typeof value === "string" && value.trim()) return Number(value)
  return Number.NaN
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/")
}
