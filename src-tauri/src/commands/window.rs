use tauri::{AppHandle, Manager};

/** Keep the mini schedule surface permanently click-through.
 * It remains visible and always-on-top, but never intercepts mouse input. */
pub fn setup_mini_click_through(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("mini") else {
        return Ok(());
    };
    window.set_ignore_cursor_events(true)
}

/** Restore the existing main window without creating a second app instance. */
pub fn restore_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;

    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    restore_main_window(&app)
}
