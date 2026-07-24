import { Engine, type TopLevelCondition } from "json-rules-engine"
import { z } from "zod"

export const RULE_TREE_FORMAT = "xiranite-rule-tree/v1" as const

export const ruleValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
])

export const ruleOperatorSchema = z.enum([
  "equal",
  "notEqual",
  "contains",
  "doesNotContain",
  "startsWith",
  "endsWith",
  "in",
  "notIn",
  "lessThan",
  "lessThanInclusive",
  "greaterThan",
  "greaterThanInclusive",
  "isEmpty",
  "isNotEmpty",
])

export const ruleConditionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("condition"),
  field: z.string().min(1),
  operator: ruleOperatorSchema,
  value: ruleValueSchema.optional(),
})

export type RuleValue = z.infer<typeof ruleValueSchema>
export type RuleOperator = z.infer<typeof ruleOperatorSchema>
export type RuleCondition = z.infer<typeof ruleConditionSchema>

export interface RuleGroup {
  id: string
  kind: "group"
  combinator: "all" | "any"
  not: boolean
  children: RuleNode[]
}

export type RuleNode = RuleCondition | RuleGroup

export const ruleGroupSchema: z.ZodType<RuleGroup> = z.lazy(() => z.object({
  id: z.string().min(1),
  kind: z.literal("group"),
  combinator: z.enum(["all", "any"]),
  not: z.boolean(),
  children: z.array(z.union([ruleConditionSchema, ruleGroupSchema])),
}))

export const ruleTreeSchema = z.object({
  format: z.literal(RULE_TREE_FORMAT),
  version: z.literal(1),
  root: ruleGroupSchema,
})

export const ruleEffectSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.string(), ruleValueSchema).default({}),
})

export const rulePolicySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  priority: z.number().int(),
  when: ruleTreeSchema,
  effects: z.array(ruleEffectSchema),
})

export type RuleTree = z.infer<typeof ruleTreeSchema>
export type RuleEffect = z.infer<typeof ruleEffectSchema>
export interface RulePolicy<Effect extends RuleEffect = RuleEffect> {
  id: string
  name: string
  enabled: boolean
  priority: number
  when: RuleTree
  effects: readonly Effect[]
}

export interface RulePolicyMatch<Effect extends RuleEffect = RuleEffect> {
  policyId: string
  effects: readonly Effect[]
}

export function createRuleTree(children: readonly RuleNode[] = []): RuleTree {
  return {
    format: RULE_TREE_FORMAT,
    version: 1,
    root: { id: createRuleId("group"), kind: "group", combinator: "all", not: false, children: [...children] },
  }
}

export async function evaluateRuleTree(tree: RuleTree, facts: Readonly<Record<string, unknown>>): Promise<boolean> {
  const parsed = ruleTreeSchema.parse(tree)
  const engine = createRuleEngine()
  engine.addRule({
    name: "xiranite-rule-tree",
    conditions: ruleGroupToEngineCondition(parsed.root),
    event: { type: "xiranite-rule-tree:matched" },
  })
  const result = await engine.run({ ...facts })
  return result.events.some((event) => event.type === "xiranite-rule-tree:matched")
}

export async function evaluateRulePolicies<Effect extends RuleEffect>(
  policies: readonly RulePolicy<Effect>[],
  facts: Readonly<Record<string, unknown>>,
): Promise<readonly RulePolicyMatch<Effect>[]> {
  const enabled = policies
    .filter((policy) => policy.enabled)
    .slice()
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
  const matches: RulePolicyMatch<Effect>[] = []
  for (const policy of enabled) {
    if (await evaluateRuleTree(policy.when, facts)) matches.push({ policyId: policy.id, effects: policy.effects })
  }
  return matches
}

export function ruleTreeToEngineCondition(tree: RuleTree): TopLevelCondition {
  return ruleGroupToEngineCondition(ruleTreeSchema.parse(tree).root)
}

function ruleGroupToEngineCondition(group: RuleGroup): TopLevelCondition {
  const nested = group.children.map((child) => child.kind === "group"
    ? ruleGroupToEngineCondition(child)
    : ({ fact: child.field, operator: child.operator, value: child.value ?? null }))
  const condition = group.combinator === "all" ? { all: nested } : { any: nested }
  return group.not ? { not: condition } : condition
}

function createRuleEngine(): Engine {
  const engine = new Engine([], { allowUndefinedFacts: true })
  engine.addOperator("contains", (fact, expected) => (typeof fact === "string" || Array.isArray(fact)) && fact.includes(expected as never))
  engine.addOperator("doesNotContain", (fact, expected) => (typeof fact === "string" || Array.isArray(fact)) && !fact.includes(expected as never))
  engine.addOperator("in", (fact, expected) => Array.isArray(expected) && expected.includes(fact as never))
  engine.addOperator("notIn", (fact, expected) => Array.isArray(expected) && !expected.includes(fact as never))
  engine.addOperator("startsWith", (fact, expected) => typeof fact === "string" && typeof expected === "string" && fact.startsWith(expected))
  engine.addOperator("endsWith", (fact, expected) => typeof fact === "string" && typeof expected === "string" && fact.endsWith(expected))
  engine.addOperator("isEmpty", (fact) => fact === undefined || fact === null || fact === "" || (Array.isArray(fact) && fact.length === 0))
  engine.addOperator("isNotEmpty", (fact) => !(fact === undefined || fact === null || fact === "" || (Array.isArray(fact) && fact.length === 0)))
  return engine
}

let ruleIdSequence = 0

export function createRuleId(prefix = "rule"): string {
  ruleIdSequence += 1
  return `${prefix}-${Date.now().toString(36)}-${ruleIdSequence.toString(36)}`
}
