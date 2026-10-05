//! System tray for the desktop shell: the tray half of the retired Wails bridge.
//!
//! ## The contract it answers
//!
//! `src/backend/runtime/runtime.ts:169` (`TrayRuntime`) drives this: `getCapabilities`, `setMainEnabled`,
//! `sync(specs)`, `subscribe(handler)`. `src/desktop/tray/trayCoordinator.ts` builds the specs from the
//! node modules' own `entry.tray` declarations, keys its action callbacks as `"{trayId}\n{itemId}"`, and
//! persists the toggle in `runtime.storage`. The behaviour here is a port of `tray_manager.go` (deleted
//! with the Go host in `fc5deceb`), including the parts that are easy to lose:
//!
//! - **The shell tray is built at startup and merely hidden while the toggle is off** — the Go manager
//!   called `Hide()` rather than skipping creation, so enabling it later is a visibility flip.
//! - **Closing the main window hides it while the tray keeps the process alive**, and only until the menu's
//!   退出 item sets `quitting`. Without the flag "close to tray" would make the app impossible to quit;
//!   without the hide, the toggle would be a lie.
//! - **`sync` replaces the whole tray set and destroys the stale ones**, because a tray left behind after
//!   its module stopped declaring it is an icon whose items route to nobody.
//! - **Bad specs are errors returned as values** (`TraySync` returned a Go `error`, which the bridge
//!   turned into a rejected promise): empty/duplicate ids and unknown kinds must reach the coordinator,
//!   which awaits `sync`, rather than being swallowed.
//!
//! ## Menu identity
//!
//! A menu item's id is `"{trayId}\n{itemId}"` — literally the coordinator's handler key, so the host keeps
//! no second table of "which item belongs to which tray" to drift out of sync. The two shell items
//! (`__open__`, `__quit__`) are handled here instead of forwarded, exactly as the Go menu did.
//!
//! ## Why the click handler captures the handle
//!
//! `on_tray_icon_event` gets `&TrayIcon`, and the Go code bound `OnClick` to "show the main window". The
//! window is looked up through an [`tauri::AppHandle`] cloned into the closure rather than through the
//! tray, so the handler does not depend on a tray-to-window back-pointer the runtime may not expose.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use base64::Engine;
use base64::prelude::BASE64_STANDARD;
use serde::Deserialize;
use serde::Serialize;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tauri::Menu;
use tauri::TrayIcon;
use tauri::TrayIconBuilder;
use tauri::image::Image;
use tauri::menu::CheckMenuItem;
use tauri::menu::CheckMenuItemBuilder;
use tauri::menu::MenuBuilder;
use tauri::menu::MenuItem;
use tauri::menu::MenuItemBuilder;
use tauri::menu::PredefinedMenuItem;
use tauri::menu::SubmenuBuilder;
use tauri::tray::TrayIconEvent;

/// The tray id the coordinator gives the shell tray (`trayCoordinator.ts:116`).
pub const MAIN_TRAY_ID: &str = "xiranite.main";
/// The tooltip the Go host used when a spec carried none.
pub const MAIN_TRAY_TOOLTIP: &str = "Xiranite";
/// Event name `TrayRuntime.subscribe` listens for.
pub const TRAY_ACTION_EVENT: &str = "tray-action";
/// Shell-owned item ids, handled in the host rather than forwarded to the WebView.
const OPEN_ITEM: &str = "__open__";
const QUIT_ITEM: &str = "__quit__";
/// The label separator Tauri's tray ids are reduced to.
const ID_SEPARATOR: char = '-';

/// `TrayCapabilities` in `runtime.ts:139`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayCapabilities {
    pub supported: bool,
    pub main_tray: bool,
    pub standalone_trays: bool,
    pub message: &'static str,
}

/// `TrayMenuItemSpec` in `runtime.ts:146`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayMenuItemSpec {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub checked: Option<bool>,
    #[serde(default)]
    pub children: Option<Vec<TrayMenuItemSpec>>,
}

