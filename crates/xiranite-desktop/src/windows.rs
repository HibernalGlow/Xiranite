//! Native windows for the desktop shell: the window half of the retired Wails bridge, re-homed in Tauri.
//!
//! ## What this module is the contract for
//!
//! `src/backend/runtime/runtime.ts:126` (`WindowRuntime`) is the surface the React app programs against,
//! and it survived the Wails deletion unchanged: `getCapabilities`, `controlMain`, `controlComponent`,
//! `openComponent`, `focus`, `close`, `openDevTools`, `getFrame`, `setFrame`, `subscribeFrameChanges`.
//! Every command here answers one of those, with the same *field spellings* and the same *state
//! vocabulary* (`normal|maximized|fullscreen|minimized|closed`) the Go host returned, because
//! `src/backend/services/windowService.ts` and `src/hooks/useWindowControls.ts` read them by name.
//!
//! Two decisions are copied from the deleted `service.go` rather than reinvented:
//!
//! - **A component window is the same bundle at the same origin, scoped by URL query.** The Go host
//!   opened `/?floatingComponent=<id>&moduleId=&title=&windowId=[&workspaceId=]`, and `src/App.tsx` still
//!   switches on `floatingComponent` to render `FloatingComponentWindow`. `WebviewUrl::App` is joined onto
//!   the app URL (`manager/webview.rs:463` → `Url::join`), so the query survives in dev (`devUrl`) and in
//!   production (`tauri://localhost`) without a second frontend entry point — and a per-node entry point
//!   is exactly what ADR-0069 retired. This is also why the AGENTS.md precondition holds by construction:
//!   the deleted `StandaloneNodeApp` had its own boot path and never called `diagnoseHostRequirements`
//!   (`docs/plugin-architecture.md`, ADR-0069), while a window that loads the shared document goes through
//!   `ModuleRenderer`'s host-requirement gate like every other view. There is no second shell to drift.
//! - **Opening an already-open component focuses it** instead of stacking a duplicate, answering
//!   `success:true, "Focused existing component window."`.
//!
//! ## Who paints the caption buttons is the resolved config, not this module
//!
//! The base `tauri.conf.json` asks for `decorations: false`, so on Windows and Linux the window chrome
//! lives in the app's own top bar (`TopBar`, `FloatingWindowFrame` draw the close/maximize/minimize
//! glyphs). macOS adds `tauri.macos.conf.json` on top of it (Tauri merges the per-platform file with a
//! JSON merge patch at build time) and switches to a decorated window with a transparent, title-less
//! `Overlay` title bar: the content still runs to the top edge, but the three traffic lights are real
//! AppKit buttons at the inset that file names.
//!
//! So this module does not decide the caption flavor — it reads it back out of `app.config()` and hands
//! it to the WebView as `captionOwner`, which is what tells the renderer whether to draw buttons and how
//! wide the reserved band is. That is deliberate: `WebviewWindow` has no decorations getter, and a second
//! hardcoded answer here would drift from the config the moment someone edits the flavor file.
//! [`caption_state_of`] is the one derivation, and [`xiranite_open_component_window`] builds each node
//! window to the same answer instead of hardcoding `.decorations(false)` again.
//!
//! Because the frame may be gone, dragging is an explicit capability too — `xiranite_window_start_dragging`
//! is the command the top bar calls, since Tauri's `data-tauri-drag-region` handling ships inside the
//! `@tauri-apps/api` script this bundle deliberately does not carry. On macOS an `Overlay` title bar is
//! draggable through that same command; AppKit's own drag area only covers the traffic-light band.
//!
//! ## Labels and the registry
//!
//! `component-<componentId>`, the same prefix the Go host used, because the frame event and the `windowId`
//! query both carry it back to the workspace store. Tauri restricts labels to `[A-Za-z0-9_.:/\\-]`, so
//! [`component_window_label`] refuses anything else rather than escaping it into a different-looking
//! label. The frame event also needs the module and workspace ids, which live in [`ComponentWindows`]
//! rather than being re-derived from the label: a remembered size written against the wrong module id is
//! worse than no size at all.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use serde::Serialize;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;
use tauri::Url;
use tauri::WebviewWindow;
use tauri::Window;
use tauri::utils::config::WindowConfig;

