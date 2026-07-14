//go:build !production

package main

func developmentWebviewBrowserArgs() []string {
	return []string{
		"--auto-open-devtools-for-tabs",
		"--allow-insecure-localhost",
	}
}
