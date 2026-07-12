export const CHOICE_CONTROL_STYLES = ["segmented", "pills", "tabs", "tiles"] as const

export type ChoiceControlStyle = (typeof CHOICE_CONTROL_STYLES)[number]

export const CHOICE_CONTROL_LABEL_STYLES = ["stacked", "legend", "inline", "hidden"] as const

export type ChoiceControlLabelStyle = (typeof CHOICE_CONTROL_LABEL_STYLES)[number]
