import {
  MAX_READER_INPUT_ACTION_SEQUENCE_LENGTH,
  READER_INPUT_ACTION_CATEGORIES,
  READER_INPUT_ACTION_CATEGORY_LABELS,
  READER_INPUT_ACTION_LABELS,
  READER_INPUT_ACTION_METADATA,
  type ReaderInputAction,
} from "@xiranite/node-neoview/ui-core"
import { ArrowDown, ArrowUp, ListOrdered, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { GUI_READER_INPUT_ACTIONS } from "../../input/ReaderInputActionCapabilities"

export function BindingActionSequenceEditor({
  actions = [],
  disabled,
  onChange,
}: {
  actions?: readonly ReaderInputAction[]
  disabled: boolean
  onChange(actions: ReaderInputAction[] | undefined): void
}) {
  const maximumFollowUps = MAX_READER_INPUT_ACTION_SEQUENCE_LENGTH - 1
  const replace = (index: number, action: ReaderInputAction) => onChange(actions.map((current, currentIndex) => currentIndex === index ? action : current))
  const remove = (index: number) => {
    const next = actions.filter((_, currentIndex) => currentIndex !== index)
    onChange(next.length ? next : undefined)
  }
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= actions.length) return
    const next = [...actions]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    onChange(next)
  }

  return (
    <section className="grid gap-2 rounded-md border border-border/70 bg-background/60 p-2.5" aria-label="后续动作">
      <div className="flex items-center gap-2">
        <ListOrdered className="size-3.5 text-muted-foreground" />
        <h4 className="mr-auto text-xs font-medium">后续动作</h4>
        <span className="text-[11px] text-muted-foreground">{actions.length}/{maximumFollowUps}</span>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={disabled || actions.length >= maximumFollowUps}
          onClick={() => onChange([...actions, "reader.next-page"])}
        >
          <Plus />添加
        </Button>
      </div>
      {actions.map((action, index) => (
        <div key={`${index}-${action}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-1.5">
          <span className="text-center text-[11px] tabular-nums text-muted-foreground">{index + 2}</span>
          <select
            className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs"
            value={action}
            disabled={disabled}
            onChange={(event) => replace(index, event.currentTarget.value as ReaderInputAction)}
            aria-label={`后续动作 ${index + 1}`}
          >
            {READER_INPUT_ACTION_CATEGORIES.map((category) => {
              const options = GUI_READER_INPUT_ACTIONS.filter((candidate) => READER_INPUT_ACTION_METADATA[candidate].category === category)
              return options.length ? <optgroup key={category} label={READER_INPUT_ACTION_CATEGORY_LABELS[category]}>
                {options.map((candidate) => <option key={candidate} value={candidate}>{READER_INPUT_ACTION_LABELS[candidate]}</option>)}
              </optgroup> : null
            })}
          </select>
          <div className="flex items-center gap-0.5">
            <Button type="button" size="icon-xs" variant="ghost" disabled={disabled || index === 0} onClick={() => move(index, -1)} title="上移" aria-label={`上移后续动作 ${index + 1}`}><ArrowUp /></Button>
            <Button type="button" size="icon-xs" variant="ghost" disabled={disabled || index === actions.length - 1} onClick={() => move(index, 1)} title="下移" aria-label={`下移后续动作 ${index + 1}`}><ArrowDown /></Button>
            <Button type="button" size="icon-xs" variant="ghost" className="text-destructive" disabled={disabled} onClick={() => remove(index)} title="删除" aria-label={`删除后续动作 ${index + 1}`}><Trash2 /></Button>
          </div>
        </div>
      ))}
    </section>
  )
}