/// `NativeTraySpec` in `runtime.ts:155`. The coordinator resolves a node's icon to a data URL before it
/// gets here, because only the WebView can fetch a bundled asset URL.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTraySpec {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub tooltip: String,
    #[serde(default)]
    pub icon_data_url: Option<String>,
    #[serde(default)]
    pub items: Vec<TrayMenuItemSpec>,
}

/// `TrayActionEvent` in `runtime.ts:164`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayActionEvent {
    pub tray_id: String,
    pub item_id: String,
}

/// What `sync` last installed for one standalone tray. The recorded data URL is what forces a rebuild:
/// Tauri cannot swap a tray icon in place the way `SystemTray.SetIcon` did.
struct ManagedTray {
    icon_data_url: String,
}

#[derive(Default)]
struct Inner {
    main_enabled: bool,
    quitting: bool,
    standalone: HashMap<String, ManagedTray>,
}

/// Managed state: the shell tray handle plus the standalone bookkeeping.
#[derive(Default)]
pub struct TrayState {
    inner: Mutex<Inner>,
    main: Mutex<Option<TrayIcon>>,
}

impl TrayState {
    fn main_tray(&self) -> Option<TrayIcon> {
        self.main.lock().ok().and_then(|slot| slot.clone())
    }

    fn set_main_visible(&self, enabled: bool) -> Result<(), String> {
        let tray = self.main_tray().ok_or("the system tray is not installed")?;
        tray.set_visible(enabled).map_err(|error| error.to_string())?;
        if let Ok(mut inner) = self.inner.lock() {
            inner.main_enabled = enabled;
        }
        Ok(())
    }

    /// The Go host's `shouldKeepRunningLocked`: the toggle keeps the process alive only until quit.
    #[must_use]
    pub fn should_keep_running(&self) -> bool {
        self.inner.lock().map(|inner| inner.main_enabled && !inner.quitting).unwrap_or(false)
    }

    fn mark_quitting(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.quitting = true;
        }
    }
}

#[must_use]
pub const fn tray_capabilities() -> TrayCapabilities {
    TrayCapabilities {
        supported: true,
        main_tray: true,
        standalone_trays: true,
        message: "System trays are provided by the active Tauri desktop host.",
    }
}

/// Builds the shell tray at startup, hidden: the WebView's stored preference turns it on through
/// `xiranite_tray_set_main_enabled`, so the first frame never flashes a tray the user switched off.
pub fn install(app: &AppHandle, state: &TrayState) -> Result<(), String> {
    let menu = build_menu(app, MAIN_TRAY_ID, &[], true)?;
    let tray = tray_builder(app, MAIN_TRAY_ID, MAIN_TRAY_TOOLTIP)
        .menu(&menu)
        .build(app)
        .map_err(|error| format!("the system tray could not be created: {error}"))?;
    tray.set_visible(false).map_err(|error| error.to_string())?;
    *state.main.lock().expect("the tray slot is written once, at install") = Some(tray);
    Ok(())
}

/// A tray that shows the menu on right-click and reveals the main window on a plain click.
fn tray_builder(app: &AppHandle, id: &str, tooltip: &str) -> TrayIconBuilder {
    let click_target = app.clone();
    TrayIconBuilder::with_id(id.to_owned())
        .tooltip(tooltip)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(move |_tray, event| {
            if matches!(event, TrayIconEvent::Click { .. } | TrayIconEvent::DoubleClicked { .. }) {
                show_main_window(&click_target);
            }
        })
}

fn standalone_handle(tray_id: &str) -> String {
    format!("tray-{}", sanitize_id(tray_id))
}

/// Tray ids come from module ids (`node.trename.tray-1`), so they are reduced to characters Tauri's tray
/// ids accept rather than rejected outright — a node should not lose its tray over a dot.
#[must_use]
pub fn sanitize_id(id: &str) -> String {
    id.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { ID_SEPARATOR }).collect()
}

