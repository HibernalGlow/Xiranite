use native_engine::Scanner;
use tauri::{AppHandle, Emitter};

pub fn scan(app: AppHandle, paths: Vec<String>) {
    let scanner = Scanner::new();
    let result = scanner.run(paths);
    app.emit("scan-finished", result).unwrap();
}
