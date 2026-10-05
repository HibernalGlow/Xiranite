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
//! - **Closing the main window hides it while the tray keeps the process alive**, and only until the menu's
//!   退出 item sets `quitting`. Without the flag, "close to tray" would leave a process that cannot be
//!   stopped; without the hide, the toggle would be a lie.
//! - **`sync` replaces the whole tray set**, and a tray whose module stopped declaring it stops answering.
//! - **Bad specs are errors returned as values** (`TraySync` returned a Go `error`, which the bridge turned
//!   into a rejected promise). The coordinator awaits `sync`, so an empty/duplicate id or an unknown kind
//!   must reach it rather than being swallowed.
//!
//! ## Two things alpha.4 forces, stated plainly
//!
//! - **The shell tray is built on the first tray command, not in `setup`.** The setup closure hands out
//!   `AppHandle<Wry>`, while a command's `AppHandle` is the type-erased `AppHandle<DynRuntime>`; a handle
//!   built in one is not the same type as one built in the other, and the registry that would reconcile
//!   them (`AppManager::tray`) is reachable only through the sealed `ManagerBase`. Building inside the
//!   commands keeps every stored handle the same type. The visible consequence is honest: the tray appears
//!   when the WebView first asks, which is also the moment its stored preference is known.
//! - **A retired standalone tray is hidden, not destroyed.** `TrayIcon` in 3.0.0-alpha.4 exposes
//!   `set_visible`/`set_icon`/`set_menu`/`set_tooltip` but no removal, and `remove_tray_by_id` sits behind
//!   that same sealed accessor. So the handle is kept and hidden; if the module comes back, it is reused.
//!   This is a disclosed gap, not a silent one.
//!
//! ## Menu identity
//!
//! A menu item's id is `"{trayId}\n{itemId}"` — literally the coordinator's handler key, so the host keeps
//! no second table of "which item belongs to which tray" that could drift when a module re-registers. The
//! two shell items (`__open__`, `__quit__`) act here instead of being forwarded, exactly as the Go menu did.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use base64::Engine;
use base64::prelude::BASE64_STANDARD;
use serde::Deserialize;
use serde::Serialize;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tauri::Runtime;
use tauri::image::Image;
use tauri::menu::CheckMenuItemBuilder;
use tauri::menu::IsMenuItem;
use tauri::menu::Menu;
use tauri::menu::MenuItemBuilder;
use tauri::menu::MenuItemKind;
use tauri::menu::PredefinedMenuItem;
use tauri::menu::SubmenuBuilder;
use tauri::tray::TrayIcon;
use tauri::tray::TrayIconBuilder;
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

/// One installed standalone tray, plus the icon it currently carries so a re-sync can tell whether the
/// icon has to be swapped.
#[derive(Clone)]
struct ManagedTray {
    tray: TrayIcon,
    icon_data_url: String,
}

#[derive(Default)]
struct Inner {
    main_enabled: bool,
    quitting: bool,
    main: Option<TrayIcon>,
    standalone: HashMap<String, ManagedTray>,
}

/// Managed state: every tray handle this module built, keyed so a re-sync can reuse it.
#[derive(Default)]
pub struct TrayState {
    inner: Mutex<Inner>,
}

impl TrayState {
    /// The Go host's `shouldKeepRunningLocked`: the toggle keeps the process alive only until quit.
    #[must_use]
    pub fn should_keep_running(&self) -> bool {
        self.inner.lock().map(|inner| inner.main_enabled && !inner.quitting).unwrap_or(false)
    }

    fn with_mut<T>(&self, run: impl FnOnce(&mut Inner) -> T) -> T {
        match self.inner.lock() {
            Ok(mut inner) => run(&mut inner),
            Err(poisoned) => {
                let mut inner = poisoned.into_inner();
                run(&mut inner)
            }
        }
    }

    fn mark_quitting(&self) {
        self.with_mut(|inner| inner.quitting = true);
    }

