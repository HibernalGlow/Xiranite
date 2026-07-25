# Prebuilt Node-API assets

Normal local and cloud Wails builds use the committed ArcThumb, Czkawka, and slimg platform ZIPs and verify them against `manifest.json`. They do not compile Rust.

Refresh the prebuilt asset only after intentionally changing the frozen Rust bridge or its native dependencies:

```sh
bun run refresh:native-assets
```

To repackage an already-built Release binding without invoking Cargo:

```sh
bun run refresh:native-assets:existing
```

The Wails production build embeds the verified ZIPs. At runtime, the Go host materializes the archives and manifest, while `@xiranite/native-loader` verifies and extracts each binding into a versioned user cache.