#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;

/// The label prefix for component windows, shared with the `windowId` the WebView is handed.
pub const COMPONENT_WINDOW_PREFIX: &str = "component-";
/// Default size of a component window; the Go host used the same numbers, and a remembered size from the
/// workspace store overrides them when there is one.
pub const COMPONENT_WINDOW_DEFAULT_WIDTH: f64 = 460.0;
pub const COMPONENT_WINDOW_DEFAULT_HEIGHT: f64 = 380.0;
/// Below this a component window stops being usable. The Go host refused to *report* such a frame, so a
/// mid-animation size could never overwrite the remembered one; the same floor is applied at creation.
pub const COMPONENT_WINDOW_MIN_WIDTH: f64 = 360.0;
pub const COMPONENT_WINDOW_MIN_HEIGHT: f64 = 260.0;
/// The event name `subscribeFrameChanges` listens for.
pub const COMPONENT_FRAME_EVENT: &str = "component-window-frame";
/// The window every frame event is addressed to: the workspace that owns the components.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Who draws a window's caption buttons. The renderer branches on this so a decorated macOS window never
/// stacks a second, self-drawn set over the AppKit traffic lights.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptionOwner {
    /// The OS title bar owns them — a decorated window, i.e. the macOS `Overlay` flavor.
    System,
    /// A frameless window: `TopBar` and `FloatingWindowFrame` paint the buttons themselves.
    Renderer,
}

/// Where the OS puts the traffic lights, in logical points, read from the same config AppKit is given.
/// `x` is the left inset of the close button and `y` the gap above it, which is exactly how
/// `inset_traffic_lights` in wry 0.57 treats them. The top bar reserves this band instead of hardcoding
/// its own copy of the numbers.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionInset {
    pub x: f64,
    pub y: f64,
}

/// The caption flavor derived from a window's resolved config.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CaptionState {
    pub owner: CaptionOwner,
    pub inset: Option<CaptionInset>,
}

impl CaptionState {
    /// The fallback when a flavor carries no `app.windows` entry at all: frameless, app-drawn chrome —
    /// what every platform did before the macOS overlay existed.
    #[must_use]
    pub const fn renderer_chrome() -> Self {
        Self { owner: CaptionOwner::Renderer, inset: None }
    }
}

/// `WindowCapabilities` in `runtime.ts:86`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowCapabilities {
    pub supported: bool,
    pub native_window_controls: bool,
    /// The app owns the top bar in both caption modes: `System` still hides the OS title and lets the
    /// web content run to the top edge. `captionOwner` is the field that says who paints the buttons.
    pub frameless: bool,
    pub caption_owner: CaptionOwner,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caption_inset: Option<CaptionInset>,
    /// `"native"` is what makes `FloatingWindowFrame` render real buttons instead of the DOM fallback.
    pub component_windows: &'static str,
    pub message: &'static str,
}

/// `WindowCommandResult` in `runtime.ts:94`. Errors are *values*, not exceptions: the service layer
/// already wraps throws, and the Go host answered "not tracked"/"not ready" as a result object.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowCommandResult {
    pub success: bool,
    pub supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<&'static str>,
}

/// `WindowFrame` in `runtime.ts:102`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// `OpenComponentWindowInput` in `runtime.ts:117`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenComponentWindowInput {
    pub component_id: String,
    pub module_id: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
}

/// `ComponentWindowFrameEvent` in `runtime.ts:109`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentWindowFrameEvent {
    pub component_id: String,
    pub module_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    pub width: f64,
    pub height: f64,
}

/// What the host remembers about each component window it opened.
#[derive(Debug, Clone)]
struct ComponentWindowMeta {
    component_id: String,
    module_id: String,
    workspace_id: Option<String>,
}

/// Managed state keyed by window label. `main.rs` installs one instance; the commands and the window
/// event forwarder are its only readers, so no lock is held across a Tauri call.
#[derive(Default)]
pub struct ComponentWindows {
    open: Mutex<HashMap<String, ComponentWindowMeta>>,
}

