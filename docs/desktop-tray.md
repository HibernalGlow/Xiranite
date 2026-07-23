# Desktop tray contract

Xiranite exposes system trays through the host-neutral `TrayRuntime`. Node
packages declare intent in `AppNodeEntry.tray`; they do not import Wails or any
other desktop SDK.

```ts
export default {
  def,
  core,
  Component,
  tray: [
    {
      id: "quick-actions",
      scope: "main",
      label: "Example node",
      items: [
        { id: "run", label: "Run" },
        { id: "enabled", label: "Enabled", checked: true },
      ],
      onAction(actionId) {
        // Dispatch into the node's shared service or store.
      },
    },
    {
      id: "status",
      scope: "standalone",
      tooltip: "Example node status",
      icon: new URL("./tray.png", import.meta.url).href,
      items: [{ id: "open", label: "Open node" }],
      onAction(actionId) {
        // The same declaration may use a different action handler.
      },
    },
  ],
} satisfies AppNodeEntry
```

## Scopes

- `main` adds a node submenu to the Xiranite tray context.
- `standalone` creates a separate tray icon owned by that node declaration.
- A node may declare either scope or one declaration for each scope.

Menu item IDs only need to be unique within a declaration. Nested items,
separators, disabled items, and checked items use the same recursive menu
format. A custom icon is a browser-resolvable image URL or image data URL; the
active desktop adapter resolves and decodes it.

## Adapter boundary

The coordinator converts node declarations into `NativeTraySpec` values and
routes `TrayActionEvent` values back to the declaring node. A desktop host only
implements the four methods on `TrayRuntime`: capabilities, main-tray enable,
spec synchronization, and action subscription.

The current Wails adapter sends normalized specs to the Go host. Web and the
current Deno Desktop canary expose an unsupported adapter without changing the
node contract. A future host adapter must not require nodes to import its SDK.

The `xiranite:desktop:main-tray-enabled` preference is stored through the
active runtime's `StorageRuntime`. When enabled, closing the Wails main window
hides it; the main tray can restore the window or explicitly quit Xiranite.
