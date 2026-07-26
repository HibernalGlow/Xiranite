# Prebuilt Node-API assets

Normal local and cloud Wails builds use the committed ArcThumb and Czkawka platform ZIPs and verify them against `manifest.json`. They do not compile Rust. XLchemy loads the system-installed `slimg_cffi.dll` directly and does not ship a Node-API asset.

Refresh the prebuilt asset only after intentionally changing the frozen Rust bridge or its native dependencies:

```sh
bun run refresh:native-assets
```

To repackage an already-built Release binding without invoking Cargo:

```sh
bun run refresh:native-assets:existing
```

The Wails production build embeds the verified ZIPs. At runtime, the Go host materializes the archives and manifest, while `@xiranite/native-loader` verifies and extracts each binding into a versioned user cache.
