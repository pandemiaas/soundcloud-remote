//! WebSocket-сервер моста по протоколу SCR-1 (../../PROTOCOL.md).
//!
//! Одна точка: ws://0.0.0.0:8765/ws
//!  - роль "extension": принимается только с loopback (127.0.0.1/::1), без токена;
//!  - роль "remote": требует токен (QR-код).
//! Мост — единственный владелец очереди: одно активное соединение на роль,
//! новое вытесняет старое (generation counter).

use std::net::SocketAddr;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::mpsc;

use crate::{AppState, Role};

pub const PORT: u16 = 8765;
const BRIDGE_VERSION: &str = env!("CARGO_PKG_VERSION");

const COMMAND_TYPES: [&str; 10] = [
    "play", "pause", "toggle", "next", "prev", "seek", "volume", "like", "repeat", "shuffle",
];

pub async fn run_server(state: AppState) -> Result<(), String> {
    let router = Router::new()
        .route("/ws", get(ws_handler))
        .with_state(state.clone());

    let listener = TcpListener::bind(("0.0.0.0", PORT))
        .await
        .map_err(|e| format!("не удалось занять порт {PORT}: {e}"))?;

    state.set_listening(true);
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .map_err(|e| format!("сервер остановился с ошибкой: {e}"))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state, addr))
}

async fn handle_socket(socket: WebSocket, state: AppState, addr: SocketAddr) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Писатель: всё исходящее уходит через канал.
    let writer = tokio::spawn(async move {
        while let Some(text) = rx.recv().await {
            if sink.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
    });

    let send = {
        let tx = tx.clone();
        move |v: Value| {
            let _ = tx.send(v.to_string());
        }
    };

    let mut role: Option<Role> = None;
    let mut gen: u64 = 0;

    while let Some(Ok(msg)) = stream.next().await {
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) | Message::Binary(_) => continue,
        };

        let v: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => {
                send(json!({"t": "error", "code": "bad_message", "message": "invalid json"}));
                continue;
            }
        };
        let t = v.get("t").and_then(|x| x.as_str()).unwrap_or("").to_string();

        // ---- рукопожатие -------------------------------------------------
        if role.is_none() {
            if t != "hello" {
                send(json!({"t": "error", "code": "bad_message", "message": "ожидался hello"}));
                continue;
            }
            let hello_role = v.get("role").and_then(|x| x.as_str()).unwrap_or("");
            match hello_role {
                "extension" => {
                    if !addr.ip().is_loopback() {
                        send(json!({"t": "error", "code": "auth", "message": "extension доступен только с loopback"}));
                        break;
                    }
                    let g = state.register(Role::Extension, tx.clone());
                    role = Some(Role::Extension);
                    gen = g;
                    send(json!({"t": "welcome", "proto": 1, "bridge_version": BRIDGE_VERSION}));
                    if let Some(st) = state.last_state_snapshot() {
                        send(st);
                    }
                }
                "remote" => {
                    let token = v.get("token").and_then(|x| x.as_str()).unwrap_or("");
                    if token.is_empty() || token != state.token() {
                        send(json!({"t": "error", "code": "auth", "message": "неверный токен"}));
                        break;
                    }
                    let g = state.register(Role::Remote, tx.clone());
                    role = Some(Role::Remote);
                    gen = g;
                    send(json!({
                        "t": "welcome",
                        "proto": 1,
                        "device": crate::device_name(),
                        "bridge_version": BRIDGE_VERSION,
                        "caps": ["system_volume"],
                    }));
                    if let Some(st) = state.last_state_snapshot() {
                        send(st);
                    }
                }
                other => {
                    send(json!({"t": "error", "code": "bad_message",
                                "message": format!("неизвестная роль: {other}")}));
                    break;
                }
            }
            continue;
        }

        // ---- рабочий обмен ------------------------------------------------
        let r = role.unwrap();
        match (r, t.as_str()) {
            (_, "ping") => send(json!({"t": "pong"})),

            (Role::Extension, "state") => {
                state.store_state(v.clone());
                forward_to(&state, Role::Remote, &state.last_state_snapshot().unwrap_or(v));
            }
            (Role::Extension, "tick") => {
                forward_to(&state, Role::Remote, &v);
            }
            (Role::Extension, "caps") => {
                let caps = v
                    .get("caps")
                    .and_then(|x| x.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                state.set_ext_caps(caps);
                forward_to(&state, Role::Remote, &v);
            }
            (Role::Extension, "ack") | (Role::Extension, "error") => {
                forward_to(&state, Role::Remote, &v);
            }
            (Role::Extension, "ext") => {
                forward_to(&state, Role::Remote, &v);
            }

            (Role::Remote, "sync") => {
                forward_to(&state, Role::Extension, &json!({"t": "sync"}));
            }
            (Role::Remote, "volume") => {
                let target = v.get("target").and_then(|x| x.as_str()).unwrap_or("player");
                if target == "system" {
                    let value = v.get("value").and_then(|x| x.as_f64()).unwrap_or(0.0).clamp(0.0, 100.0);
                    crate::volume::set_percent(value);
                    let now = crate::volume::get_percent();
                    let id = v.get("id").cloned();
                    let mut ack = json!({"t": "ack", "volume_system": (now * 10.0).round() / 10.0});
                    if let Some(id) = id {
                        ack["id"] = id;
                    }
                    send(ack);
                    send(json!({"t": "meta", "volume_system": (now * 10.0).round() / 10.0}));
                } else {
                    forward_to(&state, Role::Extension, &v);
                }
            }
            (Role::Remote, cmd) if COMMAND_TYPES.contains(&cmd) => {
                forward_to(&state, Role::Extension, &v);
            }
            _ => {
                send(json!({"t": "error", "code": "bad_message",
                            "message": format!("неизвестное сообщение: {t}")}));
            }
        }
    }

    // ---- соединение закрыто ---------------------------------------------
    if let Some(r) = role {
        if state.unregister(r, gen) && r == Role::Extension {
            // активное расширение отвалилось — сообщаем телефону
            state.forward(Role::Remote, &json!({"t": "ext", "connected": false}));
        }
    }
    writer.abort();
}

fn forward_to(state: &AppState, role: Role, v: &Value) {
    let _ = state.forward(role, v);
}
