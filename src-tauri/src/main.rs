#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use chrono::{Datelike, Local, Timelike};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuBuilder, MenuEvent, SubmenuBuilder},
    Emitter, Manager, State,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use url::Url;

const SETTINGS_FILE: &str = "settings.json";
const APP_USER_AGENT: &str = "Noteslip/26";

#[derive(Debug)]
struct AppState {
    settings_cache: Mutex<Option<Settings>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    template: String,
    storage_dir: String,
    backup_dir: String,
    theme_mode: String,
    auto_dark_start: String,
    auto_dark_end: String,
    ics_feeds: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            template: "# {{date}}\n\n## 记录\n- \n".to_string(),
            storage_dir: String::new(),
            backup_dir: String::new(),
            theme_mode: "auto".to_string(),
            auto_dark_start: "19:00".to_string(),
            auto_dark_end: "07:00".to_string(),
            ics_feeds: String::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartialSettings {
    template: Option<String>,
    storage_dir: Option<String>,
    backup_dir: Option<String>,
    theme_mode: Option<String>,
    auto_dark_start: Option<String>,
    auto_dark_end: Option<String>,
    ics_feeds: Option<String>,
}

#[derive(Debug, Serialize)]
struct OkResponse {
    ok: bool,
}

#[derive(Debug, Serialize)]
struct SettingsResponse {
    ok: bool,
    settings: Settings,
}

#[derive(Debug, Serialize)]
struct ReadLogResponse {
    ok: bool,
    date: String,
    exists: bool,
    content: String,
}

#[derive(Debug, Serialize)]
struct SearchResponse {
    ok: bool,
    results: Vec<SearchResult>,
}

#[derive(Debug, Serialize)]
struct SearchResult {
    date: String,
    line: usize,
    preview: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchOptions {
    limit: Option<usize>,
    case_sensitive: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ExportPayload {
    kind: String,
    date: Option<String>,
    from: Option<String>,
    to: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResponse {
    ok: bool,
    canceled: bool,
    file_path: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupResponse {
    ok: bool,
    canceled: bool,
    backup_path: Option<String>,
}

#[derive(Debug, Serialize)]
struct ChooseDirResponse {
    ok: bool,
    canceled: bool,
    path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct IcsEvent {
    uid: String,
    date: String,
    time: String,
    all_day: bool,
    summary: String,
    description: String,
    location: String,
    source: String,
}

#[derive(Debug, Serialize)]
struct IcsSourceResponse {
    ok: bool,
    url: String,
    dates: Vec<String>,
    events: Vec<IcsEvent>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct IcsResponse {
    ok: bool,
    dates: Vec<String>,
    events: Vec<IcsEvent>,
    sources: Vec<IcsSourceResponse>,
}

fn is_valid_date(v: &str) -> bool {
    let b = v.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn assert_valid_date(v: &str) -> Result<(), String> {
    if is_valid_date(v) {
        Ok(())
    } else {
        Err("Invalid date".to_string())
    }
}

fn is_valid_theme_mode(v: &str) -> bool {
    matches!(v, "light" | "dark" | "auto")
}

fn is_valid_time_hhmm(v: &str) -> bool {
    let b = v.as_bytes();
    if b.len() != 5 || b[2] != b':' {
        return false;
    }
    let h = v[0..2].parse::<u32>().unwrap_or(99);
    let m = v[3..5].parse::<u32>().unwrap_or(99);
    h <= 23 && m <= 59
}

fn normalize_settings(input: Settings) -> Settings {
    let defaults = Settings::default();
    Settings {
        template: input.template,
        storage_dir: input.storage_dir,
        backup_dir: input.backup_dir,
        theme_mode: if is_valid_theme_mode(&input.theme_mode) {
            input.theme_mode
        } else {
            defaults.theme_mode
        },
        auto_dark_start: if is_valid_time_hhmm(&input.auto_dark_start) {
            input.auto_dark_start
        } else {
            defaults.auto_dark_start
        },
        auto_dark_end: if is_valid_time_hhmm(&input.auto_dark_end) {
            input.auto_dark_end
        } else {
            defaults.auto_dark_end
        },
        ics_feeds: input.ics_feeds,
    }
}

fn merge_partial(current: Settings, next: PartialSettings) -> Settings {
    normalize_settings(Settings {
        template: next.template.unwrap_or(current.template),
        storage_dir: next.storage_dir.unwrap_or(current.storage_dir),
        backup_dir: next.backup_dir.unwrap_or(current.backup_dir),
        theme_mode: next.theme_mode.unwrap_or(current.theme_mode),
        auto_dark_start: next.auto_dark_start.unwrap_or(current.auto_dark_start),
        auto_dark_end: next.auto_dark_end.unwrap_or(current.auto_dark_end),
        ics_feeds: next.ics_feeds.unwrap_or(current.ics_feeds),
    })
}

fn app_data_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().unwrap_or_else(|_| {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Noteslip")
    });
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_path(app)?.join(SETTINGS_FILE))
}

fn load_settings_from_disk(app: &tauri::AppHandle) -> Settings {
    let path = match settings_path(app) {
        Ok(path) => path,
        Err(_) => return Settings::default(),
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return Settings::default();
    };
    serde_json::from_str::<Settings>(&raw)
        .map(normalize_settings)
        .unwrap_or_default()
}

fn get_settings(app: &tauri::AppHandle, state: &State<AppState>) -> Settings {
    let mut guard = state.settings_cache.lock().expect("settings lock poisoned");
    if let Some(settings) = guard.clone() {
        return settings;
    }
    let settings = load_settings_from_disk(app);
    *guard = Some(settings.clone());
    settings
}

fn save_settings_to_disk(
    app: &tauri::AppHandle,
    state: &State<AppState>,
    settings: Settings,
) -> Result<Settings, String> {
    let normalized = normalize_settings(settings);
    let path = settings_path(app)?;
    let raw = serde_json::to_string_pretty(&normalized).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())?;
    *state.settings_cache.lock().expect("settings lock poisoned") = Some(normalized.clone());
    Ok(normalized)
}

fn logs_dir(app: &tauri::AppHandle, settings: &Settings) -> Result<PathBuf, String> {
    let trimmed = settings.storage_dir.trim();
    if trimmed.is_empty() {
        Ok(app_data_path(app)?.join("daily-logs"))
    } else {
        Ok(PathBuf::from(trimmed))
    }
}

fn ensure_logs_dir(app: &tauri::AppHandle, settings: &Settings) -> Result<PathBuf, String> {
    let dir = logs_dir(app, settings)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn compare_date_asc(a: &str, b: &str) -> std::cmp::Ordering {
    a.cmp(b)
}

fn format_timestamp_for_path() -> String {
    let d = Local::now();
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        d.year(),
        d.month(),
        d.day(),
        d.hour(),
        d.minute(),
        d.second()
    )
}

fn list_log_dates_impl(app: &tauri::AppHandle, state: &State<AppState>) -> Result<Vec<String>, String> {
    let settings = get_settings(app, state);
    let dir = ensure_logs_dir(app, &settings)?;
    let mut dates = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(base) = name.strip_suffix(".md") else {
            continue;
        };
        if is_valid_date(base) {
            dates.push(base.to_string());
        }
    }
    dates.sort_by(|a, b| b.cmp(a));
    Ok(dates)
}

fn read_log_impl(
    app: &tauri::AppHandle,
    state: &State<AppState>,
    date: String,
) -> Result<ReadLogResponse, String> {
    assert_valid_date(&date)?;
    let settings = get_settings(app, state);
    let dir = ensure_logs_dir(app, &settings)?;
    let path = dir.join(format!("{date}.md"));
    match fs::read_to_string(path) {
        Ok(content) => Ok(ReadLogResponse {
            ok: true,
            date,
            exists: true,
            content,
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(ReadLogResponse {
            ok: true,
            content: settings.template.replace("{{date}}", &date),
            date,
            exists: false,
        }),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn logs_today() -> String {
    let now = Local::now();
    format!("{:04}-{:02}-{:02}", now.year(), now.month(), now.day())
}

#[tauri::command]
fn logs_list(app: tauri::AppHandle, state: State<AppState>) -> Result<Vec<String>, String> {
    list_log_dates_impl(&app, &state)
}

#[tauri::command]
fn logs_read(
    app: tauri::AppHandle,
    state: State<AppState>,
    date: String,
) -> Result<ReadLogResponse, String> {
    read_log_impl(&app, &state, date)
}

#[tauri::command]
fn logs_write(
    app: tauri::AppHandle,
    state: State<AppState>,
    date: String,
    content: String,
) -> Result<OkResponse, String> {
    assert_valid_date(&date)?;
    let settings = get_settings(&app, &state);
    let dir = ensure_logs_dir(&app, &settings)?;
    fs::write(dir.join(format!("{date}.md")), content).map_err(|e| e.to_string())?;
    Ok(OkResponse { ok: true })
}

#[tauri::command]
fn logs_search(
    app: tauri::AppHandle,
    state: State<AppState>,
    query: String,
    options: Option<SearchOptions>,
) -> Result<SearchResponse, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(SearchResponse {
            ok: true,
            results: Vec::new(),
        });
    }
    let options = options.unwrap_or(SearchOptions {
        limit: Some(100),
        case_sensitive: Some(false),
    });
    let limit = options.limit.unwrap_or(100).clamp(1, 500);
    let case_sensitive = options.case_sensitive.unwrap_or(false);
    let needle = if case_sensitive { q.clone() } else { q.to_lowercase() };
    let mut results = Vec::new();

    for date in list_log_dates_impl(&app, &state)? {
        let read = read_log_impl(&app, &state, date.clone())?;
        for (i, line) in read.content.lines().enumerate() {
            let hay = if case_sensitive {
                line.to_string()
            } else {
                line.to_lowercase()
            };
            if hay.contains(&needle) {
                results.push(SearchResult {
                    date: date.clone(),
                    line: i + 1,
                    preview: line.chars().take(300).collect(),
                });
                if results.len() >= limit {
                    return Ok(SearchResponse { ok: true, results });
                }
            }
        }
    }

    Ok(SearchResponse { ok: true, results })
}

#[tauri::command]
fn settings_get(app: tauri::AppHandle, state: State<AppState>) -> SettingsResponse {
    SettingsResponse {
        ok: true,
        settings: get_settings(&app, &state),
    }
}

#[tauri::command]
fn settings_set(
    app: tauri::AppHandle,
    state: State<AppState>,
    settings: PartialSettings,
    migrate: bool,
) -> Result<SettingsResponse, String> {
    let current = get_settings(&app, &state);
    let old_dir = logs_dir(&app, &current)?;
    let next = merge_partial(current, settings);
    let saved = save_settings_to_disk(&app, &state, next)?;
    let new_dir = logs_dir(&app, &saved)?;
    if migrate && old_dir != new_dir {
        migrate_logs_dir(&old_dir, &new_dir)?;
    }
    Ok(SettingsResponse {
        ok: true,
        settings: saved,
    })
}

#[tauri::command]
fn dialogs_choose_dir(app: tauri::AppHandle, title: Option<String>) -> ChooseDirResponse {
    let picked = app
        .dialog()
        .file()
        .set_title(title.unwrap_or_else(|| "选择目录".to_string()))
        .blocking_pick_folder();
    match picked {
        Some(path) => ChooseDirResponse {
            ok: true,
            canceled: false,
            path: Some(path.to_string()),
        },
        None => ChooseDirResponse {
            ok: true,
            canceled: true,
            path: None,
        },
    }
}

#[tauri::command]
fn logs_open_dir(app: tauri::AppHandle, state: State<AppState>) -> Result<String, String> {
    let settings = get_settings(&app, &state);
    let dir = ensure_logs_dir(&app, &settings)?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn logs_backup_now(
    app: tauri::AppHandle,
    state: State<AppState>,
) -> Result<BackupResponse, String> {
    let settings = get_settings(&app, &state);
    let mut backup_dir = settings.backup_dir.trim().to_string();
    if backup_dir.is_empty() {
        let picked = app
            .dialog()
            .file()
            .set_title("选择备份目录")
            .blocking_pick_folder();
        let Some(path) = picked else {
            return Ok(BackupResponse {
                ok: true,
                canceled: true,
                backup_path: None,
            });
        };
        backup_dir = path.to_string();
        let saved = Settings {
            backup_dir: backup_dir.clone(),
            ..settings
        };
        save_settings_to_disk(&app, &state, saved)?;
    }

    let settings = get_settings(&app, &state);
    let src = ensure_logs_dir(&app, &settings)?;
    let dest = PathBuf::from(backup_dir).join(format!("noteslip-backup-{}", format_timestamp_for_path()));
    copy_dir_md_files(&src, &dest)?;
    Ok(BackupResponse {
        ok: true,
        canceled: false,
        backup_path: Some(dest.to_string_lossy().to_string()),
    })
}

#[tauri::command]
fn logs_export(
    app: tauri::AppHandle,
    state: State<AppState>,
    payload: ExportPayload,
) -> Result<ExportResponse, String> {
    let all_dates = list_log_dates_impl(&app, &state)?;
    let settings = get_settings(&app, &state);
    let dir = logs_dir(&app, &settings)?;
    let mut dates = Vec::new();

    match payload.kind.as_str() {
        "current" => {
            let date = payload.date.ok_or_else(|| "Invalid export date".to_string())?;
            assert_valid_date(&date)?;
            dates.push(date);
        }
        "range" => {
            let from = payload.from.ok_or_else(|| "Invalid export range".to_string())?;
            let to = payload.to.ok_or_else(|| "Invalid export range".to_string())?;
            assert_valid_date(&from)?;
            assert_valid_date(&to)?;
            let (a, b) = if from < to { (from, to) } else { (to, from) };
            dates = all_dates
                .into_iter()
                .filter(|d| d >= &a && d <= &b)
                .collect();
            dates.sort_by(|a, b| compare_date_asc(a, b));
        }
        "all" => {
            dates = all_dates;
            dates.sort_by(|a, b| compare_date_asc(a, b));
        }
        _ => return Err("Invalid export kind".to_string()),
    }

    if dates.is_empty() {
        return Ok(ExportResponse {
            ok: false,
            canceled: false,
            file_path: None,
            message: Some(if payload.kind == "range" {
                "范围内没有可导出的日志".to_string()
            } else {
                "没有可导出的日志".to_string()
            }),
        });
    }

    let default_name = match payload.kind.as_str() {
        "current" => format!("{}.md", dates[0]),
        "range" => format!("{}_{}.md", dates[0], dates[dates.len() - 1]),
        _ => format!("noteslip_all_{}.md", format_timestamp_for_path()),
    };
    let default_dir = app.path().document_dir().unwrap_or_else(|_| PathBuf::from("."));
    let picked = app
        .dialog()
        .file()
        .set_title("导出日志")
        .set_directory(default_dir)
        .set_file_name(&default_name)
        .add_filter("Markdown", &["md"])
        .add_filter("Text", &["txt"])
        .blocking_save_file();

    let Some(file_path) = picked else {
        return Ok(ExportResponse {
            ok: true,
            canceled: true,
            file_path: None,
            message: None,
        });
    };

    let mut parts = Vec::new();
    for date in &dates {
        let content = fs::read_to_string(dir.join(format!("{date}.md"))).unwrap_or_default();
        if payload.kind == "current" {
            parts.push(content);
        } else {
            parts.push(format!("# {date}\n\n{}\n", content.trim_end()));
        }
    }

    fs::write(file_path.as_path().ok_or_else(|| "Invalid export path".to_string())?, parts.join("\n")).map_err(|e| e.to_string())?;
    Ok(ExportResponse {
        ok: true,
        canceled: false,
        file_path: Some(file_path.to_string()),
        message: None,
    })
}

#[tauri::command]
async fn calendar_ics_dates(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<IcsResponse, String> {
    let settings = get_settings(&app, &state);
    let urls: Vec<String> = settings
        .ics_feeds
        .lines()
        .map(normalize_ics_url)
        .filter(|s| !s.is_empty())
        .collect();
    if urls.is_empty() {
        return Ok(IcsResponse {
            ok: true,
            dates: Vec::new(),
            events: Vec::new(),
            sources: Vec::new(),
        });
    }

    let mut sources = Vec::new();
    let mut all_dates = BTreeSet::new();
    let mut all_events = Vec::new();
    for url in urls {
        let source = fetch_ics_feed_dates(&url).await;
        for d in &source.dates {
            all_dates.insert(d.clone());
        }
        all_events.extend(source.events.clone());
        sources.push(source);
    }

    Ok(IcsResponse {
        ok: true,
        dates: all_dates.into_iter().collect(),
        events: all_events,
        sources,
    })
}

fn migrate_logs_dir(old_dir: &Path, new_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(new_dir).map_err(|e| e.to_string())?;
    let entries = match fs::read_dir(old_dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        let name = entry.file_name();
        if !name.to_string_lossy().ends_with(".md") {
            continue;
        }
        let dest = new_dir.join(name);
        if dest.exists() {
            continue;
        }
        fs::copy(entry.path(), dest).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn copy_dir_md_files(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        let name = entry.file_name();
        if name.to_string_lossy().ends_with(".md") {
            fs::copy(entry.path(), dest.join(name)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn normalize_ics_url(url_like: &str) -> String {
    let s = url_like.trim();
    if s.is_empty() || s.starts_with('#') {
        return String::new();
    }
    if let Some(rest) = s.strip_prefix("webcal://") {
        format!("https://{rest}")
    } else {
        s.to_string()
    }
}

fn ics_url_candidates(url_like: &str) -> Vec<String> {
    let normalized = normalize_ics_url(url_like);
    if normalized.is_empty() {
        return Vec::new();
    }
    let Ok(mut url) = Url::parse(&normalized) else {
        return Vec::new();
    };
    let compact_path = url.path().replace("//", "/");
    url.set_path(&compact_path);
    let mut out = vec![url.to_string()];
    if url.scheme() == "https" {
        let mut http = url;
        let _ = http.set_scheme("http");
        out.push(http.to_string());
    }
    out.dedup();
    out
}

fn parse_ics_date_value(v: &str) -> String {
    let s = v.trim();
    if s.len() < 8 || !s[..8].chars().all(|c| c.is_ascii_digit()) {
        return String::new();
    }
    format!("{}-{}-{}", &s[0..4], &s[4..6], &s[6..8])
}

fn unescape_ics_text(v: &str) -> String {
    v.replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
        .trim()
        .to_string()
}

fn parse_ics_datetime_info(name_part: &str, value: &str) -> Option<(String, String, bool)> {
    let raw = value.trim();
    let date = parse_ics_date_value(raw);
    if !is_valid_date(&date) {
        return None;
    }
    let value_type_date = name_part
        .split(';')
        .any(|part| part.eq_ignore_ascii_case("VALUE=DATE"));
    let has_time = !value_type_date && raw.len() >= 15 && raw.as_bytes().get(8) == Some(&b'T');
    let time = if has_time {
        format!("{}:{}", &raw[9..11], &raw[11..13])
    } else {
        String::new()
    };
    Some((date, time, !has_time))
}

fn unfold_ics_lines(raw: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in raw.lines() {
        if out.is_empty() {
            out.push(line.to_string());
            continue;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            if let Some(last) = out.last_mut() {
                last.push_str(&line[1..]);
            }
        } else {
            out.push(line.to_string());
        }
    }
    out
}

fn parse_ics_events(text: &str, source_url: &str) -> (Vec<String>, Vec<IcsEvent>) {
    let lines = unfold_ics_lines(text);
    let mut dates = BTreeSet::new();
    let mut events = Vec::new();
    let mut current: Option<IcsEvent> = None;

    for line in lines {
        match line.as_str() {
            "BEGIN:VEVENT" => {
                current = Some(IcsEvent {
                    uid: String::new(),
                    date: String::new(),
                    time: String::new(),
                    all_day: true,
                    summary: String::new(),
                    description: String::new(),
                    location: String::new(),
                    source: source_url.to_string(),
                });
                continue;
            }
            "END:VEVENT" => {
                if let Some(mut event) = current.take() {
                    if is_valid_date(&event.date) {
                        if event.uid.is_empty() {
                            event.uid = format!("{}|{}|{}", event.date, event.summary, event.time);
                        }
                        if event.summary.is_empty() {
                            event.summary = "(Untitled)".to_string();
                        }
                        dates.insert(event.date.clone());
                        events.push(event);
                    }
                }
                continue;
            }
            _ => {}
        }

        let Some(event) = current.as_mut() else {
            continue;
        };
        let Some(idx) = line.find(':') else {
            continue;
        };
        let name_part = &line[..idx];
        let value = &line[idx + 1..];
        let prop_name = name_part.split(';').next().unwrap_or("").to_ascii_uppercase();
        match prop_name.as_str() {
            "DTSTART" => {
                if let Some((date, time, all_day)) = parse_ics_datetime_info(name_part, value) {
                    event.date = date;
                    event.time = time;
                    event.all_day = all_day;
                }
            }
            "SUMMARY" => event.summary = unescape_ics_text(value),
            "DESCRIPTION" => event.description = unescape_ics_text(value),
            "LOCATION" => event.location = unescape_ics_text(value),
            "UID" => event.uid = unescape_ics_text(value),
            _ => {}
        }
    }

    events.sort_by(|a, b| {
        a.date
            .cmp(&b.date)
            .then_with(|| a.time.cmp(&b.time))
            .then_with(|| a.summary.cmp(&b.summary))
    });
    (dates.into_iter().collect(), events)
}

async fn fetch_ics_feed_dates(url: &str) -> IcsSourceResponse {
    let candidates = ics_url_candidates(url);
    if candidates.is_empty() {
        return IcsSourceResponse {
            ok: false,
            url: url.to_string(),
            dates: Vec::new(),
            events: Vec::new(),
            error: Some("Invalid ICS URL".to_string()),
        };
    }

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent(APP_USER_AGENT)
        .build()
    {
        Ok(client) => client,
        Err(e) => {
            return IcsSourceResponse {
                ok: false,
                url: url.to_string(),
                dates: Vec::new(),
                events: Vec::new(),
                error: Some(e.to_string()),
            }
        }
    };

    let mut last_err = "Fetch failed".to_string();
    for candidate in candidates {
        match client
            .get(&candidate)
            .header("Accept", "text/calendar,text/plain;q=0.9,*/*;q=0.8")
            .header("Accept-Language", "en-GB,en;q=0.9")
            .send()
            .await
        {
            Ok(res) if res.status().is_success() => match res.text().await {
                Ok(body) => {
                    let (dates, events) = parse_ics_events(&body, &candidate);
                    return IcsSourceResponse {
                        ok: true,
                        url: candidate,
                        dates,
                        events,
                        error: None,
                    };
                }
                Err(e) => last_err = e.to_string(),
            },
            Ok(res) => last_err = format!("HTTP {}", res.status()),
            Err(e) => last_err = e.to_string(),
        }
    }

    IcsSourceResponse {
        ok: false,
        url: url.to_string(),
        dates: Vec::new(),
        events: Vec::new(),
        error: Some(last_err),
    }
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let file = SubmenuBuilder::new(app, "文件")
        .text("export", "导出...")
        .separator()
        .text("open_logs_dir", "打开日志目录")
        .text("backup_now", "立即备份...")
        .separator()
        .text("settings", "设置...")
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let help = SubmenuBuilder::new(app, "帮助")
        .text("help", "使用帮助")
        .text("learn_more", "关于软件")
        .build()?;
    MenuBuilder::new(app)
        .item(&file)
        .item(&edit)
        .item(&help)
        .build()
}

fn handle_menu_event(app: &tauri::AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    let action = match id {
        "export" => Some("export"),
        "settings" => Some("settings"),
        "help" => Some("help"),
        "learn_more" => Some("learnMore"),
        "open_logs_dir" => {
            let state = app.state::<AppState>();
            let _ = logs_open_dir(app.clone(), state);
            None
        }
        "backup_now" => {
            let state = app.state::<AppState>();
            let _ = logs_backup_now(app.clone(), state);
            None
        }
        _ => None,
    };
    if let Some(action) = action {
        let _ = app.emit("menu:action", action);
    }
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            settings_cache: Mutex::new(None),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .menu(build_menu)
        .on_menu_event(handle_menu_event)
        .invoke_handler(tauri::generate_handler![
            logs_today,
            logs_list,
            logs_read,
            logs_write,
            logs_search,
            logs_export,
            logs_open_dir,
            logs_backup_now,
            settings_get,
            settings_set,
            dialogs_choose_dir,
            calendar_ics_dates
        ])
        .run(tauri::generate_context!())
        .expect("error while running Noteslip");
}