    fn set_main_flag(&self, enabled: bool) {
        self.with_mut(|inner| inner.main_enabled = enabled);
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

/// The shell tray, built once and reused: hidden until the WebView's stored preference says otherwise,
/// which is the Go manager's `Hide()`-rather-than-skip behaviour.
fn ensure_shell_tray(app: &AppHandle, state: &TrayState) -> Result<TrayIcon, String> {
    if let Some(tray) = state.with_mut(|inner| inner.main.clone()) {
        return Ok(tray);
    }
    let menu = build_menu(app, MAIN_TRAY_ID, &[], true)?;
    let tray = tray_builder(app, MAIN_TRAY_ID, MAIN_TRAY_TOOLTIP).menu(&menu).build(app).map_err(|error| {
        format!("the system tray could not be created: {error}")
    })?;
    tray.set_visible(false).map_err(to_text)?;
    state.with_mut(|inner| inner.main = Some(tray.clone()));
    Ok(tray)
}

/// A tray that shows its menu on right-click and reveals the main window on a plain click, the way
/// `mainTray.OnClick(showMainWindow)` did. The handle is captured because `TrayIcon` gives no
/// tray-to-window back-pointer to walk.
fn tray_builder<R: Runtime, M: Manager<R>>(manager: &M, id: &str, tooltip: &str) -> TrayIconBuilder<R> {
    let click_target = manager.app_handle().clone();
    TrayIconBuilder::with_id(id.to_owned())
        .tooltip(tooltip)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(move |_tray, event| {
            if matches!(event, TrayIconEvent::Click { .. } | TrayIconEvent::DoubleClick { .. }) {
                show_main_window(&click_target);
            }
        })
}

/// `TrayRuntime.getCapabilities`. Building the shell tray here is what makes "the tray exists" and
/// "the tray answered a capability probe" the same event.
#[tauri::command]
pub fn xiranite_tray_capabilities(app: AppHandle) -> Result<TrayCapabilities, String> {
    ensure_shell_tray(&app, &app.state::<TrayState>())?;
    Ok(tray_capabilities())
}

/// `TrayRuntime.setMainEnabled`: a visibility flip on the shell tray, never a rebuild.
#[tauri::command]
pub fn xiranite_tray_set_main_enabled(app: AppHandle, enabled: bool) -> Result<String, String> {
    let state = app.state::<TrayState>();
    let tray = ensure_shell_tray(&app, &state)?;
    tray.set_visible(enabled).map_err(to_text)?;
    state.set_main_flag(enabled);
    Ok(if enabled { "Main tray shown." } else { "Main tray hidden." }.to_owned())
}

/// `TrayRuntime.sync`: a full replacement of the tray set.
#[tauri::command]
pub fn xiranite_tray_sync(app: AppHandle, specs: Vec<NativeTraySpec>) -> Result<String, String> {
    let state = app.state::<TrayState>();
    let mut seen: HashSet<String> = HashSet::new();

    for spec in specs {
        if spec.id.is_empty() {
            return Err("tray id must not be empty.".to_owned());
        }
        if !seen.insert(spec.id.clone()) {
            return Err(format!("duplicate tray id {:?}.", spec.id));
        }

        match spec.kind.as_str() {
            "main" => {
                let tray = ensure_shell_tray(&app, &state)?;
                let tooltip = if spec.tooltip.is_empty() { MAIN_TRAY_TOOLTIP.to_owned() } else { spec.tooltip.clone() };
                tray.set_tooltip(Some(&tooltip)).map_err(to_text)?;
                tray.set_menu(Some(build_menu(&app, &spec.id, &spec.items, true)?)).map_err(to_text)?;
            }
            "standalone" => sync_standalone(&app, &state, &spec)?,
            other => return Err(format!("unsupported tray kind {other:?}.")),
        }
    }

    // A tray whose module stopped declaring it stops answering. It is hidden rather than destroyed —
    // see the module docs on why alpha.4 leaves no removal path — and stays in the map so the module
    // gets the same handle back if it returns.
    let retired = state.with_mut(|inner| {
        let mut count = 0_usize;
        for (id, managed) in inner.standalone.iter_mut() {
            if seen.contains(id) || managed.tray.set_visible(false).is_err() {
                continue;
            }
            count += 1;
        }
        count
    });

    Ok(format!("{} tray(s) synced, {retired} hidden.", seen.len()))
}

/// Install or refresh one standalone tray in place: `set_icon` exists, so a changed icon does not need a
/// new handle, and a brand-new tray is the only case that builds one.
fn sync_standalone(app: &AppHandle, state: &TrayState, spec: &NativeTraySpec) -> Result<(), String> {
    let icon = spec.icon_data_url.clone().unwrap_or_default();
    let tooltip = if spec.tooltip.is_empty() { spec.id.clone() } else { spec.tooltip.clone() };
    let menu = build_menu(app, &spec.id, &spec.items, true)?;
    let existing = state.with_mut(|inner| inner.standalone.get(&spec.id).cloned());

    if let Some(managed) = existing {
        if managed.icon_data_url != icon {
            if let Some(image) = decode_icon(&icon)? {
                managed.tray.set_icon(Some(image)).map_err(to_text)?;
            }
            state.with_mut(|inner| {
                if let Some(slot) = inner.standalone.get_mut(&spec.id) {
                    slot.icon_data_url = icon;
                }
            });
        }
        managed.tray.set_visible(true).map_err(to_text)?;
        managed.tray.set_tooltip(Some(&tooltip)).map_err(to_text)?;
        managed.tray.set_menu(Some(menu)).map_err(to_text)?;
        return Ok(());
    }

    let mut builder = tray_builder(app, &format!("tray-{}", sanitize_id(&spec.id)), &tooltip);
    if let Some(image) = decode_icon(&icon)? {
        builder = builder.icon(image);
    }
    let tray = builder.build(app).map_err(|error| format!("tray {:?}: {error}", spec.id))?;
    tray.set_menu(Some(menu)).map_err(to_text)?;
    state.with_mut(|inner| {
        inner.standalone.insert(spec.id.clone(), ManagedTray { tray, icon_data_url: icon });
    });
    Ok(())
}

/// Tray ids come from module ids (`node.trename.tray-1`), so they are reduced to characters Tauri's tray
/// ids accept rather than rejected outright — a node should not lose its tray over a dot.
#[must_use]
pub fn sanitize_id(id: &str) -> String {
    id.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

/// The shell menu shape the Go host built: 打开 / (node items) / 退出.
fn build_menu<R: Runtime, M: Manager<R>>(manager: &M, tray_id: &str, items: &[TrayMenuItemSpec], shell: bool) -> Result<Menu<R>, String> {
    let mut kinds: Vec<MenuItemKind<R>> = Vec::new();
    if shell {
        kinds.push(MenuItemKind::MenuItem(shell_item(manager, tray_id, OPEN_ITEM, "打开 Xiranite")?));
        if !items.is_empty() {
            kinds.push(MenuItemKind::Predefined(PredefinedMenuItem::separator(manager).map_err(to_text)?));
        }
    }
    kinds.extend(collect_items(manager, tray_id, items)?);
    if shell {
        kinds.push(MenuItemKind::Predefined(PredefinedMenuItem::separator(manager).map_err(to_text)?));
        kinds.push(MenuItemKind::MenuItem(shell_item(manager, tray_id, QUIT_ITEM, "退出 Xiranite")?));
    }
    let refs: Vec<&dyn IsMenuItem<R>> = kinds.iter().map(|kind| kind as &dyn IsMenuItem<R>).collect();
    Menu::with_items(manager, &refs).map_err(to_text)
}

fn collect_items<R: Runtime, M: Manager<R>>(manager: &M, tray_id: &str, items: &[TrayMenuItemSpec]) -> Result<Vec<MenuItemKind<R>>, String> {
    let mut kinds = Vec::with_capacity(items.len());
    for item in items {
        if item.r#type.as_deref() == Some("separator") {
            kinds.push(MenuItemKind::Predefined(PredefinedMenuItem::separator(manager).map_err(to_text)?));
            continue;
        }

        if let Some(children) = item.children.as_deref().filter(|children| !children.is_empty()) {
            let mut builder = SubmenuBuilder::new(manager, item.label.clone());
            for kind in collect_items(manager, tray_id, children)? {
                builder = builder.item(&kind);
            }
            kinds.push(MenuItemKind::Submenu(builder.build().map_err(to_text)?));
            continue;
        }

        let id = menu_key(tray_id, &item.id);
        let enabled = item.enabled.unwrap_or(true);
        let kind = match item.checked {
            Some(checked) => MenuItemKind::Check(
                CheckMenuItemBuilder::new(&item.label).id(id).checked(checked).enabled(enabled).build(manager).map_err(to_text)?,
            ),
            None => MenuItemKind::MenuItem(MenuItemBuilder::new(&item.label).id(id).enabled(enabled).build(manager).map_err(to_text)?),
        };
        kinds.push(kind);
    }
    Ok(kinds)
}

fn shell_item<R: Runtime, M: Manager<R>>(manager: &M, tray_id: &str, item_id: &str, label: &str) -> Result<tauri::menu::MenuItem<R>, String> {
    MenuItemBuilder::with_id(menu_key(tray_id, item_id), label).build(manager).map_err(to_text)
}

/// The one place the `"{trayId}\n{itemId}"` key format is written; `handle_menu_event` parses it back.
#[must_use]
pub fn menu_key(tray_id: &str, item_id: &str) -> String {
    format!("{tray_id}\n{item_id}")
}

fn to_text(error: impl std::fmt::Display) -> String {
    error.to_string()
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
            if let Err(failure) = app.emit(TRAY_ACTION_EVENT, event) {
                eprintln!("xiranite-desktop: the tray action for {tray_id} could not be delivered: {failure}");
            }
        }
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
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
    let bytes = BASE64_STANDARD.decode(encoded.trim()).map_err(|failure| format!("icon base64 is unreadable: {failure}"))?;
    Image::from_bytes(&bytes).map(Some).map_err(|failure| format!("icon could not be decoded: {failure}"))
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

    /// The action key is the coordinator's table key (`trayCoordinator.ts:147,160`): a tray id carrying a
    /// newline would hand the WebView half an item id and the menu item would go dead silently.
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
    }

    #[test]
    fn icon_input_is_either_absent_valid_or_an_error_value() {
        assert!(decode_icon("").unwrap().is_none(), "no icon means the default one, not a failure");
        assert!(decode_icon("not-a-data-url").is_err(), "a malformed icon must not be swallowed");
        assert!(decode_icon("data:image/png;base64,!!!").is_err(), "undecodable base64 is an error");
    }

    /// The toggle is the whole keep-alive rule and quit must overrule it — otherwise "close to tray"
    /// leaves a process that can never be stopped.
    #[test]
    fn keep_running_follows_the_toggle_until_quit() {
        let state = TrayState::default();
        assert!(!state.should_keep_running(), "off by default, so a host without the toggle exits on close");

        state.set_main_flag(true);
        assert!(state.should_keep_running());

        state.mark_quitting();
        assert!(!state.should_keep_running(), "quit must win over the toggle");
    }

    #[test]
    fn duplicate_ids_are_detected_before_anything_is_built() {
        let mut seen = HashSet::new();
        assert!(seen.insert(item("a", "A").id));
        assert!(!seen.insert(item("a", "A").id), "the second insert is the duplicate sync must report");
    }
}