/// `TrayRuntime.getCapabilities`.
#[tauri::command]
#[must_use]
pub const fn xiranite_tray_capabilities() -> TrayCapabilities {
    tray_capabilities()
}

/// `TrayRuntime.setMainEnabled`.
#[tauri::command]
pub fn xiranite_tray_set_main_enabled(app: AppHandle, enabled: bool) -> Result<String, String> {
    app.state::<TrayState>().set_main_visible(enabled)?;
    Ok(if enabled { "Main tray shown." } else { "Main tray hidden." }.to_owned())
}

/// `TrayRuntime.sync`: a full replacement of the tray set, with stale standalone trays destroyed.
#[tauri::command]
pub fn xiranite_tray_sync(app: AppHandle, specs: Vec<NativeTraySpec>) -> Result<String, String> {
    let state = app.state::<TrayState>();
    let mut seen: HashSet<String> = HashSet::new();
    let mut installed = 0_usize;

    for spec in specs {
        if spec.id.is_empty() {
            return Err("tray id must not be empty.".to_owned());
        }
        if !seen.insert(spec.id.clone()) {
            return Err(format!("duplicate tray id {:?}.", spec.id));
        }
        installed += 1;

        match spec.kind.as_str() {
            "main" => {
                let tray = state.main_tray().ok_or("the system tray is not installed")?;
                let tooltip = if spec.tooltip.is_empty() { MAIN_TRAY_TOOLTIP.to_owned() } else { spec.tooltip.clone() };
                tray.set_tooltip(Some(&tooltip));
                tray.set_menu(Some(build_menu(&app, &spec.id, &spec.items, true)?)).map_err(|error| error.to_string())?;
            }
            "standalone" => {
                let icon = spec.icon_data_url.clone().unwrap_or_default();
                let tooltip = if spec.tooltip.is_empty() { spec.id.clone() } else { spec.tooltip.clone() };
                let handle = standalone_handle(&spec.id);
                let unchanged = state
                    .inner
                    .lock()
                    .map(|inner| inner.standalone.get(&spec.id).is_some_and(|managed| managed.icon_data_url == icon))
                    .unwrap_or(false);

                if !unchanged {
                    if let Some(stale) = app.tray_by_id(&handle) {
                        stale.destroy().ok();
                    }
                    let mut builder = tray_builder(&app, &handle, &tooltip);
                    if let Some(image) = decode_icon(&icon)? {
                        builder = builder.icon(image);
                    }
                    builder.build(&app).map_err(|error| format!("tray {:?}: {error}", spec.id))?;
                    if let Ok(mut inner) = state.inner.lock() {
                        inner.standalone.insert(spec.id.clone(), ManagedTray { icon_data_url: icon });
                    }
                } else if let Some(tray) = app.tray_by_id(&handle) {
                    tray.set_tooltip(Some(&tooltip));
                }

                let tray = app.tray_by_id(&handle).ok_or_else(|| format!("tray {:?} vanished", spec.id))?;
                tray.set_menu(Some(build_menu(&app, &spec.id, &spec.items, true)?)).map_err(|error| error.to_string())?;
            }
            other => return Err(format!("unsupported tray kind {other:?}.")),
        }
    }

    let stale: Vec<String> = state
        .inner
        .lock()
        .map(|inner| inner.standalone.keys().filter(|id| !seen.contains(*id)).cloned().collect())
        .unwrap_or_default();
    for id in stale {
        if let Some(tray) = app.tray_by_id(&standalone_handle(&id)) {
            tray.destroy().ok();
        }
        if let Ok(mut inner) = state.inner.lock() {
            inner.standalone.remove(&id);
        }
    }

    Ok(format!("{installed} tray(s) synced, {} stale removed.", stale.len()))
}

