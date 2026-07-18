mod scanner;

use tauri::AppHandle;

#[tauri::command]
fn ping(name: String) -> Result<String, String> {
    Ok(name)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn ping(name: String) -> Result<String, String> {
    Ok(name)
}

#[tauri::command]
fn scan(app: AppHandle, paths: Vec<String>) {
    scanner::scan(app, paths);
}

#[tauri::command]
fn orphan() -> bool {
    true
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            // Qualified paths and comments must not become registrations.
            crate::ping,
            scanner::scan,
        ]);
}
