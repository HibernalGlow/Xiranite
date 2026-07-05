export type LayoutMode = "free" | "grid" | "stack" | "focus" | "split";

export type PanelState = "docked" | "floating" | "compact" | "focused" | "fullscreen";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Panel {
  id: string;
  kind: string;
  title: string;
  collapsed: boolean;
  /** free-layout position/size, in px relative to canvas */
  free: Rect;
  z: number;
}

export interface WorkspaceState {
  panels: Panel[];
  mode: LayoutMode;
  focusedId: string | null;
  fullscreenId: string | null;
  zCounter: number;
}

export interface ComputedLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  opacity: number;
  z: number;
  state: PanelState;
  interactive: boolean;
}
