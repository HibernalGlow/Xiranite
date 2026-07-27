/**
 * Legacy NeoView defaults captured by the migration snapshot. The interaction
 * adapter owns DOM listeners; this module keeps the shared configuration
 * contract framework-independent.
 */
export interface ReaderMouseCursorSettings {
  autoHide: boolean
  hideDelay: number
  showMovementThreshold: number
  showOnButtonClick: boolean
  showOnKeyDown: boolean
  showOnWheel: boolean
}

export const DEFAULT_READER_MOUSE_CURSOR_SETTINGS: ReaderMouseCursorSettings = {
  autoHide: true,
  hideDelay: 0.8,
  showMovementThreshold: 26,
  showOnButtonClick: false,
  showOnKeyDown: false,
  showOnWheel: false,
}
