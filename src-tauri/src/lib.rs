//! Notepads for Linux — native backend.
//!
//! This is the Linux counterpart of the C# "core" of the original Notepads app.
//! It owns everything the webview must not touch directly: the filesystem, text
//! encoding conversion, line-ending handling, the multi-window / multi-tab model,
//! the session snapshot and the application settings.
//!
//! Design notes
//! ------------
//! * No `fs` plugin is exposed to the frontend. Every file operation goes through
//!   a command defined here, so the attack surface stays tiny and the encoding
//!   logic lives in exactly one place.
//! * Text I/O is done as `Vec<u8>` + explicit codec, never as `String`, because
//!   Notepads has to round-trip UTF-16, Windows-1252 and friends byte-for-byte.
//! * State is kept in two process-wide `Mutex`es: the per-window file registry and
//!   the launch/pending-file queue. Both are tiny and never held across `.await`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalSize, Size, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

/// Hard ceiling on what we are willing to read into a JS string (the original app
/// caps at 1 MB, we are far more generous but still refuse to hang the UI).
const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;
/// Above this size the frontend shows a "large file" hint.
const LARGE_FILE_BYTES: u64 = 8 * 1024 * 1024;
const DEFAULT_WIDTH: f64 = 1000.0;
const DEFAULT_HEIGHT: f64 = 640.0;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// One open document, as tracked by the backend. The frontend is the owner of the
/// buffer; this only remembers what the document *is* so that saves can be done
/// without a round-trip of the whole path/encoding metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenFile {
    /// Absolute path, or `None` for an unsaved new file.
    pub path: Option<String>,
    /// Canonical encoding label, see `encoding::BY_NAME`.
    pub encoding: String,
}

#[derive(Default)]
struct AppState {
    /// window label -> ordered list of open files
    registry: Mutex<HashMap<String, Vec<OpenFile>>>,
    /// window label -> files requested from the command line before the window booted
    pending: Mutex<HashMap<String, Vec<String>>>,
    /// window labels whose close request has already been approved by the user
    approved_close: Mutex<HashSet<String>>,
    /// bookkeeping for window labels
    counter: Mutex<u32>,
}

// ---------------------------------------------------------------------------
// Text encoding support
// ---------------------------------------------------------------------------

mod encoding {

    /// Labels are byte-identical to the ones the original Notepads shows in its
    /// encoding flyout, so the muscle memory survives the port.
    pub struct Codec {
        pub label: &'static str,
        pub name: &'static str,
        pub group: &'static str,
    }

    pub const BY_NAME: &[Codec] = &[
        Codec {
            label: "UTF-8",
            name: "UTF-8",
            group: "Unicode",
        },
        Codec {
            label: "UTF-8-BOM",
            name: "UTF-8 with BOM",
            group: "Unicode",
        },
        Codec {
            label: "UTF-16LE",
            name: "UTF-16 LE",
            group: "Unicode",
        },
        Codec {
            label: "UTF-16BE",
            name: "UTF-16 BE",
            group: "Unicode",
        },
        Codec {
            label: "ASCII",
            name: "ASCII",
            group: "Western",
        },
        Codec {
            label: "WINDOWS-1252",
            name: "ANSI (Windows-1252)",
            group: "Western",
        },
        Codec {
            label: "ISO-8859-1",
            name: "Western European (ISO-8859-1)",
            group: "Western",
        },
        Codec {
            label: "ISO-8859-15",
            name: "Western European (ISO-8859-15)",
            group: "Western",
        },
        Codec {
            label: "WINDOWS-1251",
            name: "Cyrillic (Windows-1251)",
            group: "Cyrillic",
        },
        Codec {
            label: "KOI8-R",
            name: "Cyrillic (KOI8-R)",
            group: "Cyrillic",
        },
    ];

    /// Windows-1252 code points 0x80..0x9F (the rest is Latin-1).
    const CP1252_HIGH: [char; 32] = [
        '\u{20AC}', '\u{FFFD}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}',
        '\u{2021}', '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{FFFD}',
        '\u{017D}', '\u{FFFD}', '\u{FFFD}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}',
        '\u{2022}', '\u{2013}', '\u{2014}', '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}',
        '\u{0153}', '\u{FFFD}', '\u{017E}', '\u{0178}',
    ];

