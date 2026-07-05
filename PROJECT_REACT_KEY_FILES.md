# Spatial Canvas React Key Files

Generated: 2026-07-05 02:37:38
Scope: React 关键架构文件（不含具体组件实现）
Total files: 17

## File List

- index.html
- vite.config.ts
- package.json
- tsconfig.json
- src/main.tsx
- src/router.tsx
- src/routes/__root.tsx
- src/routes/index.tsx
- src/workspace/store.tsx
- src/workspace/layout.ts
- src/workspace/Workspace.tsx
- src/workspace/Panel.tsx
- src/workspace/CommandPalette.tsx
- src/workspace/TabBar.tsx
- src/workspace/theme.tsx
- src/workspace/ThemeMenu.tsx
- src/workspace/registry.tsx

## Files

### index.html

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GRIDLOCK - Spatial Component Workspace</title>
    <meta
      name="description"
      content="A spatial component workbench with free, grid, stack, focus and split layouts."
    />
    <link rel="icon" href="/favicon.ico" type="image/x-icon" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
    />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### vite.config.ts

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      target: "react",
      autoCodeSplitting: true,
    }),
    tsconfigPaths(),
    react(),
    tailwindcss(),
  ],
});
```

### package.json

```json
{
  "name": "tanstack_start_ts",
  "private": true,
  "sideEffects": false,
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "build:dev": "vite build --mode development",
    "preview": "vite preview",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "dependencies": {
    "@hookform/resolvers": "^5.2.2",
    "@radix-ui/react-accordion": "^1.2.12",
    "@radix-ui/react-alert-dialog": "^1.1.15",
    "@radix-ui/react-aspect-ratio": "^1.1.8",
    "@radix-ui/react-avatar": "^1.1.11",
    "@radix-ui/react-checkbox": "^1.3.3",
    "@radix-ui/react-collapsible": "^1.1.12",
    "@radix-ui/react-context-menu": "^2.2.16",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-hover-card": "^1.1.15",
    "@radix-ui/react-label": "^2.1.8",
    "@radix-ui/react-menubar": "^1.1.16",
    "@radix-ui/react-navigation-menu": "^1.2.14",
    "@radix-ui/react-popover": "^1.1.15",
    "@radix-ui/react-progress": "^1.1.8",
    "@radix-ui/react-radio-group": "^1.3.8",
    "@radix-ui/react-scroll-area": "^1.2.10",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-separator": "^1.1.8",
    "@radix-ui/react-slider": "^1.3.6",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-switch": "^1.2.6",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-toggle": "^1.1.10",
    "@radix-ui/react-toggle-group": "^1.1.11",
    "@radix-ui/react-tooltip": "^1.2.8",
    "@tailwindcss/vite": "^4.2.1",
    "@tanstack/react-query": "^5.101.1",
    "@tanstack/react-router": "^1.170.16",
    "@tanstack/react-start": "^1.168.26",
    "@tanstack/router-plugin": "^1.168.18",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "cmdk": "^1.1.1",
    "date-fns": "^4.1.0",
    "embla-carousel-react": "^8.6.0",
    "input-otp": "^1.4.2",
    "lucide-react": "^0.575.0",
    "motion": "^12.42.2",
    "react": "^19.2.0",
    "react-day-picker": "^9.14.0",
    "react-dom": "^19.2.0",
    "react-hook-form": "^7.71.2",
    "react-resizable-panels": "^4.6.5",
    "recharts": "^2.15.4",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.5.0",
    "tailwindcss": "^4.2.1",
    "tw-animate-css": "^1.3.4",
    "vaul": "^1.1.2",
    "vite-tsconfig-paths": "^6.0.2",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@eslint/js": "^9.32.0",
    "@lovable.dev/vite-tanstack-config": "2.7.0",
    "@types/node": "^22.16.5",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^5.2.0",
    "eslint": "^9.32.0",
    "eslint-config-prettier": "^10.1.1",
    "eslint-plugin-prettier": "^5.2.6",
    "eslint-plugin-react-hooks": "^5.2.0",
    "eslint-plugin-react-refresh": "^0.4.20",
    "globals": "^15.15.0",
    "nitro": "3.0.260603-beta",
    "prettier": "^3.7.3",
    "typescript": "^5.8.3",
    "typescript-eslint": "^8.56.1",
    "vite": "^8.0.16"
  }
}
```

### tsconfig.json

```json
{
  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts", "eslint.config.js"],
  "compilerOptions": {
    "target": "ES2022",
    "jsx": "react-jsx",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],

    /* Bundler mode */
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": false,
    "noEmit": true,

    /* Linting */
    "skipLibCheck": true,
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### src/main.tsx

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "./router";
import "./styles.css";

const router = getRouter();
const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element #app not found");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
```

### src/router.tsx

```tsx
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
```

### src/routes/__root.tsx

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
```

### src/routes/index.tsx

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceProvider } from "../workspace/store";
import { ThemeProvider } from "../workspace/theme";
import { Workspace } from "../workspace/Workspace";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <ThemeProvider>
      <WorkspaceProvider
        seed={[
          { kind: "kanban", title: "KANBAN BOARD" },
          { kind: "terminal", title: "TERMINAL" },
          { kind: "mixer", title: "ACID MIXER" },
          { kind: "clock", title: "CLOCK" },
          { kind: "counter", title: "COUNTER" },
          { kind: "calc", title: "CALCULATOR" },
          { kind: "tasks", title: "TASKS" },
          { kind: "notes", title: "SCRATCH" },
        ]}
      >
        <Workspace />
      </WorkspaceProvider>
    </ThemeProvider>
  );
}
```

### src/workspace/store.tsx

```tsx
import { createContext, useContext, useReducer, type ReactNode } from "react";
import type { LayoutMode, Panel, Rect } from "./types";

