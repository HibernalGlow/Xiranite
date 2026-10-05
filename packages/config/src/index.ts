export {
  resolveLegacyXiraniteDataDirs,
  resolveXiraniteConfigPath,
  resolveXiraniteDataDir,
  XIRANITE_CONFIG_FILENAME,
  type ResolveConfigPathOptions,
} from "./paths.js"

export {
  getAppConfig,
  getNodeConfig,
  getWebview2Config,
  stripBom,
  updateAppConfig,
  updateNodeConfig,
  updateWebview2Config,
  xiraniteConfigSchema,
  type Webview2Config,
  type XiraniteConfig,
} from "./schema.js"

export { parseToml, stringifyToml, stringifyXiraniteConfig } from "./xiraniteToml.js"

export { createConfigIo, type ConfigIo, type ConfigTransport } from "./transport.js"