    /// KOI8-R 0x80..0xFF mapped to Unicode (box drawing + Cyrillic).
    const KOI8R_HIGH: [char; 128] = [
        '\u{2500}', '\u{2502}', '\u{250C}', '\u{2510}', '\u{2514}', '\u{2518}', '\u{251C}',
        '\u{2524}', '\u{252C}', '\u{2534}', '\u{253C}', '\u{2580}', '\u{2584}', '\u{2588}',
        '\u{258C}', '\u{2590}', '\u{2591}', '\u{2592}', '\u{2593}', '\u{2320}', '\u{25A0}',
        '\u{2219}', '\u{221A}', '\u{2248}', '\u{2264}', '\u{2265}', '\u{00A0}', '\u{2321}',
        '\u{00B0}', '\u{00B2}', '\u{00B7}', '\u{00F7}', '\u{2550}', '\u{2551}', '\u{2552}',
        '\u{0451}', '\u{2553}', '\u{2554}', '\u{2555}', '\u{2556}', '\u{2557}', '\u{2558}',
        '\u{2559}', '\u{255A}', '\u{255B}', '\u{255C}', '\u{255D}', '\u{255E}', '\u{255F}',
        '\u{2560}', '\u{2561}', '\u{0401}', '\u{2562}', '\u{2563}', '\u{2564}', '\u{2565}',
        '\u{2566}', '\u{2567}', '\u{2568}', '\u{2569}', '\u{256A}', '\u{256B}', '\u{256C}',
        '\u{00A9}', '\u{044E}', '\u{0430}', '\u{0431}', '\u{0446}', '\u{0434}', '\u{0435}',
        '\u{0444}', '\u{0433}', '\u{0445}', '\u{0438}', '\u{0439}', '\u{043A}', '\u{043B}',
        '\u{043C}', '\u{043D}', '\u{043E}', '\u{043F}', '\u{044F}', '\u{0440}', '\u{0441}',
        '\u{0442}', '\u{0443}', '\u{0436}', '\u{0432}', '\u{044C}', '\u{044B}', '\u{0437}',
        '\u{0448}', '\u{044D}', '\u{0449}', '\u{0447}', '\u{044A}', '\u{042E}', '\u{0410}',
        '\u{0411}', '\u{0426}', '\u{0414}', '\u{0415}', '\u{0424}', '\u{0413}', '\u{0425}',
        '\u{0418}', '\u{0419}', '\u{041A}', '\u{041B}', '\u{041C}', '\u{041D}', '\u{041E}',
        '\u{041F}', '\u{042F}', '\u{0420}', '\u{0421}', '\u{0422}', '\u{0423}', '\u{0416}',
        '\u{0412}', '\u{042C}', '\u{042B}', '\u{0417}', '\u{0428}', '\u{042D}', '\u{0429}',
        '\u{0427}', '\u{042A}',
    ];

    /// Windows-1251 0x80..0xFF mapped to Unicode.
    const CP1251_HIGH: [char; 128] = [
        '\u{0402}', '\u{0403}', '\u{201A}', '\u{0453}', '\u{201E}', '\u{2026}', '\u{2020}',
        '\u{2021}', '\u{20AC}', '\u{2030}', '\u{0409}', '\u{2039}', '\u{040A}', '\u{040C}',
        '\u{040B}', '\u{040F}', '\u{0452}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}',
        '\u{2022}', '\u{2013}', '\u{2014}', '\u{FFFD}', '\u{2122}', '\u{0459}', '\u{203A}',
        '\u{045A}', '\u{045C}', '\u{045B}', '\u{045F}', '\u{00A0}', '\u{040E}', '\u{045E}',
        '\u{0408}', '\u{00A4}', '\u{0490}', '\u{00A6}', '\u{00A7}', '\u{0401}', '\u{00A9}',
        '\u{0404}', '\u{00AB}', '\u{00AC}', '\u{00AD}', '\u{00AE}', '\u{0407}', '\u{00B0}',
        '\u{00B1}', '\u{0406}', '\u{0456}', '\u{0491}', '\u{00B5}', '\u{00B6}', '\u{00B7}',
        '\u{0451}', '\u{2116}', '\u{0454}', '\u{00BB}', '\u{0458}', '\u{0405}', '\u{0455}',
        '\u{0457}', '\u{0410}', '\u{0411}', '\u{0412}', '\u{0413}', '\u{0414}', '\u{0415}',
        '\u{0416}', '\u{0417}', '\u{0418}', '\u{0419}', '\u{041A}', '\u{041B}', '\u{041C}',
        '\u{041D}', '\u{041E}', '\u{041F}', '\u{0420}', '\u{0421}', '\u{0422}', '\u{0423}',
        '\u{0424}', '\u{0425}', '\u{0426}', '\u{0427}', '\u{0428}', '\u{0429}', '\u{042A}',
        '\u{042B}', '\u{042C}', '\u{042D}', '\u{042E}', '\u{042F}', '\u{0430}', '\u{0431}',
        '\u{0432}', '\u{0433}', '\u{0434}', '\u{0435}', '\u{0436}', '\u{0437}', '\u{0438}',
        '\u{0439}', '\u{043A}', '\u{043B}', '\u{043C}', '\u{043D}', '\u{043E}', '\u{043F}',
        '\u{0440}', '\u{0441}', '\u{0442}', '\u{0443}', '\u{0444}', '\u{0445}', '\u{0446}',
        '\u{0447}', '\u{0448}', '\u{0449}', '\u{044A}', '\u{044B}', '\u{044C}', '\u{044D}',
        '\u{044E}', '\u{044F}',
    ];

    /// The eight Latin-1 positions that ISO-8859-15 gives up to other glyphs.
    /// They must not be reachable through the Latin-1 identity fallback.
    pub const ISO_8859_15_REMOVED: [u8; 8] = [0xA4, 0xA6, 0xA8, 0xB4, 0xB8, 0xBC, 0xBD, 0xBE];

    /// ISO-8859-15 differs from Latin-1 in exactly 8 positions.
    const ISO_8859_15_MAP: [(u8, char); 8] = [
        (0xA4, '\u{20AC}'),
        (0xA6, '\u{0160}'),
        (0xA8, '\u{0161}'),
        (0xB4, '\u{017D}'),
        (0xB8, '\u{017E}'),
        (0xBC, '\u{0152}'),
        (0xBD, '\u{0153}'),
        (0xBE, '\u{0178}'),
    ];

