use std::{str::FromStr, sync::Mutex, thread, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    window::{Effect, EffectsBuilder},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
    System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    },
};

const RELAY_OVERLAY_URL: &str = "http://127.0.0.1:14318/v1/overlay";
const DASHBOARD_URL: &str = "https://codex-command-center.chasewilcox93.workers.dev";
const MAX_SNAPSHOT_BYTES: u64 = 262_144;
const DEFAULT_SHOW_HIDE: &str = "Ctrl+Shift+Space";
const DEFAULT_CLICK_THROUGH: &str = "Ctrl+Shift+O";
const CHATGPT_PROCESS_NAME: &str = "ChatGPT.exe";

#[derive(Default)]
struct OverlayNativeState {
    click_through: bool,
    lock_position: bool,
    always_on_top: bool,
    shortcuts_ready: bool,
    shortcut_error: Option<String>,
    show_hide_hotkey: String,
    click_through_hotkey: String,
    effective_effect: String,
    edge_snapping: bool,
    follow_chatgpt: bool,
    chatgpt_running: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeStatePayload {
    click_through: bool,
    lock_position: bool,
    always_on_top: bool,
    shortcuts_ready: bool,
    shortcut_error: Option<String>,
    effective_effect: String,
    follow_chatgpt: bool,
    chatgpt_running: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowSettings {
    effect: String,
    lock_position: bool,
    always_on_top: bool,
    show_in_taskbar: bool,
    click_through: bool,
    edge_snapping: bool,
    follow_chatgpt: bool,
}

fn state_payload(state: &OverlayNativeState) -> NativeStatePayload {
    NativeStatePayload {
        click_through: state.click_through,
        lock_position: state.lock_position,
        always_on_top: state.always_on_top,
        shortcuts_ready: state.shortcuts_ready,
        shortcut_error: state.shortcut_error.clone(),
        effective_effect: state.effective_effect.clone(),
        follow_chatgpt: state.follow_chatgpt,
        chatgpt_running: state.chatgpt_running,
    }
}

#[cfg(windows)]
fn chatgpt_process_running() -> Option<bool> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry = PROCESSENTRY32W::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                let length = entry
                    .szExeFile
                    .iter()
                    .position(|character| *character == 0)
                    .unwrap_or(entry.szExeFile.len());
                let executable = String::from_utf16_lossy(&entry.szExeFile[..length]);
                if executable.eq_ignore_ascii_case(CHATGPT_PROCESS_NAME) {
                    found = true;
                    break;
                }
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
        Some(found)
    }
}

#[cfg(not(windows))]
fn chatgpt_process_running() -> Option<bool> {
    None
}

fn apply_follow_state(app: &AppHandle, running: bool) {
    let changed = with_state(app, |state| {
        let changed = state.chatgpt_running != running;
        state.chatgpt_running = running;
        (changed, state.follow_chatgpt)
    })
    .unwrap_or((false, false));
    if !changed.0 {
        return;
    }
    let _ = app.emit(
        "native-action",
        serde_json::json!({ "kind": "chatgpt-running", "value": running }),
    );
    if changed.1 {
        if let Ok(window) = main_window(app) {
            if running {
                let _ = window.show();
            } else {
                let _ = window.hide();
            }
        }
    }
}

fn start_chatgpt_watcher(app: AppHandle) {
    thread::spawn(move || loop {
        if let Some(running) = chatgpt_process_running() {
            apply_follow_state(&app, running);
        }
        thread::sleep(Duration::from_secs(5));
    });
}

fn with_state<T>(
    app: &AppHandle,
    operation: impl FnOnce(&mut OverlayNativeState) -> T,
) -> Result<T, String> {
    let state = app.state::<Mutex<OverlayNativeState>>();
    let mut guard = state
        .lock()
        .map_err(|_| "native_state_unavailable".to_string())?;
    Ok(operation(&mut guard))
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "overlay_window_unavailable".to_string())
}

