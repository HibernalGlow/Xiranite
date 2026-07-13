# Desktop file-drop API

Node components must not import Wails, Tauri, Electron, or another desktop-shell runtime directly.

## Layers

1. `RuntimeInterface.fileDrops` receives native absolute paths from the active desktop adapter.
2. `NodeLocalFilesCapability.subscribeDrops(targetId, handler)` exposes target-scoped paths to node hosts.
3. `useLocalFileDrop` owns DOM target IDs, native subscription cleanup, direct `File.path` fallback, and the Wails compatibility marker.

Nodes only use the shared hook:

```tsx
const drop = useLocalFileDrop({
  disabled,
  subscribeDrops: host.localFiles?.subscribeDrops,
  onDropPaths: addPaths,
})

return <div {...drop.targetProps}>Drop files here</div>
```

When adding another desktop shell, implement `NativeFileDropRuntime` in its adapter. Do not add shell detection or runtime imports to node components.

## Audit

Existing native drop targets:

- `xlchemy`: image files and folders.
- `lorat`: model files and preview images.

Path-input nodes that are good candidates for the shared hook when their input workbench is updated:

- File or mixed inputs: `audiov`, `bitv`, `classf`, `coveru`, `gifu`, `smartzip`, `synct`, `timeu`, `transq`.
- Directory/library inputs: `classq`, `nameu`, `samea`, `snf`.
- Specialized path flows requiring per-node acceptance rules before enabling drop: `crashu`, `enginev`, `seriex`.

Do not make every text field a drop target automatically. Output paths, report paths, regex text, and destination directories need a distinct semantic action and must not consume source-file drops.