impl ComponentWindows {
    #[must_use]
    pub fn new() -> Self {
        Self { open: Mutex::new(HashMap::new()) }
    }

    fn remember(&self, label: &str, input: &OpenComponentWindowInput) {
        let meta = ComponentWindowMeta {
            component_id: input.component_id.clone(),
            module_id: input.module_id.clone(),
            workspace_id: input.workspace_id.clone(),
        };
        if let Ok(mut open) = self.open.lock() {
            open.insert(label.to_owned(), meta);
        }
    }

    #[must_use]
    pub fn meta(&self, label: &str) -> Option<ComponentWindowFrameEvent> {
        let open = self.open.lock().ok()?;
        let meta = open.get(label)?;
        Some(ComponentWindowFrameEvent {
            component_id: meta.component_id.clone(),
            module_id: meta.module_id.clone(),
            workspace_id: meta.workspace_id.clone(),
            width: 0.0,
            height: 0.0,
        })
    }

    pub fn forget(&self, label: &str) {
        if let Ok(mut open) = self.open.lock() {
            open.remove(label);
        }
    }

    /// The labels this host opened, so a test (or a restorer) can ask what is live without a window server.
    #[must_use]
    pub fn labels(&self) -> Vec<String> {
        self.open.lock().map(|open| open.keys().cloned().collect()).unwrap_or_default()
    }
}

#[must_use]
pub const fn window_capabilities(caption: CaptionState) -> WindowCapabilities {
    WindowCapabilities {
        supported: true,
        native_window_controls: true,
        frameless: true,
        caption_owner: caption.owner,
        caption_inset: caption.inset,
        component_windows: "native",
        message: "Tauri runtime controls native windows.",
    }
}

/// The one place that decides who paints the caption buttons: a decorated window lets the OS do it, a
/// frameless one hands the job to the renderer.
///
/// This is a pure function of the *resolved* `WindowConfig`, so `tauri.macos.conf.json` stays the single
/// authority — edit that file and both the window and the WebView change together, with nothing here to
/// update in step.
#[must_use]
pub fn caption_state_of(window: &WindowConfig) -> CaptionState {
    if window.decorations {
        CaptionState {
            owner: CaptionOwner::System,
            inset: window.traffic_light_position.as_ref().map(|position| CaptionInset { x: position.x, y: position.y }),
        }
    } else {
        CaptionState::renderer_chrome()
    }
}

/// The main window's config entry, or the first entry when a flavor renamed it. `None` means the binary
/// carries no configured window, and the caller falls back to [`CaptionState::renderer_chrome`].
///
/// Split out because it is the only part of the lookup that can be tested without a window server.
#[must_use]
pub fn pick_main_window_config(windows: &[WindowConfig]) -> Option<&WindowConfig> {
    windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW_LABEL)
        .or_else(|| windows.first())
}

/// The main window's resolved config entry.
#[must_use]
pub fn main_window_config(app: &AppHandle) -> Option<WindowConfig> {
    pick_main_window_config(&app.config().app.windows).cloned()
}

/// The caption flavor the main window was configured with — what [`xiranite_window_capabilities`] reports
/// and what component windows are built to match.
#[must_use]
pub fn caption_state(app: &AppHandle) -> CaptionState {
    main_window_config(app).as_ref().map(caption_state_of).unwrap_or_else(CaptionState::renderer_chrome)
}

/// The label for a component id, or `None` when the id carries a character Tauri would reject.
#[must_use]
pub fn component_window_label(component_id: &str) -> Option<String> {
    if component_id.is_empty() || !component_id.chars().all(is_label_safe) {
        return None;
    }
    Some(format!("{COMPONENT_WINDOW_PREFIX}{component_id}"))
}

const fn is_label_safe(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':' | '/' | '\\')
}