fn toggle_window(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    if window
        .is_visible()
        .map_err(|_| "window_state_unavailable")?
    {
        window.hide().map_err(|_| "window_hide_failed".to_string())
    } else {
        window
            .show()
            .map_err(|_| "window_show_failed".to_string())?;
        window
            .set_focus()
            .map_err(|_| "window_focus_failed".to_string())
    }
}

fn set_click_through_native(
    app: &AppHandle,
    enabled: bool,
    notify_frontend: bool,
) -> Result<(), String> {
    let ready = with_state(app, |state| state.shortcuts_ready)?;
    if enabled && !ready {
        return Err(
            "Click-through is disabled because its recovery shortcut is not registered.".into(),
        );
    }
    main_window(app)?
        .set_ignore_cursor_events(enabled)
        .map_err(|_| "click_through_update_failed".to_string())?;
    with_state(app, |state| state.click_through = enabled)?;
    if notify_frontend {
        let _ = app.emit(
            "native-action",
            serde_json::json!({ "kind": "click-through", "value": enabled }),
        );
    }
    Ok(())
}

fn apply_effect(window: &WebviewWindow, requested: &str) -> String {
    let result = match requested {
        "mica" => window.set_effects(EffectsBuilder::new().effect(Effect::Mica).build()),
        "acrylic" => window.set_effects(EffectsBuilder::new().effect(Effect::Acrylic).build()),
        "solid" | "translucent" => {
            window.set_effects(EffectsBuilder::new().clear_effects().build())
        }
        _ => return "translucent".into(),
    };
    if result.is_ok() {
        requested.into()
    } else {
        let _ = window.set_effects(EffectsBuilder::new().clear_effects().build());
        "translucent".into()
    }
}

fn layout_size(layout: &str) -> Option<PhysicalSize<u32>> {
    match layout {
        "mini" => Some(PhysicalSize::new(300, 150)),
        "standard" => Some(PhysicalSize::new(360, 250)),
        "expanded" => Some(PhysicalSize::new(430, 500)),
        "strip" => Some(PhysicalSize::new(600, 90)),
        _ => None,
    }
}

fn position_corner(window: &WebviewWindow, corner: &str) -> Result<(), String> {
    if corner == "free" {
        return Ok(());
    }
    let monitor = window
        .current_monitor()
        .map_err(|_| "monitor_unavailable")?
        .or(window
            .primary_monitor()
            .map_err(|_| "monitor_unavailable")?)
        .ok_or_else(|| "monitor_unavailable".to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let size = window.outer_size().map_err(|_| "window_size_unavailable")?;
    let margin = 16i32;
    let right = monitor_position.x + monitor_size.width as i32 - size.width as i32 - margin;
    let bottom = monitor_position.y + monitor_size.height as i32 - size.height as i32 - margin;
    let position = match corner {
        "top-left" => {
            PhysicalPosition::new(monitor_position.x + margin, monitor_position.y + margin)
        }
        "top-right" => PhysicalPosition::new(right, monitor_position.y + margin),
        "bottom-left" => PhysicalPosition::new(monitor_position.x + margin, bottom),
        "bottom-right" => PhysicalPosition::new(right, bottom),
        _ => return Err("invalid_corner".into()),
    };
    window
        .set_position(position)
        .map_err(|_| "window_position_failed".to_string())
}

fn snap_to_edge(window: &WebviewWindow) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|_| "monitor_unavailable")?
        .ok_or_else(|| "monitor_unavailable".to_string())?;
    let position = window
        .outer_position()
        .map_err(|_| "window_position_unavailable")?;
    let size = window.outer_size().map_err(|_| "window_size_unavailable")?;
    let origin = monitor.position();
    let extent = monitor.size();
    let threshold = 22i32;
    let left = origin.x + 8;
    let top = origin.y + 8;
    let right = origin.x + extent.width as i32 - size.width as i32 - 8;
    let bottom = origin.y + extent.height as i32 - size.height as i32 - 8;
    let x = if (position.x - left).abs() <= threshold {
        left
    } else if (position.x - right).abs() <= threshold {
        right
    } else {
        position.x
    };
    let y = if (position.y - top).abs() <= threshold {
        top
    } else if (position.y - bottom).abs() <= threshold {
        bottom
    } else {
        position.y
    };
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|_| "window_snap_failed".to_string())
}

