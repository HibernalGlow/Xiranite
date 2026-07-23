package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type TrayCapabilities struct {
	Supported       bool   `json:"supported"`
	MainTray        bool   `json:"mainTray"`
	StandaloneTrays bool   `json:"standaloneTrays"`
	Message         string `json:"message,omitempty"`
}

type TrayMenuItemSpec struct {
	ID       string             `json:"id"`
	Label    string             `json:"label"`
	Type     string             `json:"type,omitempty"`
	Enabled  *bool              `json:"enabled,omitempty"`
	Checked  *bool              `json:"checked,omitempty"`
	Children []TrayMenuItemSpec `json:"children,omitempty"`
}

type NativeTraySpec struct {
	ID          string             `json:"id"`
	Kind        string             `json:"kind"`
	Tooltip     string             `json:"tooltip"`
	IconDataURL string             `json:"iconDataUrl,omitempty"`
	Items       []TrayMenuItemSpec `json:"items"`
}

type TrayActionEvent struct {
	TrayID string `json:"trayId"`
	ItemID string `json:"itemId"`
}

type desktopTrayManager struct {
	mu         sync.Mutex
	app        *application.App
	mainWindow *application.WebviewWindow
	mainTray   *application.SystemTray
	standalone map[string]managedTray
	mainEnable bool
	quitting   bool
}

type managedTray struct {
	tray        *application.SystemTray
	iconDataURL string
}

func newDesktopTrayManager(app *application.App, mainWindow *application.WebviewWindow) *desktopTrayManager {
	manager := &desktopTrayManager{
		app:        app,
		mainWindow: mainWindow,
		standalone: make(map[string]managedTray),
		mainEnable: true,
	}
	manager.mainTray = manager.newTray("Xiranite", nil)
	manager.mainTray.OnClick(manager.showMainWindow)
	manager.mainTray.SetMenu(manager.mainMenu(nil))

	mainWindow.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		manager.mu.Lock()
		keepRunning := manager.mainEnable && !manager.quitting
		manager.mu.Unlock()
		if keepRunning {
			event.Cancel()
			mainWindow.Hide()
		}
	})
	return manager
}

func (s *XiraniteService) TrayCapabilities() TrayCapabilities {
	return TrayCapabilities{
		Supported:       s.trayManager != nil,
		MainTray:        s.trayManager != nil,
		StandaloneTrays: s.trayManager != nil,
		Message:         "System trays are provided by the active Wails desktop adapter.",
	}
}

func (s *XiraniteService) TraySetMainEnabled(enabled bool) {
	if s.trayManager != nil {
		s.trayManager.setMainEnabled(enabled)
	}
}

func (s *XiraniteService) TraySync(payloadJSON string) error {
	if s.trayManager == nil {
		return errors.New("system tray manager is unavailable")
	}
	var specs []NativeTraySpec
	if err := json.Unmarshal([]byte(payloadJSON), &specs); err != nil {
		return fmt.Errorf("invalid tray payload: %w", err)
	}
	return s.trayManager.sync(specs)
}

func (m *desktopTrayManager) setMainEnabled(enabled bool) {
	m.mu.Lock()
	m.mainEnable = enabled
	tray := m.mainTray
	m.mu.Unlock()
	if enabled {
		tray.Show()
	} else {
		tray.Hide()
	}
}