/// The `?a=b` suffix a component window loads, spelled the way `src/App.tsx` reads it.
///
/// `title` falls back to the module id, matching the Go default. The return value carries its own leading
/// `?` because that is what [`component_window_url`] hands to `WebviewUrl::App`.
pub fn component_window_query(input: &OpenComponentWindowInput, label: &str) -> Result<String, String> {
    let mut url = Url::parse("http://xiranite.invalid/").map_err(|error| error.to_string())?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs
            .append_pair("floatingComponent", &input.component_id)
            .append_pair("moduleId", &input.module_id)
            .append_pair("title", input.title.as_deref().unwrap_or(&input.module_id))
            .append_pair("windowId", label);
        if let Some(workspace_id) = &input.workspace_id {
            pairs.append_pair("workspaceId", workspace_id);
        }
    }
    let query = url.query().ok_or("the component query disappeared")?;
    Ok(format!("?{query}"))
}

/// The `WebviewUrl` for a component window: the app document, plus the scoping query.
pub fn component_window_url(input: &OpenComponentWindowInput, label: &str) -> Result<WebviewUrl, String> {
    Ok(WebviewUrl::App(component_window_query(input, label)?.into()))
}

/// Whether a component window's finished size may be reported to the workspace.
#[must_use]
pub const fn reportable_frame(width: f64, height: f64) -> bool {
    width >= COMPONENT_WINDOW_MIN_WIDTH && height >= COMPONENT_WINDOW_MIN_HEIGHT
}

fn ok(id: Option<String>, message: impl Into<String>, state: Option<&'static str>) -> WindowCommandResult {
    WindowCommandResult { success: true, supported: true, id, message: message.into(), state }
}

fn failed(message: impl Into<String>, id: Option<String>) -> WindowCommandResult {
    WindowCommandResult { success: false, supported: true, id, message: message.into(), state: None }
}

fn not_found(id: &str) -> WindowCommandResult {
    WindowCommandResult {
        success: false,
        supported: true,
        id: Some(id.to_owned()),
        message: "Window is not tracked.".to_owned(),
        state: None,
    }
}

/// Resolves a label with the Go host's empty-means-main-window convention.
fn resolve(app: &AppHandle, id: Option<&str>) -> Option<WebviewWindow> {
    app.get_webview_window(match id {
        Some(label) if !label.is_empty() => label,
        _ => MAIN_WINDOW_LABEL,
    })
}

/// `WindowRuntime.getCapabilities`.
#[tauri::command]
#[must_use]
pub fn xiranite_window_capabilities(app: AppHandle) -> WindowCapabilities {
    window_capabilities(caption_state(&app))
}

/// `WindowRuntime.openComponent`.
#[tauri::command]
pub fn xiranite_open_component_window(app: AppHandle, input: OpenComponentWindowInput) -> WindowCommandResult {
    if input.component_id.trim().is_empty() || input.module_id.trim().is_empty() {
        return failed("componentId and moduleId are required.", None);
    }
    let Some(label) = component_window_label(&input.component_id) else {
        return failed(format!("componentId {:?} cannot be a window label.", input.component_id), None);
    };

    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_focus();
        return ok(Some(label), "Focused existing component window.", Some("normal"));
    }

    let url = match component_window_url(&input, &label) {
        Ok(url) => url,
        Err(error) => return failed(error, Some(label)),
    };
    let width = input.width.unwrap_or(COMPONENT_WINDOW_DEFAULT_WIDTH).max(COMPONENT_WINDOW_MIN_WIDTH);
    let height = input.height.unwrap_or(COMPONENT_WINDOW_DEFAULT_HEIGHT).max(COMPONENT_WINDOW_MIN_HEIGHT);
    // A component window is chrome-identical to the main window: on macOS that means the same native
    // traffic lights at the same inset, and `FloatingComponentWindow` reads the same `captionOwner` to drop
    // its own button cluster. The flavor is read back out of the resolved config instead of being decided
    // here a second time, so `tauri.macos.conf.json` stays the only place that answer is written down.
    let caption = caption_state(&app);
    let builder = WebviewWindowBuilder::new(&app, &label, url)
        .title(input.title.clone().unwrap_or_else(|| input.module_id.clone()))
        .inner_size(width, height)
        .min_inner_size(COMPONENT_WINDOW_MIN_WIDTH, COMPONENT_WINDOW_MIN_HEIGHT)
        .resizable(true)
        .decorations(matches!(caption.owner, CaptionOwner::System));
    #[cfg(target_os = "macos")]
    let builder = match caption.owner {
        CaptionOwner::System => {
            let styled = builder.title_bar_style(TitleBarStyle::Overlay).hidden_title(true);
            match caption.inset {
                Some(inset) => styled.traffic_light_position(tauri::LogicalPosition::new(inset.x, inset.y)),
                None => styled,
            }
        }
        CaptionOwner::Renderer => builder,
    };
    let built = builder.build();

    match built {
        Ok(_) => {
            app.state::<ComponentWindows>().remember(&label, &input);
            ok(Some(label), "Component window opened.", Some("normal"))
        }
        Err(error) => failed(format!("The component window could not be opened: {error}"), Some(label)),
    }
}

