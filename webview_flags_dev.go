//go:build !production

package main

func developmentBrowserRuntimeConfig() BrowserRuntimeConfig {
	return BrowserRuntimeConfig{
		Switches: []string{
			"--auto-open-devtools-for-tabs",
			"--allow-insecure-localhost",
		},
	}
}