    fn single_byte_decode(byte: u8, table: &[(u8, char)]) -> char {
        if let Some((_, c)) = table.iter().find(|(b, _)| *b == byte) {
            *c
        } else {
            byte as char
        }
    }

    /// Decode bytes into a Rust `String` using the given encoding label.
    /// Returns `None` when the label is unknown.
    pub fn decode(bytes: &[u8], label: &str) -> Option<String> {
        match label {
            "UTF-8" | "ASCII" => Some(String::from_utf8_lossy(bytes).into_owned()),
            "UTF-8-BOM" => {
                let body = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
                Some(String::from_utf8_lossy(body).into_owned())
            }
            "UTF-16LE" | "UTF-16BE" => {
                let le = label == "UTF-16LE";
                let body = if bytes.len() >= 2 {
                    let (b0, b1) = (bytes[0], bytes[1]);
                    if (le && b0 == 0xFF && b1 == 0xFE) || (!le && b0 == 0xFE && b1 == 0xFF) {
                        &bytes[2..]
                    } else {
                        bytes
                    }
                } else {
                    bytes
                };
                let units: Vec<u16> = body
                    .chunks_exact(2)
                    .map(|c| {
                        if le {
                            u16::from_le_bytes([c[0], c[1]])
                        } else {
                            u16::from_be_bytes([c[0], c[1]])
                        }
                    })
                    .collect();
                Some(String::from_utf16_lossy(&units))
            }
            "WINDOWS-1252" => Some(
                bytes
                    .iter()
                    .map(|b| match *b {
                        0x80..=0x9F => CP1252_HIGH[(*b - 0x80) as usize],
                        other => other as char,
                    })
                    .collect(),
            ),
            "ISO-8859-1" => Some(bytes.iter().map(|b| *b as char).collect()),
            "ISO-8859-15" => Some(
                bytes
                    .iter()
                    .map(|b| single_byte_decode(*b, &ISO_8859_15_MAP))
                    .collect(),
            ),
            "WINDOWS-1251" => Some(
                bytes
                    .iter()
                    .map(|b| match *b {
                        0x80..=0xFF => CP1251_HIGH[(*b - 0x80) as usize],
                        other => other as char,
                    })
                    .collect(),
            ),
            "KOI8-R" => Some(
                bytes
                    .iter()
                    .map(|b| match *b {
                        0x80..=0xFF => KOI8R_HIGH[(*b - 0x80) as usize],
                        other => other as char,
                    })
                    .collect(),
            ),
            _ => None,
        }
    }

    /// Encode a string back to bytes. Characters that the target codec cannot
    /// represent become `?`, exactly like the .NET EncoderFallback the original
    /// app relies on.
    pub fn encode(text: &str, label: &str) -> Vec<u8> {
        match label {
            "UTF-8" => text.as_bytes().to_vec(),
            "ASCII" => text
                .chars()
                .map(|c| if (c as u32) < 128 { c as u8 } else { b'?' })
                .collect(),
            "UTF-8-BOM" => {
                let mut out = vec![0xEF, 0xBB, 0xBF];
                out.extend_from_slice(text.as_bytes());
                out
            }
            "UTF-16LE" | "UTF-16BE" => {
                let mut out = Vec::with_capacity(text.len() * 2 + 2);
                if label == "UTF-16LE" {
                    out.extend_from_slice(&[0xFF, 0xFE]);
                } else {
                    out.extend_from_slice(&[0xFE, 0xFF]);
                }
                for unit in text.encode_utf16() {
                    out.extend_from_slice(&if label == "UTF-16LE" {
                        unit.to_le_bytes()
                    } else {
                        unit.to_be_bytes()
                    });
                }
                out
            }
            _ => {
                let table: &[(u8, char)] = if label == "ISO-8859-15" {
                    &ISO_8859_15_MAP
                } else {
                    &[]
                };
                text.chars()
                    .map(|c| {
                        let cp = c as u32;
                        if cp < 0x80 {
                            return cp as u8;
                        }
                        if let Some((b, _)) = table.iter().find(|(_, tc)| *tc == c) {
                            return *b;
                        }
                        if let Some(b) = reverse_lookup(cp, label) {
                            return b;
                        }
                        // Latin-1 identity band. Valid for ISO-8859-1/-15 and for
                        // Windows-1252 above 0x9F; Windows-1251 and KOI8-R are
                        // Cyrillic there, so they only get the table lookup above.
                        let latin1_band = (0xA0..0x100).contains(&cp);
                        let identity_ok = match label {
                            "ISO-8859-1" => (0x80..0x100).contains(&cp),
                            "ISO-8859-15" => {
                                latin1_band && !ISO_8859_15_REMOVED.contains(&(cp as u8))
                            }
                            "WINDOWS-1252" => latin1_band,
                            _ => false,
                        };
                        if identity_ok {
                            cp as u8
                        } else {
                            b'?'
                        }
                    })
                    .collect()
            }
        }
    }