export interface Tab {
  id: string;
  name: string;
  panels: Panel[];
  mode: LayoutMode;
  focusedId: string | null;
  fullscreenId: string | null;
  zCounter: number;
}

interface AppState {
  tabs: Tab[];
  activeTabId: string;
}

type Action =
  | { type: "ADD"; kind: string; title: string }
  | { type: "REMOVE"; id: string }
  | { type: "SET_MODE"; mode: LayoutMode }
  | { type: "TOGGLE_COLLAPSE"; id: string }
  | { type: "FOCUS"; id: string | null }
  | { type: "FULLSCREEN"; id: string | null }
  | { type: "RAISE"; id: string }
  | { type: "MOVE"; id: string; rect: Partial<Rect> }
  | { type: "ADD_TAB" }
  | { type: "CLOSE_TAB"; id: string }
  | { type: "RENAME_TAB"; id: string; name: string }
  | { type: "SET_TAB"; id: string }
  | { type: "ENTER_FREE"; rects: Record<string, Rect> };

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function scatter(index: number): Rect {
  const cols = 3;
  const c = index % cols;
  const r = Math.floor(index / cols);
  return { x: 40 + c * 360, y: 40 + r * 300, w: 340, h: 260 };
}

function emptyTab(name: string): Tab {
  return {
    id: nextId("tab"),
    name,
    panels: [],
    mode: "grid",
    focusedId: null,
    fullscreenId: null,
    zCounter: 0,
  };
}

function mapActive(state: AppState, fn: (t: Tab) => Tab): AppState {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === state.activeTabId ? fn(t) : t)),
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "ADD":
      return mapActive(state, (t) => {
        const z = t.zCounter + 1;
        const panel: Panel = {
          id: nextId("panel"),
          kind: action.kind,
          title: action.title,
          collapsed: false,
          free: scatter(t.panels.length),
          z,
        };
        return { ...t, panels: [...t.panels, panel], zCounter: z };
      });
    case "REMOVE":
      return mapActive(state, (t) => ({
        ...t,
        panels: t.panels.filter((p) => p.id !== action.id),
        focusedId: t.focusedId === action.id ? null : t.focusedId,
        fullscreenId: t.fullscreenId === action.id ? null : t.fullscreenId,
      }));
    case "SET_MODE":
      return mapActive(state, (t) => ({ ...t, mode: action.mode, fullscreenId: null }));
    case "TOGGLE_COLLAPSE":
      return mapActive(state, (t) => ({
        ...t,
        panels: t.panels.map((p) => (p.id === action.id ? { ...p, collapsed: !p.collapsed } : p)),
      }));
    case "FOCUS":
      return mapActive(state, (t) => ({ ...t, focusedId: action.id }));
    case "FULLSCREEN":
      return mapActive(state, (t) => ({ ...t, fullscreenId: action.id }));
    case "RAISE":
      return mapActive(state, (t) => {
        const z = t.zCounter + 1;
        return { ...t, zCounter: z, panels: t.panels.map((p) => (p.id === action.id ? { ...p, z } : p)) };
      });
    case "MOVE":
      return mapActive(state, (t) => ({
        ...t,
        panels: t.panels.map((p) => (p.id === action.id ? { ...p, free: { ...p.free, ...action.rect } } : p)),
      }));
    case "ADD_TAB": {
      const tab = emptyTab(`SPACE ${state.tabs.length + 1}`);
      return { ...state, tabs: [...state.tabs, tab], activeTabId: tab.id };
    }
    case "CLOSE_TAB": {
      if (state.tabs.length <= 1) return state;
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      const activeTabId =
        state.activeTabId === action.id ? tabs[Math.max(0, idx - 1)].id : state.activeTabId;
      return { tabs, activeTabId };
    }
    case "RENAME_TAB":
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.id === action.id ? { ...t, name: action.name || t.name } : t)),
      };
    case "SET_TAB":
      return { ...state, activeTabId: action.id };
    case "ENTER_FREE":
      return mapActive(state, (t) => ({
        ...t,
        mode: "free",
        fullscreenId: null,
        panels: t.panels.map((p) =>
          action.rects[p.id] ? { ...p, free: action.rects[p.id] } : p,
        ),
      }));
    default:
      return state;
  }
}

