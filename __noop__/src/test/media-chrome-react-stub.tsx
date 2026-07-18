import { createElement, type HTMLAttributes, type PropsWithChildren } from "react"

type ElementProps = PropsWithChildren<HTMLAttributes<HTMLElement>>
type ButtonProps = ElementProps & { noTooltip?: boolean; seekOffset?: number; rates?: string }

export function MediaController({ children, ...props }: ElementProps) {
  return createElement("media-controller", props, children)
}

export function MediaControlBar({ children, ...props }: ElementProps) {
  return createElement("media-control-bar", props, children)
}

function MediaButton({ children, noTooltip: _noTooltip, seekOffset: _seekOffset, rates: _rates, ...props }: ButtonProps) {
  return <button type="button" {...props}>{children}</button>
}

export const MediaPlayButton = MediaButton
export const MediaSeekBackwardButton = MediaButton
export const MediaSeekForwardButton = MediaButton
export const MediaMuteButton = MediaButton
export const MediaPlaybackRateButton = MediaButton
export const MediaPipButton = MediaButton
export const MediaFullscreenButton = MediaButton

export function MediaTimeDisplay(props: ElementProps & { noToggle?: boolean }) {
  const { noToggle: _noToggle, ...elementProps } = props
  return <span {...elementProps}>0:00</span>
}

export function MediaDurationDisplay(props: ElementProps) {
  return <span {...props}>0:00</span>
}

export function MediaTimeRange(props: ElementProps) {
  return <span role="slider" aria-label="视频进度" {...props} />
}

export function MediaVolumeRange(props: ElementProps) {
  return <span role="slider" aria-label="视频音量" {...props} />
}
