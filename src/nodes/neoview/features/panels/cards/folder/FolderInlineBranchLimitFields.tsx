import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import type { ReaderFolderPenetrationConfig } from "../../../../adapters/reader-http-client"

export function FolderInlineBranchLimitFields({
  busy,
  penetration,
  onUpdate,
}: {
  busy: boolean
  penetration: ReaderFolderPenetrationConfig
  onUpdate(patch: Partial<ReaderFolderPenetrationConfig>): void
}) {
  const disabled = busy || !penetration.enabled || !penetration.expandBranchesInline
  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label">就地展开上限</FieldLegend>
      <div className="grid grid-cols-3 gap-2">
        <Field>
          <FieldLabel htmlFor="folder-inline-branch-max-directories">直属子文件夹</FieldLabel>
          <InlineBranchLimitInput
            id="folder-inline-branch-max-directories"
            label="直属子文件夹上限"
            value={penetration.inlineBranchMaxDirectories}
            disabled={disabled}
            onChange={(inlineBranchMaxDirectories) => onUpdate({ inlineBranchMaxDirectories })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="folder-inline-branch-max-files">直属文件</FieldLabel>
          <InlineBranchLimitInput
            id="folder-inline-branch-max-files"
            label="直属文件上限"
            value={penetration.inlineBranchMaxFiles}
            disabled={disabled}
            onChange={(inlineBranchMaxFiles) => onUpdate({ inlineBranchMaxFiles })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="folder-inline-branch-max-items">直属条目合计</FieldLabel>
          <InlineBranchLimitInput
            id="folder-inline-branch-max-items"
            label="直属条目合计上限"
            value={penetration.inlineBranchMaxItems}
            disabled={disabled}
            onChange={(inlineBranchMaxItems) => onUpdate({ inlineBranchMaxItems })}
          />
        </Field>
      </div>
    </FieldSet>
  )
}

function InlineBranchLimitInput({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: number
  disabled: boolean
  onChange(value: number): void
}) {
  return (
    <Input
      id={id}
      type="number"
      min={0}
      max={100}
      step={1}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        const next = event.currentTarget.valueAsNumber
        if (Number.isInteger(next) && next >= 0 && next <= 100) onChange(next)
      }}
    />
  )
}
