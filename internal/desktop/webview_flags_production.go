//go:build production

package desktop

func developmentWebviewUserDataPath(configPath string) string {
	return resolveDevelopmentWebviewUserDataPath(configPath, false)
}

func developmentBrowserRuntimeConfig() BrowserRuntimeConfig {
	return BrowserRuntimeConfig{}
}
