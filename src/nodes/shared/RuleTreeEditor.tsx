import * as DndKit from "@dnd-kit/core"
import { QueryBuilderDnD } from "@react-querybuilder/dnd"
import { createDndKitAdapter } from "@react-querybuilder/dnd/dnd-kit"
import {
  QueryBuilder,
  type Field,
  type Operator,
  type RuleGroupType,
  type RuleType,
} from "react-querybuilder"
import {
  RULE_TREE_FORMAT,
  createRuleId,
  ruleOperatorSchema,
  type RuleCondition,
  type RuleGroup,
  type RuleOperator,
  type RuleTree,
  type RuleValue,
} from "@xiranite/shared/rules"

export type RuleTreeFieldType = "text" | "number" | "boolean" | "select" | "multiselect"

export interface RuleTreeField {
  name: string
  label: string
  type: RuleTreeFieldType
  operators?: readonly RuleOperator[]
  options?: readonly { name: string; label: string }[]
}

export interface RuleTreeEditorProps {
  value: RuleTree
  fields: readonly RuleTreeField[]
  disabled?: boolean
  className?: string
  t?(key: string, fallback: string): string
  onValueChange(value: RuleTree): void
}

const dndAdapter = createDndKitAdapter(DndKit)
const actionClass = "h-8 border bg-background px-2 text-xs text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
const selectorClass = "h-8 min-w-28 border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
const inputClass = "h-8 min-w-32 flex-1 border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"

const RULE_EDITOR_CLASSES = {
  queryBuilder: "min-w-0 space-y-2",
  ruleGroup: "min-w-0 space-y-2 border bg-muted/20 p-2",
  header: "flex min-w-0 flex-wrap items-center gap-1.5",
  body: "min-w-0 space-y-1.5 border-l border-border/70 pl-2",
  combinators: selectorClass,
  addRule: actionClass,
  addGroup: actionClass,
  cloneRule: actionClass,
  cloneGroup: actionClass,
  removeGroup: actionClass,
  notToggle: "inline-flex h-8 items-center gap-1.5 border bg-background px-2 text-xs text-foreground",
  rule: "flex min-w-0 flex-wrap items-center gap-1.5 border bg-background/70 p-1.5",
  fields: selectorClass,
  operators: selectorClass,
  value: inputClass,
  removeRule: actionClass,
  dragHandle: "grid size-8 shrink-0 cursor-grab place-items-center border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground active:cursor-grabbing",
  disabled: "opacity-60",
  dndDragging: "opacity-40",
  dndOver: "ring-2 ring-primary/60",
  dndCopy: "ring-chart-2",
  dndGroup: "ring-accent-foreground/50",
  dndDropNotAllowed: "cursor-not-allowed ring-destructive/60",
} as const

const OPERATOR_LABELS: Record<RuleOperator, string> = {
  equal: "is",
  notEqual: "is not",
  contains: "contains",
  doesNotContain: "does not contain",
  startsWith: "starts with",
  endsWith: "ends with",
  in: "is one of",
  notIn: "is not one of",
  lessThan: "is less than",
  lessThanInclusive: "is at most",
  greaterThan: "is greater than",
  greaterThanInclusive: "is at least",
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
}

const DEFAULT_OPERATORS: Record<RuleTreeFieldType, readonly RuleOperator[]> = {
  text: ["equal", "notEqual", "contains", "doesNotContain", "startsWith", "endsWith", "isEmpty", "isNotEmpty"],
  number: ["equal", "notEqual", "lessThan", "lessThanInclusive", "greaterThan", "greaterThanInclusive", "isEmpty", "isNotEmpty"],
  boolean: ["equal", "notEqual"],
  select: ["equal", "notEqual", "in", "notIn", "isEmpty", "isNotEmpty"],
  multiselect: ["contains", "doesNotContain", "isEmpty", "isNotEmpty"],
}

export function RuleTreeEditor(props: RuleTreeEditorProps) {
  const translate = props.t ?? ((_key: string, fallback: string) => fallback)
  const fields = props.fields.map(queryBuilderField)
  const query = ruleTreeToQueryBuilder(props.value)
  return <div className={props.className} data-testid="rule-tree-editor" data-theme-surface="semantic">
    <QueryBuilderDnD dnd={dndAdapter}>
      <QueryBuilder
        query={query}
        fields={fields}
        disabled={props.disabled}
        idGenerator={() => createRuleId("condition")}
        showNotToggle
        showCloneButtons
        resetOnFieldChange
        listsAsArrays
        parseNumbers
        controlClassnames={RULE_EDITOR_CLASSES}
        translations={{
          addRule: { label: translate("rules.addCondition", "+ Condition"), title: translate("rules.addConditionTitle", "Add condition") },
          addGroup: { label: translate("rules.addGroup", "+ Group"), title: translate("rules.addGroupTitle", "Add condition group") },
          removeRule: { label: "×", title: translate("rules.removeCondition", "Remove condition") },
          removeGroup: { label: "×", title: translate("rules.removeGroup", "Remove condition group") },
          cloneRule: { label: "⧉", title: translate("rules.cloneCondition", "Clone condition") },
          cloneRuleGroup: { label: "⧉", title: translate("rules.cloneGroup", "Clone condition group") },
          dragHandle: { label: "⁞⁞", title: translate("rules.drag", "Drag to reorder") },
          notToggle: { label: translate("rules.not", "Not"), title: translate("rules.notTitle", "Invert this group") },
        }}
        combinators={[
          { name: "and", label: translate("rules.all", "All") },
          { name: "or", label: translate("rules.any", "Any") },
        ]}
        onQueryChange={(next) => props.onValueChange(queryBuilderToRuleTree(next, props.fields))}
      />
    </QueryBuilderDnD>
  </div>
}