/// `WindowRuntime.controlComponent`, and `controlMain` with `id` set to the main window.
#[tauri::command]
pub fn xiranite_window_control(app: AppHandle, id: String, action: String) -> WindowCommandResult {
    let Some(window) = resolve(&app, Some(&id)) else {
        return not_found(&id);
    };
    match action.as_str() {
        // Parity with the Go host's `controlMain`: while the tray keeps the process alive, minimize and
        // close both hide — reporting "closed" for a window that only went away would lie to the
        // workspace restorer, so the state stays `minimized` exactly as `tray_manager.go` returned it.
        "minimize" if hides_to_tray(&app, &id) => apply(window, &id, WebviewWindow::hide, "minimized", "Window hidden to the system tray."),
        "minimize" => apply(window, &id, WebviewWindow::minimize, "minimized", "Window minimized."),
        "maximize" => match window.is_maximized() {
            Ok(true) => apply(window, &id, WebviewWindow::unmaximize, "normal", "Window restored."),
            _ => apply(window, &id, WebviewWindow::maximize, "maximized", "Window maximized."),
        },
        "restore" => apply(window, &id, |window| window.unminimize().and_then(|()| window.show()).and_then(|()| window.unmaximize()), "normal", "Window restored."),
        "toggle-fullscreen" => {
            let next = !window.is_fullscreen().unwrap_or(false);
            match window.set_fullscreen(next) {
                Ok(()) => ok(
                    Some(id),
                    if next { "Window is fullscreen." } else { "Window left fullscreen." },
                    Some(if next { "fullscreen" } else { "normal" }),
                ),
                Err(error) => failed(error.to_string(), Some(id)),
            }
        }
        "close" if hides_to_tray(&app, &id) => apply(window, &id, WebviewWindow::hide, "minimized", "Window hidden to the system tray."),
        "close" => apply(window, &id, WebviewWindow::close, "closed", "Window closed."),
        other => failed(format!("Unsupported window action {other:?}."), Some(id)),
    }
}

/// Whether this window's minimize/close should hide it instead of ending it — the tray's keep-running
/// toggle, and only for the main window (`tray::should_keep_running` already turns false on tray-quit).
fn hides_to_tray(app: &AppHandle, id: &str) -> bool {
    id == MAIN_WINDOW_LABEL && app.state::<crate::tray::TrayState>().should_keep_running()
}

fn apply(
    window: WebviewWindow,
    id: &str,
    operation: impl FnOnce(&WebviewWindow) -> tauri::Result<()>,
    state: &'static str,
    message: &'static str,
) -> WindowCommandResult {
    match operation(&window) {
        Ok(()) => ok(Some(id.to_owned()), message, Some(state)),
        Err(error) => failed(error.to_string(), Some(id.to_owned())),
    }
}

/// `WindowRuntime.focus`.
#[tauri::command]
pub fn xiranite_window_focus(app: AppHandle, id: String) -> WindowCommandResult {
    let Some(window) = resolve(&app, Some(&id)) else {
        return not_found(&id);
    };
    apply(window, &id, WebviewWindow::set_focus, "normal", "Window focused.")
}

/// `WindowRuntime.close`.
#[tauri::command]
pub fn xiranite_window_close(app: AppHandle, id: String) -> WindowCommandResult {
    let Some(window) = resolve(&app, Some(&id)) else {
        return not_found(&id);
    };
    apply(window, &id, WebviewWindow::close, "closed", "Window closed.")
}

