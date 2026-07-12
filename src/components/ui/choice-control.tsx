import type { ComponentProps, ReactNode } from "react"

import type { ChoiceControlLabelStyle } from "@/components/ui/choice-control-variants"
import { FieldLegend, FieldSet } from "@/components/ui/field"
import { cn } from "@/lib/utils"

type ChoiceControlFieldProps = Omit<ComponentProps<typeof FieldSet>, "children"> & {
  children: ReactNode
  label: string
  labelStyle?: ChoiceControlLabelStyle
  contentClassName?: string
}

function ChoiceControlField({ children, className, contentClassName, label, labelStyle, ...props }: ChoiceControlFieldProps) {
  return (
    <FieldSet
      data-choice-control-label-style={labelStyle}
      data-slot="choice-control-field"
      className={cn(
        "min-w-0 gap-1.5",
        "[[data-choice-control-label-style=stacked]_&]:border-0 [[data-choice-control-label-style=stacked]_&]:p-0",
        "[[data-choice-control-label-style=legend]_&]:rounded-lg [[data-choice-control-label-style=legend]_&]:border [[data-choice-control-label-style=legend]_&]:px-2 [[data-choice-control-label-style=legend]_&]:pb-2 [[data-choice-control-label-style=legend]_&]:pt-0",
        "[[data-choice-control-label-style=inline]_&]:grid [[data-choice-control-label-style=inline]_&]:grid-cols-[auto_minmax(0,1fr)] [[data-choice-control-label-style=inline]_&]:items-center [[data-choice-control-label-style=inline]_&]:gap-2 [[data-choice-control-label-style=inline]_&]:border-0 [[data-choice-control-label-style=inline]_&]:p-0",
        "[[data-choice-control-label-style=hidden]_&]:border-0 [[data-choice-control-label-style=hidden]_&]:p-0",
        labelStyle === "stacked" && "border-0 p-0",
        labelStyle === "legend" && "rounded-lg border px-2 pb-2 pt-0",
        labelStyle === "inline" && "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border-0 p-0",
        labelStyle === "hidden" && "border-0 p-0",
        className,
      )}
      {...props}
    >
      <FieldLegend
        variant="label"
        className={cn(
          "w-fit text-[10px] text-muted-foreground",
          "[[data-choice-control-label-style=stacked]_&]:mb-0 [[data-choice-control-label-style=stacked]_&]:px-0",
          "[[data-choice-control-label-style=legend]_&]:mb-0 [[data-choice-control-label-style=legend]_&]:ml-1 [[data-choice-control-label-style=legend]_&]:px-1",
          "[[data-choice-control-label-style=inline]_&]:mb-0 [[data-choice-control-label-style=inline]_&]:px-0",
          "[[data-choice-control-label-style=hidden]_&]:sr-only",
          labelStyle === "stacked" && "mb-0 px-0",
          labelStyle === "legend" && "mb-0 ml-1 px-1",
          labelStyle === "inline" && "mb-0 px-0",
          labelStyle === "hidden" && "sr-only",
        )}
      >
        {label}
      </FieldLegend>
      <div className={cn("min-w-0", contentClassName)}>{children}</div>
    </FieldSet>
  )
}

export { ChoiceControlField }