interface WorkspaceApi {
  // active-tab flattened state
  panels: Panel[];
  mode: LayoutMode;
  focusedId: string | null;
  fullscreenId: string | null;
  // tabs
  tabs: Tab[];
  activeTabId: string;
  // panel actions (act on active tab)
  add: (kind: string, title: string) => void;
  remove: (id: string) => void;
  setMode: (mode: LayoutMode) => void;
  enterFree: (rects: Record<string, Rect>) => void;
  toggleCollapse: (id: string) => void;
  focus: (id: string | null) => void;
  setFullscreen: (id: string | null) => void;
  raise: (id: string) => void;
  move: (id: string, rect: Partial<Rect>) => void;
  // tab actions
  addTab: () => void;
  closeTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  setActiveTab: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function WorkspaceProvider({
  children,
  seed,
}: {
  children: ReactNode;
  seed?: { kind: string; title: string }[];
}) {
  const [state, dispatch] = useReducer(reducer, undefined, (): AppState => {
    const tab = emptyTab("MAIN");
    if (seed) {
      let z = 0;
      tab.zCounter = seed.length;
      tab.panels = seed.map((e, i) => ({
        id: nextId("panel"),
        kind: e.kind,
        title: e.title,
        collapsed: false,
        free: scatter(i),
        z: ++z,
      }));
    }
    return { tabs: [tab], activeTabId: tab.id };
  });

  const active = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];

  const api: WorkspaceApi = {
    panels: active.panels,
    mode: active.mode,
    focusedId: active.focusedId,
    fullscreenId: active.fullscreenId,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    add: (kind, title) => dispatch({ type: "ADD", kind, title }),
    remove: (id) => dispatch({ type: "REMOVE", id }),
    setMode: (mode) => dispatch({ type: "SET_MODE", mode }),
    enterFree: (rects) => dispatch({ type: "ENTER_FREE", rects }),
    toggleCollapse: (id) => dispatch({ type: "TOGGLE_COLLAPSE", id }),
    focus: (id) => dispatch({ type: "FOCUS", id }),
    setFullscreen: (id) => dispatch({ type: "FULLSCREEN", id }),
    raise: (id) => dispatch({ type: "RAISE", id }),
    move: (id, rect) => dispatch({ type: "MOVE", id, rect }),
    addTab: () => dispatch({ type: "ADD_TAB" }),
    closeTab: (id) => dispatch({ type: "CLOSE_TAB", id }),
    renameTab: (id, name) => dispatch({ type: "RENAME_TAB", id, name }),
    setActiveTab: (id) => dispatch({ type: "SET_TAB", id }),
  };