/// `WindowRuntime.openDevTools`; an absent id is the main window, like the Go `getWindow("")`.
#[tauri::command]
pub fn xiranite_window_open_devtools(app: AppHandle, id: Option<String>) -> WindowCommandResult {
    let label = id.unwrap_or_else(|| MAIN_WINDOW_LABEL.to_owned());
    let Some(window) = app.get_webview_window(&label) else {
        return not_found(&label);
    };
    window.open_devtools();
    ok(Some(label), "DevTools opened.", Some("normal"))
}

/// `WindowRuntime.getFrame`.
#[tauri::command]
pub fn xiranite_window_get_frame(app: AppHandle, id: Option<String>) -> Option<WindowFrame> {
    let window = resolve(&app, id.as_deref())?;
    Some(frame_of(window.outer_position().ok()?, window.outer_size().ok()?))
}

/// `WindowRuntime.setFrame`.
#[tauri::command]
pub fn xiranite_window_set_frame(app: AppHandle, frame: WindowFrame, id: Option<String>) -> WindowCommandResult {
    let label = id.unwrap_or_default();
    let Some(window) = resolve(&app, Some(&label)) else {
        return not_found(&label);
    };
    use tauri::PhysicalPosition;
    use tauri::PhysicalSize;
    let scale = window.scale_factor().unwrap_or(1.0);
    let size = PhysicalSize::new((frame.width * scale).round() as u32, (frame.height * scale).round() as u32);
    let position = PhysicalPosition::new((frame.x * scale).round() as i32, (frame.y * scale).round() as i32);
    let applied = window.set_size(size).and_then(|()| window.set_position(position));
    match applied {
        Ok(()) => ok((!label.is_empty()).then_some(label), "Window frame applied.", Some("normal")),
        Err(error) => failed(error.to_string(), (!label.is_empty()).then_some(label)),
    }
}

/// The frameless top bar's drag handle: `@tauri-apps/api` is not in the bundle, so the drag region has to
/// reach `WebviewWindow::start_dragging` through a command of ours.
#[tauri::command]
pub fn xiranite_window_start_dragging(app: AppHandle, id: Option<String>) -> WindowCommandResult {
    let label = id.unwrap_or_default();
    let Some(window) = resolve(&app, Some(&label)) else {
        return not_found(&label);
    };
    apply(window, &label, WebviewWindow::start_dragging, "normal", "Window drag started.")
}

/// Forwards a component window's finished resize to the main window as `component-window-frame`, which is
/// what lets the workspace store remember the size. Suppressed while maximised, fullscreen or minimised,
/// and for frames below the usable floor — exactly the guards the Go host's `trackComponentWindowFrame`
/// applied, because a remembered size is written to disk and a bad one outlives the window.
pub fn forward_component_frame_event(window: &Window) {
    let Some(mut event) = window.state::<ComponentWindows>().meta(window.label()) else {
        return;
    };
    let Ok(position) = window.outer_position() else { return };
    let Ok(size) = window.outer_size() else { return };
    let frame = frame_of(position, size);
    if window.is_maximized().unwrap_or(false)
        || window.is_fullscreen().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
        || !reportable_frame(frame.width, frame.height)
    {
        return;
    }
    event.width = frame.width;
    event.height = frame.height;
    if let Err(error) = window.emit_to(MAIN_WINDOW_LABEL, COMPONENT_FRAME_EVENT, &event) {
        eprintln!("xiranite-desktop: the frame event for {} could not be delivered: {error}", window.label());
    }
}

/// Drops the registry entry once a component window is gone, so a later open is a real open.
pub fn forget_component_window(window: &Window) {
    if window.label().starts_with(COMPONENT_WINDOW_PREFIX) {
        window.state::<ComponentWindows>().forget(window.label());
    }
}

