mod metrics;
mod wire;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;
const VERSION: u32 = 5;
#[derive(Deserialize)]
struct Frame {
    #[serde(rename = "type")]
    kind: String,
    v: u32,
    #[serde(rename = "deviceSettings")]
    settings: Option<Value>,
}
#[derive(Clone, PartialEq)]
struct Configuration {
    interval: Duration,
    drive: String,
}
struct Control {
    running: bool,
    config: Configuration,
}
fn configuration(value: &Value) -> Result<Configuration, String> {
    let seconds = match value.get("refreshInterval").and_then(Value::as_str) {
        Some("1s") => 1,
        Some("2s") => 2,
        Some("5s") => 5,
        _ => return Err("refreshInterval must be 1s, 2s or 5s".into()),
    };
    let raw = value
        .get("drive")
        .and_then(Value::as_str)
        .ok_or("drive must be a string")?
        .trim();
    let drive = if raw.is_empty() {
        std::env::var("SystemDrive").unwrap_or("C:".into())
    } else {
        raw.to_owned()
    }
    .to_ascii_uppercase();
    if drive.len() != 2 || !drive.as_bytes()[0].is_ascii_alphabetic() || drive.as_bytes()[1] != b':'
    {
        return Err("drive must be empty or a drive letter such as D:".into());
    }
    Ok(Configuration {
        interval: Duration::from_secs(seconds),
        drive,
    })
}
fn run() -> Result<(), String> {
    if std::env::var("MYWALLPAPER_PROTOCOL").as_deref() != Ok("process-v2") {
        return Err("Launch this companion through MyWallpaper".into());
    }
    let mut input = io::stdin().lock();
    let Some(first) = wire::read::<Frame>(&mut input).map_err(|e| e.to_string())? else {
        return Ok(());
    };
    if first.v != VERSION || first.kind != "init" {
        return Err("Expected protocol-v5 init".into());
    }
    let config = configuration(first.settings.as_ref().ok_or("Missing device settings")?)?;
    let control = Arc::new((
        Mutex::new(Control {
            running: true,
            config,
        }),
        Condvar::new(),
    ));
    wire::write(
        &mut io::stdout().lock(),
        &json!({"type":"ready","v":VERSION}),
    )
    .map_err(|e| e.to_string())?;
    let worker_control = Arc::clone(&control);
    let worker = thread::spawn(move || sample_loop(worker_control));
    let result = (|| -> Result<(), String> {
        while let Some(frame) = wire::read::<Frame>(&mut input).map_err(|e| e.to_string())? {
            if frame.v != VERSION {
                return Err("Protocol version mismatch".into());
            }
            match frame.kind.as_str() {
                "shutdown" => break,
                "settings" => {
                    let config =
                        configuration(frame.settings.as_ref().ok_or("Missing device settings")?)?;
                    let (lock, wake) = &*control;
                    lock.lock().map_err(|_| "Sampler state poisoned")?.config = config;
                    wake.notify_one();
                }
                "message" => {} // The widget has no native commands.
                _ => return Err("Unexpected host frame".into()),
            }
        }
        Ok(())
    })();
    let (lock, wake) = &*control;
    if let Ok(mut state) = lock.lock() {
        state.running = false;
        wake.notify_one()
    }
    worker
        .join()
        .map_err(|_| "Sampler thread failed".to_string())??;
    result
}
fn sample_loop(control: Arc<(Mutex<Control>, Condvar)>) -> Result<(), String> {
    let mut sampler = metrics::Sampler::new();
    let mut sequence = 0u64;
    let (lock, wake) = &*control;
    loop {
        let state = lock.lock().map_err(|_| "Sampler state poisoned")?;
        if !state.running {
            return Ok(());
        }
        let config = state.config.clone();
        drop(state);
        sequence += 1;
        let frame = match sampler.sample(sequence, &config.drive) {
            Ok(payload) => {
                json!({"type":"message","v":VERSION,"target":"broadcast","payload":payload})
            }
            Err(message) => {
                json!({"type":"message","v":VERSION,"target":"broadcast","payload":{"kind":"hardware.error","message":message}})
            }
        };
        wire::write(&mut io::stdout().lock(), &frame).map_err(|e| e.to_string())?;
        let state = lock.lock().map_err(|_| "Sampler state poisoned")?;
        if !state.running {
            return Ok(());
        }
        if state.config != config {
            continue;
        }
        let (state, _) = wake
            .wait_timeout(state, config.interval)
            .map_err(|_| "Sampler state poisoned")?;
        if !state.running {
            return Ok(());
        }
    }
}
fn main() {
    if let Err(message) = run() {
        let _ = wire::write(
            &mut io::stdout().lock(),
            &json!({"type":"error","v":VERSION,"code":"monitor-failed","message":message}),
        );
        eprintln!("Hardware Monitor: {message}");
        std::process::exit(1);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_reject_paths_and_unknown_sampling_rates() {
        assert!(configuration(&json!({"refreshInterval":"2s","drive":"D:"})).is_ok());
        assert!(
            configuration(&json!({"refreshInterval":"2s","drive":"\\\\server\\share"})).is_err()
        );
        assert!(configuration(&json!({"refreshInterval":"0s","drive":""})).is_err());
    }
}
