export const INK_FULLSCREEN_ENTER = "\u001b[?1049h\u001b[2J\u001b[H\u001b[?25l"
export const INK_FULLSCREEN_EXIT = "\u001b[?1006l\u001b[?1003l\u001b[?1002l\u001b[?1000l\u001b[?25h\u001b[?1049l"

export function enterInkFullscreen(output: { write: (chunk: string) => unknown }): void {
  output.write(INK_FULLSCREEN_ENTER)
}

export function leaveInkFullscreen(output: { write: (chunk: string) => unknown }): void {
  output.write(INK_FULLSCREEN_EXIT)
}