/// The frame math, spelled over the two readings `Window` and `WebviewWindow` both expose, so the command
/// path and the event path cannot disagree about what `x/y/width/height` mean.
#[must_use]
pub const fn frame_of(position: tauri::PhysicalPosition<i32>, size: tauri::PhysicalSize<u32>) -> WindowFrame {
    WindowFrame {
        x: position.x as f64,
        y: position.y as f64,
        width: size.width as f64,
        height: size.height as f64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::utils::config::LogicalPosition;

    fn input(component: &str, module: &str) -> OpenComponentWindowInput {
        OpenComponentWindowInput {
            component_id: component.to_owned(),
            module_id: module.to_owned(),
            workspace_id: None,
            title: None,
            width: None,
            height: None,
        }
    }

    #[test]
    fn the_label_keeps_the_prefix_the_restorer_names() {
        assert_eq!(component_window_label("cmp-7").as_deref(), Some("component-cmp-7"));
    }

    /// A label Tauri would reject must be refused, not escaped into something else.
    #[test]
    fn unsafe_component_ids_are_refused() {
        assert_eq!(component_window_label(""), None);
        assert_eq!(component_window_label("a b"), None);
        assert_eq!(component_window_label("?x=1"), None);
        assert_eq!(component_window_label("#frag"), None);
    }

    #[test]
    fn the_window_query_carries_the_parameter_the_app_switches_on() {
        let query = component_window_query(&input("cmp-7", "node:trename"), "component-cmp-7").unwrap();
        assert!(query.starts_with('?'), "{query}");
        let parsed = Url::parse(&format!("http://xiranite.invalid/{query}")).unwrap();
        let pairs: Vec<(String, String)> = parsed.query_pairs().into_owned().collect();
        assert!(pairs.contains(&("floatingComponent".to_owned(), "cmp-7".to_owned())), "{pairs:?}");
        assert!(pairs.contains(&("moduleId".to_owned(), "node:trename".to_owned())), "{pairs:?}");
        assert!(pairs.contains(&("windowId".to_owned(), "component-cmp-7".to_owned())), "{pairs:?}");
        assert!(pairs.contains(&("title".to_owned(), "node:trename".to_owned())), "title falls back to the module id");
        assert!(!pairs.iter().any(|(key, _)| key == "workspaceId"), "absent stays absent");
    }

    #[test]
    fn an_explicit_workspace_and_title_survive_the_round_trip() {
        let mut request = input("cmp-7", "node:trename");
        request.workspace_id = Some("ws 1".to_owned());
        request.title = Some("重命名".to_owned());
        let query = component_window_query(&request, "component-cmp-7").unwrap();
        let parsed = Url::parse(&format!("http://xiranite.invalid/{query}")).unwrap();
        let pairs: Vec<(String, String)> = parsed.query_pairs().into_owned().collect();
        assert!(pairs.contains(&("workspaceId".to_owned(), "ws 1".to_owned())), "{pairs:?}");
        assert!(pairs.contains(&("title".to_owned(), "重命名".to_owned())), "{pairs:?}");
    }

    /// `WebviewUrl::App` is joined onto the app URL, so the value must be the bare `?query`.
    #[test]
    fn the_component_url_is_an_app_path_not_a_foreign_origin() {
        let url = component_window_url(&input("cmp-7", "node:trename"), "component-cmp-7").unwrap();
        match url {
            WebviewUrl::App(path) => {
                let text = path.to_string_lossy().into_owned();
                assert!(text.starts_with("?floatingComponent="), "{text}");
                assert!(!text.contains("xiranite.invalid"), "the probe origin must not leak: {text}");
            }
            other => panic!("component windows must load the app document, got {other:?}"),
        }
    }

    #[test]
    fn frames_below_the_usable_floor_are_not_reported() {
        assert!(reportable_frame(360.0, 260.0));
        assert!(!reportable_frame(359.0, 900.0));
        assert!(!reportable_frame(900.0, 259.0));
    }

    /// The React side reads these names; a snake_case payload validates as `undefined` there.
    #[test]
    fn the_payloads_use_the_field_names_the_webview_expects() {
        let value = serde_json::to_value(window_capabilities(CaptionState::renderer_chrome())).unwrap();
        assert_eq!(value["nativeWindowControls"], serde_json::json!(true));
        assert_eq!(value["componentWindows"], serde_json::json!("native"));
        assert_eq!(value["frameless"], serde_json::json!(true));
        assert_eq!(value["captionOwner"], serde_json::json!("renderer"));
        assert!(value.get("captionInset").is_none(), "no inset to reserve when the app draws the buttons");

        let result = serde_json::to_value(ok(None, "m", Some("normal"))).unwrap();
        assert_eq!(result["state"], serde_json::json!("normal"));
        assert!(result.get("id").is_none(), "an absent id must not appear at all");

        let event = serde_json::to_value(ComponentWindowFrameEvent {
            component_id: "cmp-7".to_owned(),
            module_id: "node:trename".to_owned(),
            workspace_id: None,
            width: 480.0,
            height: 320.0,
        })
        .unwrap();
        assert_eq!(event["componentId"], serde_json::json!("cmp-7"));
        assert!(event.get("workspaceId").is_none());
    }

    /// The registry is what makes a frame event addressable: unknown labels must produce nothing, so the
    /// main window's own resizes never look like a component remembering a size.
    #[test]
    fn only_remembered_component_windows_have_meta() {
        let windows = ComponentWindows::new();
        assert!(windows.meta("main").is_none());
        assert!(windows.meta("component-cmp-7").is_none(), "before any open");

        windows.remember("component-cmp-7", &input("cmp-7", "node:trename"));
        let event = windows.meta("component-cmp-7").expect("the opened window has meta");
        assert_eq!(event.component_id, "cmp-7");
        assert_eq!(event.module_id, "node:trename");
        assert_eq!(windows.labels(), vec!["component-cmp-7".to_owned()]);

        windows.forget("component-cmp-7");
        assert!(windows.meta("component-cmp-7").is_none(), "a closed window must be openable again");
    }

    /// Both caption modes have to come out of the same rule, or the macOS flavor would silently keep the
    /// app-drawn glyphs. `decorations: false` is the frameless case, so the scale is not one-sided.
    #[test]
    fn decorations_decide_who_paints_the_buttons() {
        let mut frameless = WindowConfig::default();
        frameless.decorations = false;
        assert_eq!(caption_state_of(&frameless), CaptionState::renderer_chrome());

        let mut decorated = WindowConfig::default();
        decorated.decorations = true;
        decorated.traffic_light_position = Some(LogicalPosition { x: 20.0, y: 16.0 });
        let state = caption_state_of(&decorated);
        assert_eq!(state.owner, CaptionOwner::System);
        assert_eq!(state.inset, Some(CaptionInset { x: 20.0, y: 16.0 }));
    }

    #[test]
    fn the_system_caption_reports_its_inset_to_the_webview() {
        let value = serde_json::to_value(window_capabilities(CaptionState {
            owner: CaptionOwner::System,
            inset: Some(CaptionInset { x: 20.0, y: 16.0 }),
        }))
        .unwrap();
        assert_eq!(value["captionOwner"], serde_json::json!("system"));
        assert_eq!(value["captionInset"]["x"], serde_json::json!(20.0));
        assert_eq!(value["captionInset"]["y"], serde_json::json!(16.0));
    }

    /// A flavor that renames the window must not lose the caption answer, and an empty config must fall
    /// back to the app-drawn chrome rather than claiming the OS paints buttons.
    #[test]
    fn the_main_window_entry_is_found_by_label_then_position() {
        let named = WindowConfig::default();
        assert_eq!(named.label, MAIN_WINDOW_LABEL, "the config default is the label the commands resolve");

        let renamed = WindowConfig { label: "workspace".to_owned(), ..WindowConfig::default() };
        assert_eq!(pick_main_window_config(&[renamed.clone()]), Some(&renamed));
        assert_eq!(pick_main_window_config(&[renamed.clone(), named.clone()]), Some(&named));
        assert_eq!(pick_main_window_config(&[]), None);
        assert_eq!(
            pick_main_window_config(&[renamed]).map(caption_state_of),
            Some(CaptionState { owner: CaptionOwner::System, inset: None }),
            "decorated without an inset still belongs to the OS; the renderer gets no band to reserve"
        );
    }
}
