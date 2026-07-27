import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

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
  const toggleDisabled = busy || !penetration.enabled || !penetration.expandBranchesInline
  return (
    <FieldSet className="gap-2">
      <FieldLegend variant="label">就地展开上限</FieldLegend>
      <Field orientation="horizontal">
        <FieldLabel htmlFor="folder-inline-branch-limits-enabled">启用就地展开上限</FieldLabel>
        <Switch
          id="folder-inline-branch-limits-enabled"
          aria-label="启用就地展开上限"
          checked={penetration.inlineBranchLimitsEnabled}
          disabled={toggleDisabled}
          onCheckedChange={(inlineBranchLimitsEnabled) => onUpdate({ inlineBranchLimitsEnabled })}
        />
      </Field>
      <FolderInlineBranchLimitInputs
        idPrefix="folder-inline-branch"
        penetration={penetration}
        disabled={toggleDisabled || !penetration.inlineBranchLimitsEnabled}
        onUpdate={onUpdate}
      />
    </FieldSet>
  )
}

export function FolderInlineBranchLimitInputs({
  idPrefix,
  penetration,
  disabled,
  onUpdate,
}: {
  idPrefix: string
  penetration: ReaderFolderPenetrationConfig
  disabled: boolean
  onUpdate(patch: Partial<ReaderFolderPenetrationConfig>): void
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-max-directories`}>直属子文件夹</FieldLabel>
        <InlineBranchLimitInput
          id={`${idPrefix}-max-directories`}
          label="直属子文件夹上限"
          value={penetration.inlineBranchMaxDirectories}
          disabled={disabled}
          onChange={(inlineBranchMaxDirectories) => onUpdate({ inlineBranchMaxDirectories })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-max-files`}>直属文件</FieldLabel>
        <InlineBranchLimitInput
          id={`${idPrefix}-max-files`}
          label="直属文件上限"
          value={penetration.inlineBranchMaxFiles}
          disabled={disabled}
          onChange={(inlineBranchMaxFiles) => onUpdate({ inlineBranchMaxFiles })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-max-items`}>直属条目合计</FieldLabel>
        <InlineBranchLimitInput
          id={`${idPrefix}-max-items`}
          label="直属条目合计上限"
          value={penetration.inlineBranchMaxItems}
          disabled={disabled}
          onChange={(inlineBranchMaxItems) => onUpdate({ inlineBranchMaxItems })}
        />
      </Field>
    </div>
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
