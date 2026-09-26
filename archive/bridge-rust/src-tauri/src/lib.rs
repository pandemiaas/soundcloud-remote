//! SoundCloud Remote — ПК-мост (Tauri 2 + Rust).
//!
//! Запускает WebSocket-сервер (axum) для двух ролей по протоколу SCR-1:
//!  - "extension" — Chrome-расширение, только loopback, без токена;
//!  - "remote"    — телефон, требует токен (QR-код подключения).
//! Плюс системная громкость Windows для режима volume {target:"system"}.
//! См. ../../PROTOCOL.md.

mod commands;
mod server;
mod volume;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use rand::Rng;
use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedSender;

/// Роль соединения.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Extension,
    Remote,
}

struct Inner {
    token: Mutex<String>,
    listening: AtomicBool,
    ext_gen: AtomicU64,
    remote_gen: AtomicU64,
    ext_tx: Mutex<Option<UnboundedSender<String>>>,
    remote_tx: Mutex<Option<UnboundedSender<String>>>,
    last_state: Mutex<Option<Value>>,
    ext_caps: Mutex<Vec<String>>,
}

/// Общее состояние моста (иммутабельный клон-хэндл для задач и команд).
#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

fn slot_of(inner: &Inner, role: Role) -> &Mutex<Option<UnboundedSender<String>>> {
    match role {
        Role::Extension => &inner.ext_tx,
        Role::Remote => &inner.remote_tx,
    }
}

fn gen_of(inner: &Inner, role: Role) -> &AtomicU64 {
    match role {
        Role::Extension => &inner.ext_gen,
        Role::Remote => &inner.remote_gen,
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Inner {
                token: Mutex::new(generate_token()),
                listening: AtomicBool::new(false),
                ext_gen: AtomicU64::new(0),
                remote_gen: AtomicU64::new(0),
                ext_tx: Mutex::new(None),
                remote_tx: Mutex::new(None),
                last_state: Mutex::new(None),
                ext_caps: Mutex::new(Vec::new()),
            }),
        }
    }

    pub fn token(&self) -> String {
        self.inner.token.lock().unwrap().clone()
    }

    pub fn set_token(&self, token: String) {
        *self.inner.token.lock().unwrap() = token;
    }

    pub fn set_listening(&self, v: bool) {
        self.inner.listening.store(v, Ordering::SeqCst);
    }

    pub fn is_listening(&self) -> bool {
        self.inner.listening.load(Ordering::SeqCst)
    }

    pub fn is_connected(&self, role: Role) -> bool {
        slot_of(&self.inner, role).lock().unwrap().is_some()
    }

    /// Зарегистрировать соединение роли; возвращает поколение (для вытеснения старых).
    /// Новое соединение вытесняет старое той же роли.
    pub fn register(&self, role: Role, tx: UnboundedSender<String>) -> u64 {
        let gen = gen_of(&self.inner, role).load(Ordering::SeqCst) + 1;
        gen_of(&self.inner, role).store(gen, Ordering::SeqCst);
        *slot_of(&self.inner, role).lock().unwrap() = Some(tx);
        gen
    }

    /// Закрыть соединение роли. Возвращает true, если закрыто АКТИВНОЕ соединение
    /// (по поколению — вытесненные соединения игнорируются).
    pub fn unregister(&self, role: Role, gen: u64) -> bool {
        if gen_of(&self.inner, role).load(Ordering::SeqCst) != gen || gen == 0 {
            return false;
        }
        gen_of(&self.inner, role).store(0, Ordering::SeqCst);
        *slot_of(&self.inner, role).lock().unwrap() = None;
        true
    }

    /// Отправить сообщение соединению роли. false, если роль не подключена.
    pub fn forward(&self, role: Role, v: &Value) -> bool {
        let tx = slot_of(&self.inner, role).lock().unwrap().clone();
        match tx {
            Some(tx) => tx.send(v.to_string()).is_ok(),
            None => false,
        }
    }

    pub fn ext_caps(&self) -> Vec<String> {
        self.inner.ext_caps.lock().unwrap().clone()
    }

    pub fn set_ext_caps(&self, caps: Vec<String>) {
        *self.inner.ext_caps.lock().unwrap() = caps;
    }

    pub fn store_state(&self, mut v: Value) {
        if let Some(o) = v.as_object_mut() {
            o.insert("volume_system".into(), json!(round1(volume::get_percent())));
            o.insert("ext_connected".into(), json!(true));
        }
        *self.inner.last_state.lock().unwrap() = Some(v);
    }

    /// Кэшированное состояние с актуальной системной громкостью.
    pub fn last_state_snapshot(&self) -> Option<Value> {
        let mut v = self.inner.last_state.lock().unwrap().clone()?;
        if let Some(o) = v.as_object_mut() {
            o.insert("volume_system".into(), json!(round1(volume::get_percent())));
            o.insert("ext_connected".into(), json!(true));
        }
        Some(v)
    }
}

pub fn generate_token() -> String {
    let n: u32 = rand::thread_rng().gen_range(0..1_000_000);
    format!("{n:06}")
}

pub fn device_name() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "PC".into())
}

/// Локальный IP в LAN (для QR-кода): трюк с UDP-сокетом без отправки пакетов.
pub fn lan_ip() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .ok()
        .and_then(|s| {
            s.connect("8.8.8.8:80").ok()?;
            s.local_addr().ok()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|| "127.0.0.1".into())
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

pub fn run() {
    let state = AppState::new();

    tauri::Builder::default()
        .manage(state.clone())
        .setup(move |_app| {
            let st = state.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::run_server(st).await {
                    eprintln!("[bridge] сервер: {e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bridge_status,
            commands::get_qr_svg,
            commands::regenerate_token,
            commands::get_system_volume,
            commands::set_system_volume,
        ])
        .run(tauri::generate_context!())
        .expect("ошибка запуска SoundCloud Remote Bridge");
}