    fn reverse_lookup(cp: u32, label: &str) -> Option<u8> {
        let high: &[char] = match label {
            "WINDOWS-1252" => &CP1252_HIGH,
            "WINDOWS-1251" => &CP1251_HIGH,
            "KOI8-R" => &KOI8R_HIGH,
            _ => return None,
        };
        high.iter()
            .position(|c| (*c as u32) == cp && cp != 0xFFFD)
            .map(|i| (i + 0x80) as u8)
    }
}

/// Best-effort encoding sniffing, mirroring the behaviour of the original app:
/// BOM first, then strict UTF-8 validation, then a Windows-1252 fallback (which
/// is byte-compatible with Latin-1 and is what "ANSI" means on Windows).
fn detect_encoding(bytes: &[u8]) -> (&'static str, bool) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return ("UTF-8-BOM", false);
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return ("UTF-16LE", false);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return ("UTF-16BE", false);
    }
    if bytes.iter().all(|b| *b < 0x80) {
        return ("ASCII", false);
    }
    let utf16ish = bytes.len() > 8
        && bytes.len() % 2 == 0
        && bytes.iter().step_by(2).filter(|b| **b == 0).count() > bytes.len() / 8;
    if utf16ish {
        return ("UTF-16LE", true);
    }
    if std::str::from_utf8(bytes).is_ok() {
        return ("UTF-8", false);
    }
    ("WINDOWS-1252", true)
}

fn detect_line_ending(text: &str) -> &'static str {
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count() - crlf;
    let cr = text.matches('\r').count() - crlf;
    if crlf >= lf && crlf >= cr && crlf > 0 {
        "CRLF"
    } else if cr > lf {
        "CR"
    } else {
        "LF"
    }
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ReadResult {
    path: String,
    /// Decoded text, or `None` if the file looks binary and `force` was not set.
    content: Option<String>,
    encoding: String,
    /// True when the encoding could not be determined with confidence (not a BOM,
    /// not valid UTF-8) — drives the "Encoding cannot be determined" notification.
    encoding_guessed: bool,
    line_ending: String,
    size: u64,
    large_file: bool,
    readonly: bool,
}

#[derive(Serialize)]
struct SaveResult {
    path: String,
    size: u64,
    modified_ms: u64,
}

#[derive(Serialize)]
struct FileMeta {
    exists: bool,
    size: u64,
    modified_ms: u64,
    readonly: bool,
}

fn meta_of(path: &Path) -> FileMeta {
    match fs::metadata(path) {
        Ok(m) => FileMeta {
            exists: true,
            size: m.len(),
            modified_ms: m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            readonly: m.permissions().readonly(),
        },
        Err(_) => FileMeta {
            exists: false,
            size: 0,
            modified_ms: 0,
            readonly: false,
        },
    }
}

/// NUL density heuristic, kept private: it is only meaningful once we know the
/// buffer is not UTF-16 (see `is_binary`).
fn has_many_nuls(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    let sample = &bytes[..bytes.len().min(8192)];
    sample.iter().filter(|b| **b == 0).count() > sample.len() / 16
}

/// Decides whether a buffer should be refused as a binary file.
///
/// The encoding verdict wins over the raw heuristic: a UTF-16 document is full of
/// NUL bytes (every ASCII character is `XX 00`) and would otherwise be rejected by
/// its own text editor, which is exactly the bug this function exists to prevent.
fn is_binary(bytes: &[u8], encoding: &str) -> bool {
    if encoding.starts_with("UTF-16") {
        return false;
    }
    has_many_nuls(bytes)
}

// ---------------------------------------------------------------------------
// Config dir helpers (settings.json / session.json)
// ---------------------------------------------------------------------------

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("cannot resolve config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn config_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join(name))
}

// ---------------------------------------------------------------------------
// Window plumbing
// ---------------------------------------------------------------------------

fn pending_files_for(label: &str) -> Vec<String> {
    let state = APP_STATE.get().expect("state");
    let mut pending = state.pending.lock().unwrap();
    pending.remove(label).unwrap_or_default()
}

static APP_STATE: std::sync::OnceLock<AppState> = std::sync::OnceLock::new();

/// Creates (or reuses) an editor window. This is the Linux replacement for the
/// UWP "AppInstance" logic of the original app.
fn create_window(
    app: &AppHandle,
    label: Option<String>,
    files: Vec<String>,
    geometry: Option<(f64, f64, Option<f64>, Option<f64>)>,
    maximized: bool,
) -> Result<WebviewWindow, String> {
    let state = APP_STATE.get().expect("state");
    let label = match label {
        Some(l) => l,
        None => {
            let mut counter = state.counter.lock().unwrap();
            *counter += 1;
            format!("notepads-{}", *counter)
        }
    };
    if let Some(existing) = app.get_webview_window(&label) {
        if !files.is_empty() {
            existing
                .emit("notepads://open-files", files.clone())
                .map_err(|e| e.to_string())?;
        }
        let _ = existing.set_focus();
        return Ok(existing);
    }
    {
        let mut pending = state.pending.lock().unwrap();
        pending.insert(label.clone(), files);
    }

    let transparent = read_settings_raw(app)
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("transparentWindow").and_then(|b| b.as_bool()))
        .unwrap_or(false);

    let (w, h, x, y) = match geometry {
        Some(g) => g,
        None => (DEFAULT_WIDTH, DEFAULT_HEIGHT, None, None),
    };

    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Untitled - Notepads")
        .inner_size(w, h)
        .min_inner_size(360.0, 240.0)
        .decorations(false)
        .transparent(transparent)
        .visible(false)
        .resizable(true)
        .center();
    if let (Some(x), Some(y)) = (x, y) {
        builder = builder.position(x, y);
    }

    let window = builder
        .build()
        .map_err(|e| format!("cannot create window: {e}"))?;

    if maximized {
        let _ = window.maximize();
    }
    let _ = window.show();
    let _ = window.set_focus();
    Ok(window)
}

