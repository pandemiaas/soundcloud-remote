//! Tauri-команды для окна статуса (фронтенд вызывает через invoke).

use serde_json::{json, Value};
use tauri::State;

use crate::{server, volume, AppState};

#[tauri::command]
pub fn get_bridge_status(state: State<'_, AppState>) -> Value {
    json!({
        "listening": state.is_listening(),
        "port": server::PORT,
        "token": state.token(),
        "device": crate::device_name(),
        "host": crate::lan_ip(),
        "ext_connected": state.is_connected(crate::Role::Extension),
        "remote_connected": state.is_connected(crate::Role::Remote),
        "ext_caps": state.ext_caps(),
        "volume_system": (volume::get_percent() * 10.0).round() / 10.0,
        "bridge_version": env!("CARGO_PKG_VERSION"),
        "track": state.last_state_snapshot(),
    })
}

/// SVG QR-кода со строкой подключения scremote://connect?host=…&port=…&token=…
#[tauri::command]
pub fn get_qr_svg(state: State<'_, AppState>) -> Result<String, String> {
    use qrcode::render::svg;
    use qrcode::QrCode;

    let payload = format!(
        "scremote://connect?host={}&port={}&token={}",
        crate::lan_ip(),
        server::PORT,
        state.token()
    );

    let code = QrCode::with_error_correction_level(payload.as_bytes(), qrcode::EcLevel::M)
        .map_err(|e| format!("qr: {e}"))?;

    Ok(code
        .render::<svg::Color>()
        .dark_color(svg::Color("#e8e6f0"))
        .light_color(svg::Color("#1e1b2e"))
        .min_dimensions(220, 220)
        .build())
}

#[tauri::command]
pub fn regenerate_token(state: State<'_, AppState>) -> String {
    let token = crate::generate_token();
    state.set_token(token.clone());
    token
}

#[tauri::command]
pub fn get_system_volume() -> f64 {
    (volume::get_percent() * 10.0).round() / 10.0
}

/// Установить системную громкость (0..100). Возвращает фактическое значение.
#[tauri::command]
pub fn set_system_volume(v: f64) -> f64 {
    volume::set_percent(v.clamp(0.0, 100.0));
    (volume::get_percent() * 10.0).round() / 10.0
}
