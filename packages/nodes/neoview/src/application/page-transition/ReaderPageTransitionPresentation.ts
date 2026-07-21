import {
  READER_PAGE_TRANSITION_EASING_LABELS,
  READER_PAGE_TRANSITION_EASINGS,
  READER_PAGE_TRANSITION_TYPE_LABELS,
  READER_PAGE_TRANSITION_TYPES,
  type ReaderPageTransitionSettings,
} from "../../domain/page-transition/ReaderPageTransition.js"

export const READER_PAGE_TRANSITION_DURATION_RANGE = { min: 0, max: 500, step: 10 } as const

export function readerPageTransitionSurfaceOptions(): {
  types: readonly { value: (typeof READER_PAGE_TRANSITION_TYPES)[number]; label: string }[]
  easings: readonly { value: (typeof READER_PAGE_TRANSITION_EASINGS)[number]; label: string }[]
  duration: typeof READER_PAGE_TRANSITION_DURATION_RANGE
} {
  return {
    types: READER_PAGE_TRANSITION_TYPES.map((value) => ({ value, label: READER_PAGE_TRANSITION_TYPE_LABELS[value] })),
    easings: READER_PAGE_TRANSITION_EASINGS.map((value) => ({ value, label: READER_PAGE_TRANSITION_EASING_LABELS[value] })),
    duration: READER_PAGE_TRANSITION_DURATION_RANGE,
  }
}

export function formatReaderPageTransition(settings: ReaderPageTransitionSettings): string {
  return `enabled=${String(settings.enabled)} type=${settings.type} duration=${settings.duration}ms easing=${settings.easing}`
}