  return <WorkspaceContext.Provider value={api}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
```

### src/workspace/layout.ts

```ts
import type { ComputedLayout, LayoutMode, Panel, PanelState } from "./types";

const GAP = 20;
const PAD = 20;
const HEADER_H = 44;

interface Ctx {
  panels: Panel[];
  mode: LayoutMode;
  focusedId: string | null;
  fullscreenId: string | null;
  W: number;
  H: number;
}

/**
 * Pure layout engine: given workspace state + canvas size, returns the target
 * geometry for every panel. The same panel instance is only ever repositioned
 * (never remounted), so internal component state survives every layout change.
 */
export function computeLayout({
  panels,
  mode,
  focusedId,
  fullscreenId,
  W,
  H,
}: Ctx): Record<string, ComputedLayout> {
  const out: Record<string, ComputedLayout> = {};
  const innerW = Math.max(320, W - PAD * 2);
  const innerH = Math.max(240, H - PAD * 2);

  const base = (p: Panel, state: PanelState, r: { x: number; y: number; w: number; h: number }, extra?: Partial<ComputedLayout>): ComputedLayout => ({
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    scale: 1,
    opacity: 1,
    z: p.z,
    state,
    interactive: true,
    ...extra,
  });

  // 1. Fullscreen wins over everything.
  if (fullscreenId) {
    panels.forEach((p) => {
      if (p.id === fullscreenId) {
        out[p.id] = base(p, "fullscreen", { x: PAD, y: PAD, w: innerW, h: innerH }, { z: 1000 });
      } else {
        // keep mounted but parked off the visible field
        out[p.id] = base(p, "docked", { x: PAD, y: PAD, w: 400, h: 300 }, {
          opacity: 0,
          scale: 0.9,
          interactive: false,
          z: 0,
        });
      }
    });
    return out;
  }

  const collapsedH = HEADER_H;

  if (mode === "free") {
    panels.forEach((p) => {
      const h = p.collapsed ? collapsedH : p.free.h;
      const focused = focusedId === p.id;
      out[p.id] = base(p, p.collapsed ? "compact" : "floating", { x: p.free.x, y: p.free.y, w: p.free.w, h }, {
        opacity: focusedId && !focused ? 0.5 : 1,
        z: focused ? 900 : p.z,
      });
    });
    return out;
  }

  if (mode === "grid") {
    const n = panels.length || 1;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const cw = (innerW - GAP * (cols - 1)) / cols;
    const ch = (innerH - GAP * (rows - 1)) / rows;
    panels.forEach((p, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const collapsed = p.collapsed;
      out[p.id] = base(p, collapsed ? "compact" : "docked", {
        x: PAD + c * (cw + GAP),
        y: PAD + r * (ch + GAP),
        w: cw,
        h: collapsed ? collapsedH : ch,
      });
    });
    return out;
  }

  if (mode === "stack") {
    // Cascading overlap stack — like a deck of cards.
    const cardW = Math.min(560, innerW - 80);
    const cardH = Math.min(420, innerH - 120);
    const step = 34;
    panels.forEach((p, i) => {
      const collapsed = p.collapsed;
      out[p.id] = base(p, collapsed ? "compact" : "docked", {
        x: PAD + i * step,
        y: PAD + i * step,
        w: cardW,
        h: collapsed ? collapsedH : cardH,
      }, { z: i + 1 });
    });
    return out;
  }

  if (mode === "split") {
    const cols = 2;
    const cw = (innerW - GAP) / cols;
    panels.forEach((p, i) => {
      const c = i % cols;
      const col = panels.filter((_, j) => j % cols === c);
      const idxInCol = col.findIndex((x) => x.id === p.id);
      const ch = (innerH - GAP * (col.length - 1)) / col.length;
      const collapsed = p.collapsed;
      out[p.id] = base(p, collapsed ? "compact" : "docked", {
        x: PAD + c * (cw + GAP),
        y: PAD + idxInCol * (ch + GAP),
        w: cw,
        h: collapsed ? collapsedH : ch,
      });
    });
    return out;
  }

  // focus mode: one hero panel, the rest as a strip of thumbnails on the right.
  const heroId = focusedId ?? panels[0]?.id ?? null;
  const others = panels.filter((p) => p.id !== heroId);
  const stripW = others.length ? 220 : 0;
  const heroW = innerW - (stripW ? stripW + GAP : 0);
  panels.forEach((p) => {
    if (p.id === heroId) {
      out[p.id] = base(p, "focused", { x: PAD, y: PAD, w: heroW, h: innerH }, { z: 500 });
    }
  });
  const thumbH = others.length ? (innerH - GAP * (others.length - 1)) / others.length : 0;
  others.forEach((p, i) => {
    out[p.id] = base(p, "compact", {
      x: PAD + heroW + GAP,
      y: PAD + i * (thumbH + GAP),
      w: stripW,
      h: thumbH,
    }, { opacity: 0.85 });
  });
  return out;
}
```

### src/workspace/Workspace.tsx

```tsx
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useWorkspace } from "./store";
import { computeLayout } from "./layout";
import { Panel } from "./Panel";
import { REGISTRY } from "./registry";
import { TabBar } from "./TabBar";
import { ThemeMenu } from "./ThemeMenu";
import { CommandPalette } from "./CommandPalette";
import type { LayoutMode } from "./types";