func (m *desktopTrayManager) sync(specs []NativeTraySpec) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	seen := make(map[string]bool)
	for _, spec := range specs {
		if spec.ID == "" {
			return errors.New("tray id must not be empty")
		}
		if seen[spec.ID] {
			return fmt.Errorf("duplicate tray id %q", spec.ID)
		}
		seen[spec.ID] = true

		if spec.Kind == "main" {
			m.mainTray.SetTooltip(defaultString(spec.Tooltip, "Xiranite"))
			m.mainTray.SetMenu(m.mainMenu(spec.Items))
			continue
		}
		if spec.Kind != "standalone" {
			return fmt.Errorf("unsupported tray kind %q", spec.Kind)
		}

		icon, err := decodeTrayIcon(spec.IconDataURL)
		if err != nil {
			return fmt.Errorf("tray %q icon: %w", spec.ID, err)
		}
		managed, exists := m.standalone[spec.ID]
		if !exists || managed.iconDataURL != spec.IconDataURL {
			if exists {
				managed.tray.Destroy()
			}
			tray := m.newTray(defaultString(spec.Tooltip, spec.ID), icon)
			tray.OnClick(m.showMainWindow)
			managed = managedTray{tray: tray, iconDataURL: spec.IconDataURL}
			m.standalone[spec.ID] = managed
		} else {
			managed.tray.SetTooltip(defaultString(spec.Tooltip, spec.ID))
		}
		managed.tray.SetMenu(m.standaloneMenu(spec.ID, spec.Items))
	}

	for id, managed := range m.standalone {
		if !seen[id] {
			managed.tray.Destroy()
			delete(m.standalone, id)
		}
	}
	return nil
}

func (m *desktopTrayManager) newTray(tooltip string, icon []byte) *application.SystemTray {
	tray := m.app.SystemTray.New()
	tray.SetTooltip(tooltip)
	if len(icon) > 0 {
		tray.SetIcon(icon)
	}
	return tray
}

func (m *desktopTrayManager) mainMenu(items []TrayMenuItemSpec) *application.Menu {
	menu := application.NewMenu()
	menu.Add("打开 Xiranite").OnClick(func(*application.Context) { m.showMainWindow() })
	if len(items) > 0 {
		menu.AddSeparator()
		m.appendItems(menu, "xiranite.main", items)
	}
	menu.AddSeparator()
	menu.Add("退出 Xiranite").OnClick(func(*application.Context) { m.quit() })
	return menu
}

func (m *desktopTrayManager) standaloneMenu(trayID string, items []TrayMenuItemSpec) *application.Menu {
	menu := application.NewMenu()
	menu.Add("打开 Xiranite").OnClick(func(*application.Context) { m.showMainWindow() })
	if len(items) > 0 {
		menu.AddSeparator()
		m.appendItems(menu, trayID, items)
	}
	menu.AddSeparator()
	menu.Add("退出 Xiranite").OnClick(func(*application.Context) { m.quit() })
	return menu
}

func (m *desktopTrayManager) appendItems(menu *application.Menu, trayID string, items []TrayMenuItemSpec) {
	for _, spec := range items {
		if spec.Type == "separator" {
			menu.AddSeparator()
			continue
		}
		if len(spec.Children) > 0 {
			m.appendItems(menu.AddSubmenu(spec.Label), trayID, spec.Children)
			continue
		}
		var item *application.MenuItem
		if spec.Checked != nil {
			item = menu.AddCheckbox(spec.Label, *spec.Checked)
		} else {
			item = menu.Add(spec.Label)
		}
		if spec.Enabled != nil {
			item.SetEnabled(*spec.Enabled)
		}
		itemID := spec.ID
		item.OnClick(func(*application.Context) {
			m.app.Event.Emit("tray-action", TrayActionEvent{TrayID: trayID, ItemID: itemID})
		})
	}
}

func (m *desktopTrayManager) showMainWindow() {
	m.mainWindow.Show().Focus()
}

func (m *desktopTrayManager) quit() {
	m.mu.Lock()
	m.quitting = true
	m.mu.Unlock()
	m.app.Quit()
}

func decodeTrayIcon(dataURL string) ([]byte, error) {
	if dataURL == "" {
		return nil, nil
	}
	marker := ";base64,"
	index := strings.Index(dataURL, marker)
	if !strings.HasPrefix(dataURL, "data:image/") || index < 0 {
		return nil, errors.New("icon must be an image data URL")
	}
	decoded, err := base64.StdEncoding.DecodeString(dataURL[index+len(marker):])
	if err != nil {
		return nil, fmt.Errorf("invalid base64 data: %w", err)
	}
	return decoded, nil
}

func defaultString(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}
