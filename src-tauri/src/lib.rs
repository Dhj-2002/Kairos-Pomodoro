mod commands;

use commands::menubar::{setup_menubar_tray, MenubarState};
use std::fs;
use tauri::{Manager, RunEvent, WindowEvent};

/// Install the Windows data snapshot bundled with the migration DMG only when
/// this Mac has no Kairos database yet. Existing Mac data is never overwritten.
fn install_bundled_database_if_missing(
    app: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error>> {
    let destination_dir = app.path().app_data_dir()?;
    let destination = destination_dir.join("Kairos-Pomodoro.db");
    if destination.exists() {
        return Ok(());
    }

    let bundled = app
        .path()
        .resource_dir()?
        .join("migration")
        .join("Kairos-Pomodoro.db");
    if !bundled.exists() {
        return Ok(());
    }

    fs::create_dir_all(&destination_dir)?;
    fs::copy(bundled, destination)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::hotkey::register_hotkey,
            commands::hotkey::unregister_hotkey,
            commands::menubar::menubar_show,
            commands::menubar::menubar_hide,
            commands::menubar::menubar_set_title,
            commands::menubar::menubar_set_tooltip,
            commands::window::show_main_window,
        ])
        .manage(MenubarState::new())
        .setup(|app| {
            // Startup must never become headless merely because an optional
            // migration, tray, or mini-window feature failed on this Mac.
            if let Err(error) = install_bundled_database_if_missing(app.handle()) {
                eprintln!("Kairos database migration failed: {error}");
            }
            if let Err(error) = setup_menubar_tray(app) {
                eprintln!("Kairos tray setup failed: {error}");
            }
            if let Err(error) = commands::window::setup_mini_click_through(app.handle()) {
                eprintln!("Kairos mini-window setup failed: {error}");
            }

            // macOS can finish launching an application without surfacing its
            // initial window. Explicitly restore it after all setup work.
            if let Err(error) = commands::window::restore_main_window(app.handle()) {
                eprintln!("Kairos main-window restore failed: {error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(desktop)]
        match event {
            // window lifecycle step 1: Closing the main window returns to the
            // always-visible mini window instead of destroying the webview.
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            // window lifecycle step 2: The mini window has no close control and
            // ignores accidental system close requests.
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "mini" => {
                api.prevent_close();
            }
            // window lifecycle step 3: Only the explicit tray Quit command is
            // allowed to terminate the background application.
            RunEvent::ExitRequested { api, code, .. } if code.is_none() => {
                api.prevent_exit();
            }
            // Clicking the Dock icon after closing or hiding Kairos must bring
            // the existing main webview back instead of leaving a headless app.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => {
                let _ = commands::window::restore_main_window(app_handle);
            }
            _ => {}
        }
    });
}