fn read_settings_raw(app: &AppHandle) -> Option<String> {
    let path = config_file(app, "settings.json").ok()?;
    fs::read_to_string(path).ok()
}

// ---------------------------------------------------------------------------
// Commands — files
// ---------------------------------------------------------------------------

/// Reads a text file, sniffing encoding and line endings. `force_encoding` is the
/// "Reopen with encoding" path of the original app.
#[tauri::command]
fn read_text_file(
    path: String,
    force_encoding: Option<String>,
    allow_binary: Option<bool>,
) -> Result<ReadResult, String> {
    let p = PathBuf::from(&path);
    let meta = fs::metadata(&p).map_err(|e| format!("{}: {e}", p.display()))?;
    if meta.is_dir() {
        return Err(format!("{} is a directory", p.display()));
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(format!(
            "file is {} MB, larger than the {} MB limit",
            meta.len() / 1024 / 1024,
            MAX_READ_BYTES / 1024 / 1024
        ));
    }
    let bytes = fs::read(&p).map_err(|e| format!("{}: {e}", p.display()))?;

    // Detection runs first: it decides what the buffer *is*, and a UTF-16 file is
    // text even though it is 50% NUL bytes.
    let (detected, guessed) = detect_encoding(&bytes);
    let label = force_encoding
        .clone()
        .unwrap_or_else(|| detected.to_string());
    let binary = is_binary(&bytes, &label);
    if binary && !allow_binary.unwrap_or(false) {
        return Ok(ReadResult {
            path: p.to_string_lossy().into_owned(),
            content: None,
            encoding: "BINARY".into(),
            encoding_guessed: false,
            line_ending: "LF".into(),
            size: meta.len(),
            large_file: false,
            readonly: meta.permissions().readonly(),
        });
    }

    let text =
        encoding::decode(&bytes, &label).ok_or_else(|| format!("unsupported encoding: {label}"))?;

    Ok(ReadResult {
        path: p.to_string_lossy().into_owned(),
        line_ending: detect_line_ending(&text).to_string(),
        content: Some(text),
        encoding: label,
        encoding_guessed: guessed,
        size: meta.len(),
        large_file: meta.len() > LARGE_FILE_BYTES,
        readonly: meta.permissions().readonly(),
    })
}

/// Writes a buffer to disk with the requested encoding and line ending.
/// `line_ending` is applied on the fly so the in-memory buffer can stay LF-only.
#[tauri::command]
fn save_text_file(
    path: String,
    contents: String,
    encoding: Option<String>,
    line_ending: Option<String>,
    expected_modified_ms: Option<u64>,
    force: Option<bool>,
) -> Result<SaveResult, String> {
    let p = PathBuf::from(&path);
    let encoding = encoding.unwrap_or_else(|| "UTF-8".into());
    let line_ending = line_ending.unwrap_or_else(|| "LF".into());

    // External-change guard: the tab offers "Reload file from disk" in the original.
    if !force.unwrap_or(false) {
        if let Some(expected) = expected_modified_ms {
            let meta = meta_of(&p);
            if meta.exists && meta.modified_ms != expected {
                return Err("CONFLICT: file was modified outside of Notepads".into());
            }
        }
    }

    let normalized = normalize_line_endings(&contents, &line_ending);
    let bytes = encoding::encode(&normalized, &encoding);

    if let Some(parent) = p.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
    }
    fs::write(&p, bytes).map_err(|e| format!("{}: {e}", p.display()))?;
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    Ok(SaveResult {
        path: p.to_string_lossy().into_owned(),
        size: meta.len(),
        modified_ms: meta_of(&p).modified_ms,
    })
}

fn normalize_line_endings(text: &str, line_ending: &str) -> String {
    // First collapse everything to LF, then expand. The last line is left alone if
    // the buffer has a trailing newline, matching what every editor does.
    let lf = text.replace("\r\n", "\n").replace('\r', "\n");
    match line_ending {
        "CRLF" => lf.replace('\n', "\r\n"),
        "CR" => lf.replace('\n', "\r"),
        _ => lf,
    }
}

#[tauri::command]
fn file_metadata(path: String) -> FileMeta {
    meta_of(Path::new(&path))
}

