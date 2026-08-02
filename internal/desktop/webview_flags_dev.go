//go:build !production

package desktop

func developmentWebviewUserDataPath(configPath string) string {
	return resolveDevelopmentWebviewUserDataPath(configPath, true)
}

func developmentBrowserRuntimeConfig() BrowserRuntimeConfig {
	return BrowserRuntimeConfig{
		Switches: []string{
			"--auto-open-devtools-for-tabs",
			"--allow-insecure-localhost",
		},
	}
}
