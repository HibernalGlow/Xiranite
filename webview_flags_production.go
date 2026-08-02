//go:build production

package main

func developmentWebviewUserDataPath(configPath string) string {
	return resolveDevelopmentWebviewUserDataPath(configPath, false)
}

func developmentBrowserRuntimeConfig() BrowserRuntimeConfig {
	return BrowserRuntimeConfig{}
}