fn ensure_window_visible(window: &WebviewWindow) -> Result<(), String> {
    let position = window
        .outer_position()
        .map_err(|_| "window_position_unavailable")?;
    let size = window.outer_size().map_err(|_| "window_size_unavailable")?;
    let monitors = window
        .available_monitors()
        .map_err(|_| "monitor_unavailable")?;
    let visible = monitors.iter().any(|monitor| {
        let origin = monitor.position();
        let extent = monitor.size();
        let right = position.x + size.width as i32;
        let bottom = position.y + size.height as i32;
        right > origin.x + 40
            && position.x < origin.x + extent.width as i32 - 40
            && bottom > origin.y + 40
            && position.y < origin.y + extent.height as i32 - 40
    });
    if !visible {
        position_corner(window, "top-right")?;
    }
    Ok(())
}

fn register_shortcuts(
    app: &AppHandle,
    show_hide: &str,
    click_through: &str,
) -> Result<(String, String), String> {
    let show =
        Shortcut::from_str(show_hide).map_err(|_| "Show/hide shortcut is invalid.".to_string())?;
    let click = Shortcut::from_str(click_through)
        .map_err(|_| "Click-through shortcut is invalid.".to_string())?;
    if show == click {
        return Err("Show/hide and click-through shortcuts must be different.".into());
    }
    app.global_shortcut()
        .register(show)
        .map_err(|_| "Show/hide shortcut is already in use.".to_string())?;
    if let Err(_error) = app.global_shortcut().register(click) {
        let _ = app.global_shortcut().unregister(show);
        return Err("Click-through shortcut is already in use.".into());
    }
    Ok((show.to_string(), click.to_string()))
}

