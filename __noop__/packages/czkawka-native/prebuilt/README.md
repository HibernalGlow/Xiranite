# Prebuilt Czkawka Node-API assets

Normal local and cloud Wails builds use the committed platform ZIP and verify it against `manifest.json`. They do not compile Rust.

Refresh the prebuilt asset only after intentionally changing the frozen Rust bridge or its native dependencies:

```sh
bun run refresh:native-assets
```

To repackage an already-built Release binding without invoking Cargo:

```sh
bun run refresh:native-assets:existing
```

The Wails production build embeds the verified ZIP. At runtime, the generic Go host materializes the ZIP and manifest, while the TypeScript loader verifies and extracts the native files into a versioned user cache.