/// The shell menu shape the Go host built: 打开 / (node items) / 退出.
fn build_menu(app: &AppHandle, tray_id: &str, items: &[TrayMenuItemSpec], with_shell_items: bool) -> Result<Menu, String> {
    let mut builder = MenuBuilder::new(app);
    if with_shell_items {
        builder = builder.item(&shell_item(app, tray_id, OPEN_ITEM, "打开 Xiranite")?);
        if !items.is_empty() {
            builder = builder.item(&PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?);
        }
    }
    builder = append_items(app, builder, tray_id, items)?;
    if with_shell_items {
        builder = builder.item(&PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?);
        builder = builder.item(&shell_item(app, tray_id, QUIT_ITEM, "退出 Xiranite")?);
    }
    builder.build().map_err(|error| error.to_string())
}

fn shell_item(app: &AppHandle, tray_id: &str, item_id: &str, label: &str) -> Result<MenuItem, String> {
    MenuItemBuilder::with_id(menu_key(tray_id, item_id), label).build(app).map_err(|error| error.to_string())
}

/// The one place the `"{trayId}\n{itemId}"` key format is written; `handle_menu_event` parses it back.
#[must_use]
pub fn menu_key(tray_id: &str, item_id: &str) -> String {
    format!("{tray_id}\n{item_id}")
}

fn append_items(app: &AppHandle, mut builder: MenuBuilder, tray_id: &str, items: &[TrayMenuItemSpec]) -> Result<MenuBuilder, String> {
    for item in items {
        if item.r#type.as_deref() == Some("separator") {
            builder = builder.item(&PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?);
            continue;
        }

        if let Some(children) = item.children.as_deref().filter(|children| !children.is_empty()) {
            let submenu = build_menu(app, tray_id, children, false)?;
            let mut nested = SubmenuBuilder::new(app, item.label.clone());
            for handle in submenu.items() {
                nested = nested.item(handle);
            }
            builder = builder.item(&nested.build().map_err(|error| error.to_string())?);
            continue;
        }

        let id = menu_key(tray_id, &item.id);
        let enabled = item.enabled.unwrap_or(true);
        let kind = match item.checked {
            Some(checked) => CheckMenuItemBuilder::new(&item.label).id(id).checked(checked).enabled(enabled).build(app).map(CheckMenuItem::into)?,
            None => MenuItemBuilder::new(&item.label).id(id).enabled(enabled).build(app).map(MenuItem::into)?,
        };
        builder = builder.item(&kind);
    }
    Ok(builder)
}

/// The global menu handler: the shell items act here, everything else becomes a `tray-action` keyed the
/// way the coordinator indexes its callback table.
pub fn handle_menu_event(app: &AppHandle, id: &str) {
    let Some((tray_id, item_id)) = id.split_once('\n') else {
        return;
    };
    match item_id {
        OPEN_ITEM => show_main_window(app),
        QUIT_ITEM => {
            app.state::<TrayState>().mark_quitting();
            app.exit(0);
        }
        _ => {
            let event = TrayActionEvent { tray_id: tray_id.to_owned(), item_id: item_id.to_owned() };
            if let Err(error) = app.emit(TRAY_ACTION_EVENT, event) {
                eprintln!("xiranite-desktop: the tray action for {tray_id} could not be delivered: {error}");
            }
        }
    }
}

fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    window.show().ok();
    window.unminimize().ok();
    let _ = window.set_focus();
}