export function ruleTreeToQueryBuilder(tree: RuleTree): RuleGroupType {
  return groupToQueryBuilder(tree.root)
}

export function queryBuilderToRuleTree(query: RuleGroupType, fields: readonly RuleTreeField[]): RuleTree {
  return {
    format: RULE_TREE_FORMAT,
    version: 1,
    root: queryBuilderToGroup(query, fields),
  }
}

function groupToQueryBuilder(group: RuleGroup): RuleGroupType {
  return {
    id: group.id,
    combinator: group.combinator === "any" ? "or" : "and",
    not: group.not,
    rules: group.children.map((child) => child.kind === "group" ? groupToQueryBuilder(child) : conditionToQueryBuilder(child)),
  }
}

function conditionToQueryBuilder(condition: RuleCondition): RuleType {
  return { id: condition.id, field: condition.field, operator: condition.operator, value: condition.value ?? "" }
}

function queryBuilderToGroup(group: RuleGroupType, fields: readonly RuleTreeField[]): RuleGroup {
  return {
    id: typeof group.id === "string" && group.id ? group.id : createRuleId("group"),
    kind: "group",
    combinator: group.combinator === "or" ? "any" : "all",
    not: group.not === true,
    children: group.rules.map((child) => isQueryGroup(child)
      ? queryBuilderToGroup(child, fields)
      : queryBuilderToCondition(child, fields)),
  }
}

function queryBuilderToCondition(rule: RuleType, fields: readonly RuleTreeField[]): RuleCondition {
  const field = fields.find((item) => item.name === rule.field) ?? fields[0]
  const fieldName = field?.name ?? String(rule.field || "unknown")
  const operatorResult = ruleOperatorSchema.safeParse(rule.operator)
  const operator = operatorResult.success ? operatorResult.data : field?.operators?.[0] ?? DEFAULT_OPERATORS[field?.type ?? "text"][0]
  return {
    id: typeof rule.id === "string" && rule.id ? rule.id : createRuleId("condition"),
    kind: "condition",
    field: fieldName,
    operator,
    ...(operator === "isEmpty" || operator === "isNotEmpty" ? {} : { value: normalizeQueryValue(rule.value, field?.type ?? "text") }),
  }
}

function isQueryGroup(value: RuleType | RuleGroupType): value is RuleGroupType {
  return Array.isArray((value as RuleGroupType).rules)
}

function queryBuilderField(field: RuleTreeField): Field {
  const operators = (field.operators ?? DEFAULT_OPERATORS[field.type]).map(queryBuilderOperator)
  const common = { name: field.name, label: field.label, operators, defaultOperator: operators[0]?.name }
  if (field.type === "number") return { ...common, inputType: "number" }
  if (field.type === "boolean") return { ...common, valueEditorType: "select", values: [{ name: "true", label: "True" }, { name: "false", label: "False" }] }
  if (field.type === "select") return { ...common, valueEditorType: (operator) => operator === "in" || operator === "notIn" ? "multiselect" : "select", values: field.options ?? [] }
  if (field.type === "multiselect") return { ...common, valueEditorType: "multiselect", values: field.options ?? [] }
  return common
}

function queryBuilderOperator(operator: RuleOperator): Operator {
  return { name: operator, label: OPERATOR_LABELS[operator], ...(operator === "isEmpty" || operator === "isNotEmpty" ? { arity: "unary" as const } : {}) }
}

function normalizeQueryValue(value: unknown, type: RuleTreeFieldType): RuleValue {
  if (type === "number") {
    const number = Number(value)
    return Number.isFinite(number) ? number : 0
  }
  if (type === "boolean") return value === true || value === "true"
  if (type === "multiselect") return Array.isArray(value) ? value.map(String) : String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean)
  if (Array.isArray(value)) return value.map((item) => typeof item === "number" || typeof item === "boolean" || item === null ? item : String(item))
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  return String(value ?? "")
}