const MODES: { mode: LayoutMode; label: string; hint: string }[] = [
  { mode: "free", label: "FREE", hint: "drag anywhere" },
  { mode: "grid", label: "GRID", hint: "auto tile" },
  { mode: "stack", label: "STACK", hint: "cascade" },
  { mode: "split", label: "SPLIT", hint: "two columns" },
  { mode: "focus", label: "FOCUS", hint: "hero + strip" },
];

export function Workspace() {
  const ws = useWorkspace();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [adderOpen, setAdderOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        ws.setFullscreen(null);
        setAdderOpen(false);
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws]);

  // Switching to FREE adopts the current on-screen geometry so panels don't
  // jump or resize — an Arc-like smooth handoff between layout modes.
  const switchMode = (mode: LayoutMode) => {
    if (mode === "free") {
      const rects: Record<string, { x: number; y: number; w: number; h: number }> = {};
      ws.panels.forEach((p) => {
        const l = layouts[p.id];
        if (l) rects[p.id] = { x: l.x, y: l.y, w: l.w, h: l.h };
      });
      ws.enterFree(rects);
    } else {
      ws.setMode(mode);
    }
  };


  const layouts = computeLayout({
    panels: ws.panels,
    mode: ws.mode,
    focusedId: ws.focusedId,
    fullscreenId: ws.fullscreenId,
    W: size.w,
    H: size.h,
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* top bar */}
      <header className="z-20 flex shrink-0 items-center gap-3 border-b border-border bg-surface/80 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-sm bg-[image:var(--gradient-acid)] font-mono text-sm font-bold text-acid-foreground">
            ▚
          </span>
          <h1 className="font-mono text-sm font-bold tracking-[0.25em] text-foreground">GRIDLOCK</h1>
        </div>

        {/* layout switcher */}
        <div className="ml-2 flex items-center gap-1 rounded-md border border-border bg-background/60 p-1">
          {MODES.map((m) => (
            <button
              key={m.mode}
              onClick={() => switchMode(m.mode)}
              title={m.hint}
              className={`rounded-[4px] px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wider transition-colors ${
                ws.mode === m.mode && !ws.fullscreenId
                  ? "bg-[image:var(--gradient-acid)] text-acid-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden font-mono text-[11px] text-muted-foreground lg:inline">
            {ws.panels.length} components · state persists across layouts
          </span>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-sm border border-border bg-background/60 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-acid/60 hover:text-foreground"
          >
            <span>⌘K</span>
            <span className="hidden sm:inline">command</span>
          </button>
          <ThemeMenu />

          <button
            onClick={() => setAdderOpen((v) => !v)}
            className="rounded-sm border border-acid/60 bg-acid/10 px-3 py-1.5 font-mono text-xs font-semibold tracking-wider text-acid transition-colors hover:bg-acid hover:text-acid-foreground"
          >
            + INSERT
          </button>
        </div>
      </header>

      <TabBar />


      {/* canvas */}
      <div className="relative flex-1 overflow-hidden bg-scan" ref={canvasRef}>
        {ws.panels.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-acid-gradient font-mono text-2xl font-bold">EMPTY WORKSPACE</p>
              <p className="mt-2 font-mono text-xs text-muted-foreground">insert a component to begin</p>
            </div>
          </div>
        )}

        {ws.panels.map((p) => (
          <Panel
            key={p.id}
            id={p.id}
            kind={p.kind}
            title={p.title}
            layout={layouts[p.id]}
            canvasRef={canvasRef}
          />
        ))}

        {/* fullscreen exit hint */}
        <AnimatePresence>
          {ws.fullscreenId && (
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={() => ws.setFullscreen(null)}
              className="absolute bottom-4 left-1/2 z-[1001] -translate-x-1/2 rounded-full border border-border bg-surface-raised px-4 py-1.5 font-mono text-[11px] tracking-widest text-muted-foreground hover:text-acid"
            >
              ESC · EXIT FULLSCREEN
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* insert palette */}
      <AnimatePresence>
        {adderOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-30"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAdderOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="fixed right-4 top-14 z-40 w-64 rounded-md border border-border bg-surface p-2 shadow-[var(--shadow-panel)]"
            >
              <p className="px-2 py-1 font-mono text-[10px] tracking-widest text-muted-foreground">
                INSERT COMPONENT
              </p>
              {REGISTRY.map((r) => (
                <button
                  key={r.kind}
                  onClick={() => {
                    ws.add(r.kind, r.title);
                    setAdderOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left hover:bg-surface-raised"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-sm border border-border bg-background/60 text-acid">
                    {r.glyph}
                  </span>
                  <span className="font-mono text-xs font-semibold tracking-wider">{r.title}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onSwitchMode={switchMode} />
    </div>
  );
}
```

### src/workspace/Panel.tsx

```tsx
import { memo } from "react";
import { motion } from "motion/react";
import type { ComputedLayout } from "./types";
import { useWorkspace } from "./store";
import { registryByKind } from "./registry";

const stateLabel: Record<string, string> = {
  docked: "DOCKED",
  floating: "FLOAT",
  compact: "COMPACT",
  focused: "FOCUS",
  fullscreen: "FULL",
};

function PanelInner({
  id,
  kind,
  title,
  layout,
  canvasRef,
}: {
  id: string;
  kind: string;
  title: string;
  layout: ComputedLayout;
  canvasRef: React.RefObject<HTMLDivElement | null>;
}) {
  const ws = useWorkspace();
  const reg = registryByKind(kind);
  const isFullscreen = layout.state === "fullscreen";
  const isCompact = layout.state === "compact";
  const isTiny = layout.w < 240;

  return (
    <motion.div
      drag={ws.mode === "free" && !isFullscreen}
      dragMomentum={false}
      dragConstraints={canvasRef}
      onPointerDown={() => ws.raise(id)}
      onDragEnd={(_, info) => {
        ws.move(id, {
          x: Math.max(0, layout.x + info.offset.x),
          y: Math.max(0, layout.y + info.offset.y),
        });
      }}
      initial={false}
      animate={{
        x: layout.x,
        y: layout.y,
        width: layout.w,
        height: layout.h,
        opacity: layout.opacity,
        scale: layout.scale,
      }}
      transition={{ type: "spring", stiffness: 320, damping: 34, mass: 0.7 }}
      style={{ position: "absolute", zIndex: layout.z, pointerEvents: layout.interactive ? "auto" : "none" }}
      className={`group flex flex-col overflow-hidden rounded-md border bg-surface backdrop-blur-sm ${
        layout.state === "focused" || isFullscreen
          ? "border-acid/60 shadow-[var(--shadow-acid)]"
          : "border-border shadow-[var(--shadow-panel)]"
      }`}
    >
      {/* header */}
      <div
        className={`flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3 ${
          ws.mode === "free" && !isFullscreen ? "cursor-grab active:cursor-grabbing" : ""
        }`}
      >
        <span className="text-acid">{reg?.glyph}</span>
        <span className="truncate font-mono text-xs font-semibold tracking-wider text-foreground">
          {title}
        </span>
        <span className="ml-1 rounded-[3px] bg-background/60 px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-muted-foreground">
          {stateLabel[layout.state]}
        </span>
        <div className="ml-auto flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
          <HeaderBtn label="collapse" onClick={() => ws.toggleCollapse(id)}>
            {isCompact ? "▢" : "▬"}
          </HeaderBtn>
          <HeaderBtn label="focus" onClick={() => { ws.setMode("focus"); ws.focus(id); }}>
            ◎
          </HeaderBtn>
          <HeaderBtn label="fullscreen" onClick={() => ws.setFullscreen(isFullscreen ? null : id)}>
            {isFullscreen ? "✕" : "⤢"}
          </HeaderBtn>
          <HeaderBtn label="close" danger onClick={() => ws.remove(id)}>
            ×
          </HeaderBtn>
        </div>
      </div>

      {/* body — always mounted so component state survives every layout morph */}
      <div className={`min-h-0 flex-1 ${isCompact ? "hidden" : "block"} ${isTiny ? "p-1.5" : "p-3"}`}>
        {isTiny ? (
          <div className="grid h-full place-items-center text-center text-[10px] text-muted-foreground">
            <span>{title}<br />live</span>
          </div>
        ) : (
          reg?.render()
        )}
      </div>
    </motion.div>
  );
}

function HeaderBtn({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`grid h-6 w-6 place-items-center rounded-[3px] border border-transparent font-mono text-xs text-muted-foreground transition-colors hover:border-border ${
        danger ? "hover:bg-destructive hover:text-destructive-foreground" : "hover:bg-background hover:text-acid"
      }`}
    >
      {children}
    </button>
  );
}

export const Panel = memo(PanelInner);
```

### src/workspace/CommandPalette.tsx

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useWorkspace } from "./store";
import { REGISTRY } from "./registry";
import { THEMES, useTheme } from "./theme";
import type { LayoutMode } from "./types";

interface Cmd {
  id: string;
  group: string;
  label: string;
  glyph: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onSwitchMode,
}: {
  open: boolean;
  onClose: () => void;
  onSwitchMode: (mode: LayoutMode) => void;
}) {
  const ws = useWorkspace();
  const { setTheme } = useTheme();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [];
    REGISTRY.forEach((r) =>
      list.push({
        id: `insert-${r.kind}`,
        group: "Insert",
        label: `Insert ${r.title}`,
        glyph: r.glyph,
        run: () => ws.add(r.kind, r.title),
      }),
    );
    (["free", "grid", "stack", "split", "focus"] as LayoutMode[]).forEach((m) =>
      list.push({
        id: `mode-${m}`,
        group: "Layout",
        label: `Switch to ${m.toUpperCase()} layout`,
        glyph: "▦",
        run: () => onSwitchMode(m),
      }),
    );
    list.push({ id: "tab-new", group: "Spaces", label: "New space (tab)", glyph: "+", run: ws.addTab });
    ws.tabs.forEach((t) =>
      list.push({
        id: `tab-${t.id}`,
        group: "Spaces",
        label: `Go to space · ${t.name}`,
        glyph: "▚",
        run: () => ws.setActiveTab(t.id),
      }),
    );
    THEMES.forEach((t) =>
      list.push({
        id: `theme-${t.id}`,
        group: "Theme",
        label: `Theme · ${t.name}`,
        glyph: "◑",
        run: () => setTheme(t.id),
      }),
    );
    return list;
  }, [ws, setTheme, onSwitchMode]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter((c) => (c.label + c.group).toLowerCase().includes(s));
  }, [q, commands]);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => setActive(0), [q]);

  const runAt = (i: number) => {
    const c = filtered[i];
    if (!c) return;
    c.run();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[2000] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div
            className="absolute inset-0 bg-background/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="relative w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-acid)]"
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <span className="text-acid">⌘</span>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(filtered.length - 1, a + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(0, a - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    runAt(active);
                  }
                }}
                placeholder="Type a command… insert, layout, space, theme"
                className="flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <span className="rounded-[3px] border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                ESC
              </span>
            </div>
            <div className="max-h-[52vh] overflow-auto p-2">
              {filtered.length === 0 && (
                <p className="px-3 py-6 text-center font-mono text-xs text-muted-foreground">no matches</p>
              )}
              {filtered.map((c, i) => (
                <button
                  key={c.id}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => runAt(i)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                    i === active ? "bg-surface-raised" : ""
                  }`}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-sm border border-border bg-background/60 text-acid">
                    {c.glyph}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{c.label}</span>
                  </span>
                  <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                    {c.group.toUpperCase()}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
```

### src/workspace/TabBar.tsx

```tsx
import { useState } from "react";
import { useWorkspace } from "./store";

export function TabBar() {
  const ws = useWorkspace();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="z-10 flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-background/50 px-2 py-1.5">
      {ws.tabs.map((tab) => {
        const active = tab.id === ws.activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => ws.setActiveTab(tab.id)}
            onDoubleClick={() => setEditing(tab.id)}
            className={`group flex shrink-0 cursor-pointer items-center gap-2 rounded-sm border px-3 py-1 font-mono text-[11px] tracking-wider transition-colors ${
              active
                ? "border-acid/60 bg-surface-raised text-foreground"
                : "border-transparent text-muted-foreground hover:bg-surface hover:text-foreground"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-acid" : "bg-muted-foreground/40"}`} />
            {editing === tab.id ? (
              <input
                autoFocus
                defaultValue={tab.name}
                onBlur={(e) => {
                  ws.renameTab(tab.id, e.target.value.trim());
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="w-24 bg-transparent outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span>{tab.name}</span>
            )}
            <span className="rounded-[3px] bg-background/60 px-1 text-[9px] text-muted-foreground">
              {tab.panels.length}
            </span>
            {ws.tabs.length > 1 && (
              <button
                aria-label="close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  ws.closeTab(tab.id);
                }}
                className="grid h-4 w-4 place-items-center rounded-[3px] text-muted-foreground opacity-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={ws.addTab}
        aria-label="new tab"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border border-border text-muted-foreground hover:border-acid hover:text-acid"
      >
        +
      </button>
      <span className="ml-2 hidden shrink-0 font-mono text-[10px] text-muted-foreground md:inline">
        double-click to rename · each tab keeps its own layout & state
      </span>
    </div>
  );
}
```

### src/workspace/theme.tsx

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeId = "marathon" | "endfield";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  tag: string;
  swatch: string[];
}

export const THEMES: ThemeMeta[] = [
  {
    id: "marathon",
    name: "MARATHON",
    tag: "酸性艺术 · acid brutalism",
    swatch: ["#c6f542", "#f5a623", "#e0409e", "#141a24"],
  },
  {
    id: "endfield",
    name: "武陵城",
    tag: "终末地 · Endfield ink-industrial",
    swatch: ["#e8dcc0", "#3a7d6e", "#c0432c", "#1c1a17"],
  },
];

interface ThemeApi {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeId>("marathon");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
```

### src/workspace/ThemeMenu.tsx

```tsx
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { THEMES, useTheme } from "./theme";

export function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const current = THEMES.find((t) => t.id === theme)!;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-sm border border-border bg-background/60 px-2.5 py-1.5 font-mono text-[11px] tracking-wider text-foreground hover:border-acid/60"
      >
        <span className="flex gap-0.5">
          {current.swatch.map((c) => (
            <span key={c} className="h-3 w-1.5 rounded-[1px]" style={{ backgroundColor: c }} />
          ))}
        </span>
        {current.name}
        <span className="text-muted-foreground">▾</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="absolute right-0 top-10 z-40 w-64 rounded-md border border-border bg-surface p-2 shadow-[var(--shadow-panel)]"
            >
              <p className="px-2 py-1 font-mono text-[10px] tracking-widest text-muted-foreground">THEME</p>
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTheme(t.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors ${
                    t.id === theme ? "bg-surface-raised" : "hover:bg-surface-raised"
                  }`}
                >
                  <span className="flex overflow-hidden rounded-[3px]">
                    {t.swatch.map((c) => (
                      <span key={c} className="h-8 w-3" style={{ backgroundColor: c }} />
                    ))}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-mono text-xs font-semibold tracking-wider">{t.name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{t.tag}</span>
                  </span>
                  {t.id === theme && <span className="ml-auto text-acid">◎</span>}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
```

### src/workspace/registry.tsx

```tsx
import type { ReactNode } from "react";
import {
  CalcComponent,
  ClockComponent,
  CounterComponent,
  KanbanComponent,
  MixerComponent,
  NotesComponent,
  TasksComponent,
  TerminalComponent,
} from "./components";

export interface Registry {
  kind: string;
  title: string;
  glyph: string;
  render: () => ReactNode;
}

export const REGISTRY: Registry[] = [
  { kind: "notes", title: "SCRATCH", glyph: "✎", render: () => <NotesComponent /> },
  { kind: "counter", title: "COUNTER", glyph: "◈", render: () => <CounterComponent /> },
  { kind: "mixer", title: "ACID MIXER", glyph: "◐", render: () => <MixerComponent /> },
  { kind: "terminal", title: "TERMINAL", glyph: "▚", render: () => <TerminalComponent /> },
  { kind: "tasks", title: "TASKS", glyph: "☰", render: () => <TasksComponent /> },
  { kind: "clock", title: "CLOCK", glyph: "◷", render: () => <ClockComponent /> },
  { kind: "calc", title: "CALCULATOR", glyph: "⊞", render: () => <CalcComponent /> },
  { kind: "kanban", title: "KANBAN BOARD", glyph: "▤", render: () => <KanbanComponent /> },
];

export const registryByKind = (kind: string) => REGISTRY.find((r) => r.kind === kind);
```