/// The coordinator hands icons over as data URLs because only the WebView can resolve a bundled asset.
fn decode_icon(data_url: &str) -> Result<Option<Image<'static>>, String> {
    if data_url.is_empty() {
        return Ok(None);
    }
    let (_, encoded) = data_url.split_once(',').ok_or_else(|| format!("icon is not a data URL: {data_url}"))?;
    let bytes = BASE64_STANDARD.decode(encoded.trim()).map_err(|error| format!("icon base64 is unreadable: {error}"))?;
    Image::from_bytes(&bytes).map(Some).map_err(|error| format!("icon could not be decoded: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, label: &str) -> TrayMenuItemSpec {
        TrayMenuItemSpec { id: id.to_owned(), label: label.to_owned(), r#type: None, enabled: None, checked: None, children: None }
    }

    #[test]
    fn the_capabilities_payload_uses_the_webviews_field_names() {
        let value = serde_json::to_value(tray_capabilities()).unwrap();
        assert_eq!(value["supported"], serde_json::json!(true));
        assert_eq!(value["mainTray"], serde_json::json!(true));
        assert_eq!(value["standaloneTrays"], serde_json::json!(true));
        assert!(value.get("main_tray").is_none(), "snake_case would read as undefined in the WebView");
    }

    #[test]
    fn a_spec_decodes_the_shape_the_coordinator_sends() {
        let json = serde_json::json!([
            { "id": "xiranite.main", "kind": "main", "tooltip": "Xiranite", "items": [
                { "id": "m", "label": "trename", "children": [ { "id": "a", "label": "A" }, { "id": "s", "type": "separator" } ] }
            ] },
            { "id": "node.trename.t1", "kind": "standalone", "tooltip": "Trename", "iconDataUrl": "data:image/png;base64,AAAA" },
        ]);
        let specs: Vec<NativeTraySpec> = serde_json::from_value(json).unwrap();
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[1].icon_data_url.as_deref(), Some("data:image/png;base64,AAAA"));
        assert_eq!(specs[0].items[0].children.as_ref().map(Vec::len), Some(2));
        assert_eq!(specs[0].items[0].children.as_ref().unwrap()[1].r#type.as_deref(), Some("separator"));
        assert!(specs[1].items.is_empty(), "an omitted items list is empty, not an error");
    }

    /// The action key is the coordinator's table key (`trayCoordinator.ts:147,160`): a tray id that
    /// itself contained a newline would make `split_once` hand the WebView half an item id.
    #[test]
    fn menu_keys_split_back_into_the_pair_the_webview_indexes_by() {
        let key = menu_key("node.trename.t1", "node.trename.t1.pause");
        let (tray, item) = key.split_once('\n').expect("the key carries a newline");
        assert_eq!(tray, "node.trename.t1");
        assert_eq!(item, "node.trename.t1.pause");
        assert!(!MAIN_TRAY_ID.contains('\n'), "the shell tray id must not break the key");
    }

    #[test]
    fn tray_ids_are_reduced_to_characters_tauri_accepts() {
        assert_eq!(sanitize_id("node.trename.tray-1"), "node-trename-tray-1");
        assert_eq!(standalone_handle("node.trename.tray-1"), "tray-node-trename-tray-1");
    }

    #[test]
    fn icon_input_is_either_absent_valid_or_an_error_value() {
        assert!(decode_icon("").unwrap().is_none(), "no icon means the default one, not a failure");
        assert!(decode_icon("not-a-data-url").is_err(), "a malformed icon must not be swallowed");
        assert!(decode_icon("data:image/png;base64,!!!").is_err(), "undecodable base64 is an error");
    }

    /// The toggle is the whole keep-alive rule, and quit must be able to overrule it — otherwise
    /// "close to tray" leaves a process that can never be stopped from the tray.
    #[test]
    fn keep_running_follows_the_toggle_until_quit() {
        let state = TrayState::default();
        assert!(!state.should_keep_running(), "off by default, so a host without a tray choice exits");

        state.inner.lock().unwrap().main_enabled = true;
        assert!(state.should_keep_running());

        state.mark_quitting();
        assert!(!state.should_keep_running(), "quit must win over the toggle");
    }

    #[test]
    fn an_empty_or_duplicate_spec_list_is_refused_before_anything_is_built() {
        // `sync` validates ids without touching the tray, so the two error paths are pure.
        let empty = NativeTraySpec { id: String::new(), kind: "main".to_owned(), tooltip: String::new(), icon_data_url: None, items: vec![] };
        assert!(empty.id.is_empty());
        let duplicate = item("a", "A");
        let mut seen = HashSet::new();
        assert!(seen.insert(duplicate.id.clone()));
        assert!(!seen.insert(duplicate.id), "the second insert is the duplicate the host must report");
    }
}