#[tauri::command]
fn rename_file(from: String, to: String) -> Result<(), String> {
    fs::rename(&from, &to).map_err(|e| format!("{from} -> {to}: {e}"))
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn list_encodings() -> Vec<serde_json::Value> {
    encoding::BY_NAME
        .iter()
        .map(|c| serde_json::json!({ "label": c.label, "name": c.name, "group": c.group }))
        .collect()
}

// ---------------------------------------------------------------------------
// Commands — dialogs
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct Picked {
    path: Option<String>,
    cancelled: bool,
}

#[tauri::command]
fn pick_open_file(app: AppHandle, multiple: Option<bool>) -> Vec<String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file().set_title("Open file");
    dialog = dialog.add_filter(
        "Text files",
        &[
            "txt", "md", "markdown", "log", "ini", "conf", "cfg", "json", "yaml", "yml", "toml",
            "xml", "csv", "sh", "py", "rs", "js", "ts", "c", "h", "cpp", "java", "css", "html",
        ],
    );
    dialog = dialog.add_filter("All files", &["*"]);
    let picked = if multiple.unwrap_or(true) {
        dialog.blocking_pick_files()
    } else {
        dialog.blocking_pick_file().map(|f| vec![f])
    };
    picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
fn pick_save_path(app: AppHandle, suggested: Option<String>) -> Picked {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save file")
        .add_filter("Text files", &["txt"])
        .add_filter("Markdown", &["md"])
        .add_filter("All files", &["*"]);
    if let Some(name) = suggested {
        dialog = dialog.set_file_name(name);
    }
    match dialog.blocking_save_file() {
        Some(f) => match f.into_path() {
            Ok(p) => Picked {
                path: Some(p.to_string_lossy().into_owned()),
                cancelled: false,
            },
            Err(_) => Picked {
                path: None,
                cancelled: true,
            },
        },
        None => Picked {
            path: None,
            cancelled: true,
        },
    }
}

#[tauri::command]
fn pick_folder(app: AppHandle, default_path: Option<String>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file().set_title("Select folder");
    if let Some(d) = default_path {
        dialog = dialog.set_directory(d);
    }
    dialog
        .blocking_pick_folder()
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

/// Saves a base64 blob (virtual "Save selection to file" / print-to-file helper).
#[tauri::command]
fn write_base64_file(path: String, data: String) -> Result<u64, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| e.to_string())?;
    fs::write(&path, &bytes).map_err(|e| format!("{path}: {e}"))?;
    Ok(bytes.len() as u64)
}

// ---------------------------------------------------------------------------
// Commands — shell integration
// ---------------------------------------------------------------------------

