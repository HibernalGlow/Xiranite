import type { ElectrobunConfig } from "electrobun"

const config: ElectrobunConfig = {
  app: {
    name: "Xiranite",
    identifier: "dev.xiranite.app",
    version: "0.0.1",
    description: "Xiranite desktop workspace.",
  },
  build: {
    bun: {
      entrypoint: "electron/index.ts",
    },
    buildFolder: "build/electrobun",
    artifactFolder: "artifacts/electrobun",
    targets: "current",
    copy: {
      dist: "dist",
    },
    win: {
      defaultRenderer: "native",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  scripts: {
    postBuild: "scripts/patch-electrobun-dpi.ts",
    postPackage: "scripts/patch-electrobun-dpi.ts",
  },
}

export default config