#[tauri::command]
async fn fetch_overlay(range: String) -> Result<serde_json::Value, String> {
    if !matches!(range.as_str(), "24h" | "7d" | "30d") {
        return Err("invalid_range".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "relay_offline".to_string())?;
    let response = client
        .get(RELAY_OVERLAY_URL)
        .query(&[("range", range)])
        .send()
        .await
        .map_err(|_| "relay_offline".to_string())?;
    if !response.status().is_success() {
        return Err("snapshot_unavailable".into());
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_SNAPSHOT_BYTES)
    {
        return Err("snapshot_unavailable".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "snapshot_unavailable".to_string())?;
    if bytes.len() as u64 > MAX_SNAPSHOT_BYTES {
        return Err("snapshot_unavailable".into());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "snapshot_unavailable".to_string())?;
    if !value
        .get("generatedAt")
        .is_some_and(serde_json::Value::is_string)
        || !value
            .get("health")
            .is_some_and(serde_json::Value::is_object)
        || !value
            .get("windowSummary")
            .is_some_and(serde_json::Value::is_object)
    {
        return Err("snapshot_unavailable".into());
    }
    Ok(value)
}

#[tauri::command]
fn get_native_state(app: AppHandle) -> Result<NativeStatePayload, String> {
    with_state(&app, |state| state_payload(state))
}

#[tauri::command]
fn apply_window_settings(
    app: AppHandle,
    settings: WindowSettings,
) -> Result<NativeStatePayload, String> {
    let window = main_window(&app)?;
    window
        .set_always_on_top(settings.always_on_top)
        .map_err(|_| "always_on_top_update_failed")?;
    window
        .set_skip_taskbar(!settings.show_in_taskbar)
        .map_err(|_| "taskbar_update_failed")?;
    window
        .set_resizable(!settings.lock_position)
        .map_err(|_| "resize_update_failed")?;
    let effective_effect = apply_effect(&window, &settings.effect);
    with_state(&app, |state| {
        state.always_on_top = settings.always_on_top;
        state.lock_position = settings.lock_position;
        state.effective_effect = effective_effect;
        state.edge_snapping = settings.edge_snapping;
        state.follow_chatgpt = settings.follow_chatgpt;
    })?;
    let running = with_state(&app, |state| state.chatgpt_running)?;
    if settings.follow_chatgpt && !running {
        let _ = window.hide();
    } else {
        let _ = window.show();
    }
    set_click_through_native(&app, settings.click_through, false)?;
    with_state(&app, |state| state_payload(state))
}

#[tauri::command]
fn set_layout(window: WebviewWindow, layout: String) -> Result<(), String> {
    let size = layout_size(&layout).ok_or_else(|| "invalid_layout".to_string())?;
    window
        .set_size(size)
        .map_err(|_| "window_resize_failed".to_string())
}

#[tauri::command]
fn set_corner(window: WebviewWindow, corner: String) -> Result<(), String> {
    position_corner(&window, &corner)
}

#[tauri::command]
fn start_drag(window: WebviewWindow, app: AppHandle, edge_snapping: bool) -> Result<(), String> {
    if with_state(&app, |state| state.lock_position)? {
        return Ok(());
    }
    window
        .start_dragging()
        .map_err(|_| "window_drag_failed".to_string())?;
    if edge_snapping {
        let _ = snap_to_edge(&window);
    }
    Ok(())
}

#[tauri::command]
fn toggle_visibility(app: AppHandle) -> Result<(), String> {
    toggle_window(&app)
}

#[tauri::command]
fn hide_overlay(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|_| "window_hide_failed".to_string())
}

#[tauri::command]
fn quit_overlay(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn open_dashboard(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(DASHBOARD_URL, None::<&str>)
        .map_err(|_| "dashboard_open_failed".to_string())
}

#[tauri::command]
fn configure_hotkeys(
    app: AppHandle,
    show_hide: String,
    click_through: String,
) -> Result<NativeStatePayload, String> {
    let previous = with_state(&app, |state| {
        (
            state.show_hide_hotkey.clone(),
            state.click_through_hotkey.clone(),
        )
    })?;
    app.global_shortcut()
        .unregister_all()
        .map_err(|_| "shortcut_reset_failed".to_string())?;
    match register_shortcuts(&app, &show_hide, &click_through) {
        Ok((show, click)) => {
            with_state(&app, |state| {
                state.show_hide_hotkey = show;
                state.click_through_hotkey = click;
                state.shortcuts_ready = true;
                state.shortcut_error = None;
            })?;
        }
        Err(message) => {
            let restored = register_shortcuts(&app, &previous.0, &previous.1).is_ok();
            with_state(&app, |state| {
                state.shortcuts_ready = restored;
                state.shortcut_error = Some(message.clone());
            })?;
            let _ = set_click_through_native(&app, false, true);
            return Err(message);
        }
    }
    with_state(&app, |state| state_payload(state))
}

fn emit_layout(app: &AppHandle, layout: &str) {
    if let Ok(window) = main_window(app) {
        if let Some(size) = layout_size(layout) {
            let _ = window.set_size(size);
        }
        let _ = window.show();
    }
    let _ = app.emit(
        "native-action",
        serde_json::json!({ "kind": "layout", "value": layout }),
    );
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let items = [
        ("show", "Show overlay"),
        ("hide", "Hide overlay"),
        ("mini", "Mini"),
        ("standard", "Standard"),
        ("expanded", "Expanded"),
        ("strip", "Strip"),
        ("always-on-top", "Always on top"),
        ("click-through", "Click through"),
        ("lock-position", "Lock position"),
        ("settings", "Settings"),
        ("dashboard", "Open Command Center"),
        ("autostart", "Start with Windows"),
        ("quit", "Quit"),
    ]
    .into_iter()
    .map(|(id, title)| MenuItem::with_id(app, id, title, true, None::<&str>))
    .collect::<tauri::Result<Vec<_>>>()?;
    let menu = Menu::new(app)?;
    for item in &items {
        menu.append(item)?;
    }
    let mut builder = TrayIconBuilder::with_id("codex-live")
        .tooltip("Codex Live Overlay")
        .menu(&menu)
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = toggle_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Ok(window) = main_window(app) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "hide" => {
                if let Ok(window) = main_window(app) {
                    let _ = window.hide();
                }
            }
            "mini" | "standard" | "expanded" | "strip" => emit_layout(app, event.id().as_ref()),
            "always-on-top" => {
                let next = with_state(app, |state| !state.always_on_top).unwrap_or(true);
                if let Ok(window) = main_window(app) {
                    let _ = window.set_always_on_top(next);
                }
                let _ = with_state(app, |state| state.always_on_top = next);
                let _ = app.emit(
                    "native-action",
                    serde_json::json!({ "kind": "always-on-top", "value": next }),
                );
            }
            "click-through" => {
                let next = with_state(app, |state| !state.click_through).unwrap_or(false);
                let _ = set_click_through_native(app, next, true);
            }
            "lock-position" => {
                let next = with_state(app, |state| !state.lock_position).unwrap_or(false);
                if let Ok(window) = main_window(app) {
                    let _ = window.set_resizable(!next);
                }
                let _ = with_state(app, |state| state.lock_position = next);
                let _ = app.emit(
                    "native-action",
                    serde_json::json!({ "kind": "lock-position", "value": next }),
                );
            }
            "settings" => {
                if let Ok(window) = main_window(app) {
                    let _ = window.show();
                }
                let _ = app.emit(
                    "native-action",
                    serde_json::json!({ "kind": "show-settings" }),
                );
            }
            "dashboard" => {
                let _ = app.opener().open_url(DASHBOARD_URL, None::<&str>);
            }
            "autostart" => {
                let manager = app.autolaunch();
                if manager.is_enabled().unwrap_or(false) {
                    let _ = manager.disable();
                } else {
                    let _ = manager.enable();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    let global_shortcuts = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let pressed = shortcut.to_string();
            let action = with_state(app, |state| {
                if pressed == state.show_hide_hotkey {
                    "visibility"
                } else if pressed == state.click_through_hotkey {
                    "click-through"
                } else {
                    "none"
                }
            })
            .unwrap_or("none");
            match action {
                "visibility" => {
                    let _ = toggle_window(app);
                }
                "click-through" => {
                    let next = with_state(app, |state| !state.click_through).unwrap_or(false);
                    let _ = set_click_through_native(app, next, true);
                }
                _ => {}
            }
        })
        .build();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(global_shortcuts)
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
                .build(),
        )
        .manage(Mutex::new(OverlayNativeState {
            show_hide_hotkey: DEFAULT_SHOW_HIDE.into(),
            click_through_hotkey: DEFAULT_CLICK_THROUGH.into(),
            always_on_top: true,
            effective_effect: "translucent".into(),
            follow_chatgpt: true,
            chatgpt_running: chatgpt_process_running().unwrap_or(true),
            ..Default::default()
        }))
        .invoke_handler(tauri::generate_handler![
            fetch_overlay,
            get_native_state,
            apply_window_settings,
            set_layout,
            set_corner,
            start_drag,
            toggle_visibility,
            hide_overlay,
            quit_overlay,
            open_dashboard,
            configure_hotkeys
        ])
        .setup(|app| {
            let registration =
                register_shortcuts(app.handle(), DEFAULT_SHOW_HIDE, DEFAULT_CLICK_THROUGH);
            with_state(app.handle(), |state| match registration {
                Ok((show, click)) => {
                    state.show_hide_hotkey = show;
                    state.click_through_hotkey = click;
                    state.shortcuts_ready = true;
                }
                Err(message) => {
                    state.shortcut_error = Some(message);
                    state.shortcuts_ready = false;
                }
            })
            .map_err(std::io::Error::other)?;
            build_tray(app.handle())?;
            start_chatgpt_watcher(app.handle().clone());
            if let Some(window) = app.get_webview_window("main") {
                let _ = ensure_window_visible(&window);
                let should_show = with_state(app.handle(), |state| {
                    !state.follow_chatgpt || state.chatgpt_running
                })
                .unwrap_or(true);
                if should_show {
                    window.show()?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Codex Live Overlay failed to start");
}
