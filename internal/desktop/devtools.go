package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

func devToolsKeyBindings() map[string]func(application.Window) {
	return map[string]func(application.Window){
		"F12": func(window application.Window) {
			window.OpenDevTools()
		},
	}
}