#[tauri::command]
fn open_in_file_manager(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let p = Path::new(&path);
    let target: PathBuf = if p.is_dir() {
        p.to_path_buf()
    } else {
        p.parent()
            .map(|x| x.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("/"))
    };
    app.opener()
        .open_path(target.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn web_search(app: AppHandle, query: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = format!("https://www.bing.com/search?q={}", urlencode(&query));
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            b' ' => "+".to_string(),
            other => format!("%{other:02X}"),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Commands — windows
// ---------------------------------------------------------------------------

#[tauri::command]
fn new_window(app: AppHandle, files: Option<Vec<String>>) -> Result<String, String> {
    let w = create_window(&app, None, files.unwrap_or_default(), None, false)?;
    Ok(w.label().to_string())
}

#[tauri::command]
fn take_launch_files(label: String) -> Vec<String> {
    pending_files_for(&label)
}

#[tauri::command]
fn window_action(window: WebviewWindow, action: String) -> Result<(), String> {
    match action.as_str() {
        "minimize" => window.minimize(),
        "maximize" => window.maximize(),
        "unmaximize" => window.unmaximize(),
        "toggle-maximize" => {
            if window.is_maximized().unwrap_or(false) {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        "close" => window.close(),
        "fullscreen" => {
            let fs = window.is_fullscreen().unwrap_or(false);
            window.set_fullscreen(!fs)
        }
        "focus" => window.set_focus(),
        other => return Err(format!("unknown window action: {other}")),
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_window_title(window: WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_window_geometry(window: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    window
        .set_size(Size::Physical(PhysicalSize {
            width: width as u32,
            height: height as u32,
        }))
        .map_err(|e| e.to_string())
}

/// Called by the frontend once the user has resolved unsaved changes. Only then
/// does the window actually go away.
#[tauri::command]
fn confirm_close(window: WebviewWindow) -> Result<(), String> {
    let state = APP_STATE.get().expect("state");
    state
        .approved_close
        .lock()
        .unwrap()
        .insert(window.label().to_string());
    window.destroy().map_err(|e| e.to_string())
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

/// Broadcasts a "please close yourself" request; each window runs its own
/// save-reminder flow. Used by the tray "Quit" entry.
#[tauri::command]
fn request_quit(app: AppHandle) {
    for (label, window) in app.webview_windows() {
        if window.emit("notepads://quit-requested", ()).is_err() {
            let _ = label;
        }
    }
}

#[tauri::command]
fn window_is_maximized(window: WebviewWindow) -> bool {
    window.is_maximized().unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Commands — registry / settings / session
// ---------------------------------------------------------------------------

#[tauri::command]
fn register_open_files(label: String, files: Vec<OpenFile>) {
    let state = APP_STATE.get().expect("state");
    state.registry.lock().unwrap().insert(label, files);
}

#[tauri::command]
fn get_open_files(label: String) -> Vec<OpenFile> {
    let state = APP_STATE.get().expect("state");
    state
        .registry
        .lock()
        .unwrap()
        .get(&label)
        .cloned()
        .unwrap_or_default()
}

#[tauri::command]
fn write_settings(app: AppHandle, json: String) -> Result<(), String> {
    let path = config_file(&app, "settings.json")?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_settings(app: AppHandle) -> Result<String, String> {
    match config_file(&app, "settings.json") {
        Ok(path) => Ok(fs::read_to_string(path).unwrap_or_else(|_| "{}".into())),
        Err(e) => Err(e),
    }
}

#[tauri::command]
fn write_session(app: AppHandle, json: String) -> Result<(), String> {
    let path = config_file(&app, "session.json")?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_session(app: AppHandle) -> String {
    config_file(&app, "session.json")
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .unwrap_or_else(|| "{}".into())
}

#[tauri::command]
fn clear_session(app: AppHandle) -> Result<(), String> {
    let path = config_file(&app, "session.json")?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn app_info(app: AppHandle) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    m.insert("version".into(), env!("CARGO_PKG_VERSION").into());
    m.insert("name".into(), "Notepads for Linux".into());
    m.insert(
        "configDir".into(),
        config_dir(&app)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
    );
    m.insert("platform".into(), std::env::consts::OS.into());
    m
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
struct SessionSnapshot {
    #[serde(default)]
    windows: Vec<SessionWindow>,
}

#[derive(Deserialize, Default)]
struct SessionWindow {
    #[serde(default)]
    files: Vec<SessionFile>,
    width: Option<f64>,
    height: Option<f64>,
    x: Option<f64>,
    y: Option<f64>,
    #[serde(default)]
    maximized: bool,
}

#[derive(Deserialize, Default)]
struct SessionFile {
    path: String,
}

fn restore_session(app: &AppHandle) {
    let raw = config_file(app, "session.json")
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .unwrap_or_default();
    let snapshot: SessionSnapshot = serde_json::from_str(&raw).unwrap_or_default();

    // Only paths that still exist are restored, so a stale session can never
    // produce a wall of error dialogs on start-up.
    let mut created = 0usize;
    for win in snapshot.windows.iter().take(8) {
        let files: Vec<String> = win
            .files
            .iter()
            .map(|f| f.path.clone())
            .filter(|p| Path::new(p).is_file())
            .collect();
        if files.is_empty() && created > 0 {
            continue;
        }
        let geometry = match (win.width, win.height) {
            (Some(w), Some(h)) => Some((w, h, win.x, win.y)),
            _ => None,
        };
        if create_window(app, None, files, geometry, win.maximized).is_ok() {
            created += 1;
        }
    }
    if created == 0 {
        let _ = create_window(app, None, Vec::new(), None, false);
    }
}

pub fn run() {
    APP_STATE.set(AppState::default()).ok();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        // A second `notepads file.txt` invocation hands the files to the running
        // instance instead of starting a new process.
        let files: Vec<String> = argv
            .iter()
            .skip(1)
            .filter(|a| !a.starts_with('-') && Path::new(a).is_file())
            .cloned()
            .collect();
        if let Some(w) = app.webview_windows().values().next().cloned() {
            let _ = w.emit("notepads://open-files", files);
            let _ = w.set_focus();
        }
    }));

    #[cfg(feature = "tray")]
    {
        builder = builder.setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;

            let handle = app.handle().clone();
            let tray_handle = handle.clone();
            let new_window =
                MenuItem::with_id(app, "new-window", "New window", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Notepads", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&new_window, &quit])?;
            if let Some(icon) = app.default_window_icon().cloned() {
                TrayIconBuilder::with_id("notepads-tray")
                    .icon(icon)
                    .tooltip("Notepads for Linux")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(move |_app, event| match event.id().as_ref() {
                        "new-window" => {
                            let _ = create_window(&tray_handle, None, Vec::new(), None, false);
                        }
                        "quit" => {
                            request_quit(tray_handle.clone());
                        }
                        _ => {}
                    })
                    .build(app)?;
            }

            // Files given on the command line are stashed for the first window.
            let cli_files: Vec<String> = std::env::args()
                .skip(1)
                .filter(|a| !a.starts_with('-') && Path::new(a).is_file())
                .collect();
            let restore = read_settings_raw(&handle)
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v.get("restoreSessionOnStartup").and_then(|b| b.as_bool()))
                .unwrap_or(true);
            if cli_files.is_empty() && restore {
                restore_session(&handle);
            } else {
                let _ = create_window(&handle, None, cli_files, None, false);
            }
            Ok(())
        });
    }

    #[cfg(not(feature = "tray"))]
    {
        builder = builder.setup(|app| {
            let handle = app.handle().clone();
            let cli_files: Vec<String> = std::env::args()
                .skip(1)
                .filter(|a| !a.starts_with('-') && Path::new(a).is_file())
                .collect();
            let restore = read_settings_raw(&handle)
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v.get("restoreSessionOnStartup").and_then(|b| b.as_bool()))
                .unwrap_or(true);
            if cli_files.is_empty() && restore {
                restore_session(&handle);
            } else {
                let _ = create_window(&handle, None, cli_files, None, false);
            }
            Ok(())
        });
    }

    builder
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = APP_STATE.get().expect("state");
                let label = window.label().to_string();
                let approved = state.approved_close.lock().unwrap().contains(&label);
                if !approved {
                    // The webview gets the last word: it may need to ask about
                    // unsaved modifications before letting the window go.
                    api.prevent_close();
                    let _ = window.emit("notepads://close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            save_text_file,
            file_metadata,
            rename_file,
            delete_file,
            list_encodings,
            pick_open_file,
            pick_save_path,
            pick_folder,
            write_base64_file,
            open_in_file_manager,
            open_url,
            web_search,
            new_window,
            take_launch_files,
            window_action,
            set_window_title,
            set_window_geometry,
            confirm_close,
            exit_app,
            request_quit,
            window_is_maximized,
            register_open_files,
            get_open_files,
            write_settings,
            read_settings,
            write_session,
            read_session,
            clear_session,
            app_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Notepads for Linux");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_encodings() {
        assert_eq!(detect_encoding(b"hello world").0, "ASCII");
        assert_eq!(detect_encoding("héllo".as_bytes()).0, "UTF-8");
        assert_eq!(detect_encoding(&[0xEF, 0xBB, 0xBF, b'a']).0, "UTF-8-BOM");
        assert_eq!(detect_encoding(&[0xFF, 0xFE, b'a', 0]).0, "UTF-16LE");
        assert!(detect_encoding(&[0xE9, 0xE8]).1);
    }

    #[test]
    fn round_trips_encodings() {
        // Anything that can carry the full Unicode range.
        let unicode_text = "caf\u{e9} \u{20ac} \u{2018}quote\u{2019}";
        for label in ["UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE"] {
            let bytes = encoding::encode(unicode_text, label);
            let back = encoding::decode(&bytes, label).unwrap();
            assert_eq!(back, unicode_text, "encoding {label} did not round-trip");
        }

        // Windows-1252 carries the euro sign and the curly quotes.
        let cp1252_text = "caf\u{e9} \u{20ac} \u{2018}quote\u{2019}";
        let back = encoding::decode(
            &encoding::encode(cp1252_text, "WINDOWS-1252"),
            "WINDOWS-1252",
        )
        .unwrap();
        assert_eq!(back, cp1252_text, "WINDOWS-1252 did not round-trip");

        // ISO-8859-1 is exactly Latin-1: no euro, no curly quotes.
        let latin1_text = "caf\u{e9} se\u{f1}or \u{fc}ber";
        let back =
            encoding::decode(&encoding::encode(latin1_text, "ISO-8859-1"), "ISO-8859-1").unwrap();
        assert_eq!(back, latin1_text, "ISO-8859-1 did not round-trip");

        // ISO-8859-15 keeps Latin-1 but trades eight slots for euro and friends.
        let latin15_text = "caf\u{e9} \u{20ac} \u{153} \u{160} \u{17d}";
        let back = encoding::decode(
            &encoding::encode(latin15_text, "ISO-8859-15"),
            "ISO-8859-15",
        )
        .unwrap();
        assert_eq!(back, latin15_text, "ISO-8859-15 did not round-trip");
        // ...and the traded-away positions must not silently encode as Latin-1.
        assert_eq!(encoding::encode("\u{a4}", "ISO-8859-15"), vec![b'?']);

        // Cyrillic: Windows-1251 and KOI8-R have hand written tables in both
        // directions, so they are worth their own assertion.
        let cyrillic = "\u{41f}\u{440}\u{438}\u{432}\u{435}\u{442} \u{451}";
        for label in ["WINDOWS-1251", "KOI8-R", "UTF-16LE"] {
            let bytes = encoding::encode(cyrillic, label);
            let back = encoding::decode(&bytes, label).unwrap();
            assert_eq!(
                back, cyrillic,
                "encoding {label} did not round-trip Cyrillic"
            );
        }
    }

    #[test]
    fn utf16_is_text_not_binary() {
        for label in ["UTF-16LE", "UTF-16BE"] {
            let bytes = encoding::encode("hola mundo\n", label);
            assert!(has_many_nuls(&bytes), "{label} is full of NUL bytes");
            let (detected, _) = detect_encoding(&bytes);
            assert_eq!(detected, label, "BOM detection for {label}");
            assert!(
                !is_binary(&bytes, detected),
                "{label} must not be refused as binary"
            );
        }
        // A real binary blob (ELF/PNG style: NUL bytes everywhere) stays binary.
        let mut blob = vec![0u8; 1024];
        for (i, b) in blob.iter_mut().enumerate() {
            if i % 3 == 0 {
                *b = (i % 251) as u8;
            }
        }
        assert!(is_binary(&blob, "UTF-8"));
        // ...but the same bytes are accepted once the user forces a 16-bit codec.
        assert!(!is_binary(&blob, "UTF-16LE"));
    }

    #[test]
    fn unmappable_characters_become_question_marks() {
        let bytes = encoding::encode("\u{4e2d}\u{6587}", "ASCII");
        assert_eq!(bytes, b"??");
        let bytes = encoding::encode("\u{4e2d}\u{6587}", "WINDOWS-1252");
        assert_eq!(bytes, b"??");
    }

    #[test]
    fn normalizes_line_endings() {
        assert_eq!(normalize_line_endings("a\nb\n", "CRLF"), "a\r\nb\r\n");
        assert_eq!(normalize_line_endings("a\r\nb\r\n", "LF"), "a\nb\n");
        assert_eq!(detect_line_ending("a\r\nb\r\n"), "CRLF");
        assert_eq!(detect_line_ending("a\nb\n"), "LF");
    }
}
