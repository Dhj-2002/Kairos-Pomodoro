use tauri::{AppHandle, Manager};

/** Keep the Windows schedule surface visible without intercepting any mouse
 * input. This is the behavior of the original Windows mini window: controls
 * beneath it remain clickable, including title-bar close buttons. */
#[cfg(target_os = "windows")]
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
