const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs/promises");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SETTINGS_FILE = "settings.json";
const DEFAULT_SETTINGS = {
  template: `# {{date}}

## 记录
- 
`,
  storageDir: "",
  backupDir: "",
  themeMode: "auto",
  autoDarkStart: "19:00",
  autoDarkEnd: "07:00",
  icsFeeds: ""
};

let settingsCache = null;
let mainWindow = null;

function getDialogParentWindow() {
  return BrowserWindow.getFocusedWindow() || mainWindow || undefined;
}

function getActiveWindow() {
  return BrowserWindow.getFocusedWindow() || mainWindow || null;
}

function dispatchMenuAction(action) {
  const win = getActiveWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send("menu:action", String(action || ""));
}

function assertValidDate(date) {
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    throw new Error("Invalid date");
  }
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

async function loadSettings() {
  try {
    const raw = await fs.readFile(getSettingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch (e) {
    if (e && e.code === "ENOENT") return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS };
  }
}

async function getSettings() {
  if (!settingsCache) settingsCache = await loadSettings();
  return settingsCache;
}

async function saveSettings(next) {
  const merged = normalizeSettings(next);
  settingsCache = merged;
  await fs.writeFile(getSettingsPath(), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

function isValidThemeMode(v) {
  return v === "light" || v === "dark" || v === "auto";
}

function isValidTimeHHMM(v) {
  return typeof v === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
}

function normalizeSettings(input) {
  const merged = { ...DEFAULT_SETTINGS, ...(input || {}) };
  merged.template = String(merged.template ?? DEFAULT_SETTINGS.template);
  merged.storageDir = String(merged.storageDir ?? "");
  merged.backupDir = String(merged.backupDir ?? "");
  merged.themeMode = isValidThemeMode(merged.themeMode) ? merged.themeMode : DEFAULT_SETTINGS.themeMode;
  merged.autoDarkStart = isValidTimeHHMM(merged.autoDarkStart) ? merged.autoDarkStart : DEFAULT_SETTINGS.autoDarkStart;
  merged.autoDarkEnd = isValidTimeHHMM(merged.autoDarkEnd) ? merged.autoDarkEnd : DEFAULT_SETTINGS.autoDarkEnd;
  merged.icsFeeds = String(merged.icsFeeds ?? "");
  return merged;
}

function getLogsDirSync(settings) {
  const storageDir = settings && typeof settings.storageDir === "string" ? settings.storageDir.trim() : "";
  if (storageDir) return storageDir;
  return path.join(app.getPath("userData"), "daily-logs");
}

async function ensureLogsDir() {
  const settings = await getSettings();
  await fs.mkdir(getLogsDirSync(settings), { recursive: true });
}

function getLogPath(date) {
  assertValidDate(date);
  const logsDir = getLogsDirSync(settingsCache || DEFAULT_SETTINGS);
  return path.join(logsDir, `${date}.md`);
}

function getTodayDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function listLogDates() {
  await ensureLogsDir();
  const settings = await getSettings();
  const entries = await fs.readdir(getLogsDirSync(settings), { withFileTypes: true });
  const dates = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    const base = entry.name.slice(0, -3);
    if (!DATE_RE.test(base)) continue;
    dates.push(base);
  }

  dates.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return dates;
}

async function readLog(date) {
  await ensureLogsDir();
  const settings = await getSettings();
  const filePath = path.join(getLogsDirSync(settings), `${date}.md`);
  try {
    const content = await fs.readFile(filePath, "utf8");
    return { ok: true, date, exists: true, content };
  } catch (e) {
    if (e && e.code === "ENOENT") {
      const template = String(settings.template ?? "");
      const content = template ? template.replaceAll("{{date}}", date) : "";
      return { ok: true, date, exists: false, content };
    }
    throw e;
  }
}

async function writeLog(date, content) {
  await ensureLogsDir();
  const settings = await getSettings();
  const filePath = path.join(getLogsDirSync(settings), `${date}.md`);
  await fs.writeFile(filePath, String(content ?? ""), "utf8");
}

function compareDateAsc(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function formatTimestampForPath(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function copyDirMdFiles(srcDir, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    await fs.copyFile(path.join(srcDir, entry.name), path.join(destDir, entry.name));
  }
}

async function migrateLogsDir(oldDir, newDir) {
  await fs.mkdir(newDir, { recursive: true });
  const entries = await fs.readdir(oldDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    const src = path.join(oldDir, entry.name);
    const dst = path.join(newDir, entry.name);
    const stat = await fs.stat(dst).catch(() => null);
    if (stat) continue;
    await fs.copyFile(src, dst);
  }
}

async function searchLogs(query, options) {
  const q = String(query ?? "");
  if (!q.trim()) return [];
  const limit = Math.max(1, Math.min(500, Number(options?.limit ?? 100)));
  const caseSensitive = Boolean(options?.caseSensitive);
  const needle = caseSensitive ? q : q.toLowerCase();
  const dates = await listLogDates();
  const results = [];

  for (const date of dates) {
    const { content } = await readLog(date);
    const lines = String(content ?? "").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
      if (!hay.includes(needle)) continue;
      results.push({ date, line: i + 1, preview: String(lines[i] ?? "").slice(0, 300) });
      if (results.length >= limit) return results;
    }
  }

  return results;
}

async function exportLogs(payload) {
  const kind = String(payload?.kind ?? "");
  const datesAll = await listLogDates();
  const settings = await getSettings();
  const logsDir = getLogsDirSync(settings);

  let dates = [];
  if (kind === "current") {
    const date = String(payload?.date ?? "");
    assertValidDate(date);
    dates = [date];
  } else if (kind === "range") {
    const from = String(payload?.from ?? "");
    const to = String(payload?.to ?? "");
    assertValidDate(from);
    assertValidDate(to);
    const a = from < to ? from : to;
    const b = from < to ? to : from;
    dates = datesAll.filter((d) => d >= a && d <= b).sort(compareDateAsc);
  } else if (kind === "all") {
    dates = [...datesAll].sort(compareDateAsc);
  } else {
    throw new Error("Invalid export kind");
  }

  if (!dates.length) {
    const msg = kind === "range" ? "范围内没有可导出的日志" : "没有可导出的日志";
    return { ok: false, canceled: false, message: msg };
  }

  const defaultName =
    kind === "current"
      ? `${dates[0]}.md`
      : kind === "range"
        ? `${dates[0] || "logs"}_${dates[dates.length - 1] || "range"}.md`
        : `noteslip_all_${formatTimestampForPath(new Date())}.md`;

  const { canceled, filePath } = await dialog.showSaveDialog(getDialogParentWindow(), {
    title: "导出日志",
    defaultPath: path.join(app.getPath("documents"), defaultName),
    filters: [{ name: "Markdown", extensions: ["md"] }, { name: "Text", extensions: ["txt"] }, { name: "All Files", extensions: ["*"] }]
  });

  if (canceled || !filePath) return { ok: true, canceled: true };

  const parts = [];
  for (const date of dates) {
    const p = path.join(logsDir, `${date}.md`);
    const content = await fs.readFile(p, "utf8").catch(() => "");
    if (kind === "current") {
      parts.push(String(content ?? ""));
    } else {
      parts.push(`# ${date}\n\n${String(content ?? "").trimEnd()}\n`);
    }
  }

  await fs.writeFile(filePath, parts.join("\n"), "utf8");
  return { ok: true, canceled: false, filePath };
}

function normalizeIcsUrl(urlLike) {
  const s = String(urlLike ?? "").trim();
  if (!s) return "";
  if (s.startsWith("#")) return "";
  if (s.startsWith("webcal://")) return `https://${s.slice("webcal://".length)}`;
  return s;
}

function getIcsUrlCandidates(urlLike) {
  const normalized = normalizeIcsUrl(urlLike);
  if (!normalized) return [];
  const candidates = [];
  try {
    const u = new URL(normalized);
    // Some calendar providers return 500 when pathname contains duplicated slashes.
    u.pathname = u.pathname.replace(/\/{2,}/g, "/");
    candidates.push(u.toString());
    if (u.protocol === "https:") {
      const http = new URL(u.toString());
      http.protocol = "http:";
      candidates.push(http.toString());
    }
  } catch (_e) {
    return [];
  }
  return [...new Set(candidates)];
}

function parseIcsDateValue(v) {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function unescapeIcsText(v) {
  return String(v ?? "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseIcsDateTimeInfo(namePart, value) {
  const raw = String(value ?? "").trim();
  const date = parseIcsDateValue(raw);
  if (!DATE_RE.test(date)) return null;
  const valueTypeDate = /(?:^|;)VALUE=DATE(?:;|$)/i.test(String(namePart || ""));
  const hasTime = !valueTypeDate && /^\d{8}T\d{6}/.test(raw);
  const time = hasTime ? `${raw.slice(9, 11)}:${raw.slice(11, 13)}` : "";
  return { date, time, allDay: !hasTime };
}

function unfoldIcsLines(raw) {
  const lines = String(raw ?? "").split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!out.length) {
      out.push(line);
      continue;
    }
    if (line.startsWith(" ") || line.startsWith("\t")) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function parseIcsEvents(text, sourceUrl) {
  const lines = unfoldIcsLines(text);
  const dates = new Set();
  const events = [];
  let inEvent = false;
  let current = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      current = { uid: "", summary: "", description: "", location: "", date: "", time: "", allDay: true };
      continue;
    }
    if (line === "END:VEVENT") {
      if (current && DATE_RE.test(current.date)) {
        const event = {
          uid: current.uid || `${current.date}|${current.summary}|${current.time}`,
          date: current.date,
          time: current.time || "",
          allDay: Boolean(current.allDay),
          summary: current.summary || "(Untitled)",
          description: current.description || "",
          location: current.location || "",
          source: sourceUrl
        };
        dates.add(event.date);
        events.push(event);
      }
      current = null;
      inEvent = false;
      continue;
    }
    if (!inEvent || !current) continue;

    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const namePart = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const propName = namePart.split(";")[0].toUpperCase();

    if (propName === "DTSTART") {
      const info = parseIcsDateTimeInfo(namePart, value);
      if (info) {
        current.date = info.date;
        current.time = info.time;
        current.allDay = info.allDay;
      }
      continue;
    }

    if (propName === "SUMMARY") {
      current.summary = unescapeIcsText(value);
      continue;
    }

    if (propName === "DESCRIPTION") {
      current.description = unescapeIcsText(value);
      continue;
    }

    if (propName === "LOCATION") {
      current.location = unescapeIcsText(value);
      continue;
    }

    if (propName === "UID") {
      current.uid = unescapeIcsText(value);
    }
  }

  events.sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    if (a.time < b.time) return -1;
    if (a.time > b.time) return 1;
    return a.summary.localeCompare(b.summary);
  });
  return { dates: [...dates], events };
}

async function fetchIcsFeedDates(url) {
  const candidates = getIcsUrlCandidates(url);
  if (!candidates.length) {
    return { ok: false, url, dates: [], error: "Invalid ICS URL" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    let lastErr = "Fetch failed";
    for (const candidate of candidates) {
      try {
        const res = await fetch(candidate, {
          signal: controller.signal,
          redirect: "follow",
          headers: {
            Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
            "User-Agent": "Noteslip/26"
          }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.text();
        const parsed = parseIcsEvents(body, candidate);
        return { ok: true, url: candidate, dates: parsed.dates, events: parsed.events };
      } catch (e) {
        lastErr = e && e.message ? String(e.message) : "Fetch failed";
      }
    }
    return { ok: false, url, dates: [], events: [], error: lastErr };
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Fetch failed";
    return { ok: false, url, dates: [], events: [], error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchIcsDatesFromSettings() {
  const settings = await getSettings();
  const urls = String(settings.icsFeeds ?? "")
    .split(/\r?\n/)
    .map(normalizeIcsUrl)
    .filter(Boolean);
  if (!urls.length) return { ok: true, dates: [], sources: [] };
  const sources = await Promise.all(urls.map((u) => fetchIcsFeedDates(u)));
  const allDates = new Set();
  const allEvents = [];
  for (const source of sources) {
    for (const d of source.dates || []) allDates.add(d);
    for (const ev of source.events || []) allEvents.push(ev);
  }
  return { ok: true, dates: [...allDates].sort(compareDateAsc), events: allEvents, sources };
}

async function openLogsDir() {
  const settings = await getSettings();
  const logsDir = getLogsDirSync(settings);
  await fs.mkdir(logsDir, { recursive: true });
  return shell.openPath(logsDir);
}

async function backupNow() {
  const settings = await getSettings();
  let backupDir = String(settings.backupDir ?? "").trim();
  if (!backupDir) {
    const picked = await dialog.showOpenDialog(getDialogParentWindow(), {
      title: "选择备份目录",
      properties: ["openDirectory", "createDirectory"]
    });
    if (picked.canceled || !picked.filePaths || !picked.filePaths[0]) return { ok: true, canceled: true };
    backupDir = picked.filePaths[0];
    await saveSettings({ ...settings, backupDir });
  }

  const logsDir = getLogsDirSync(await getSettings());
  await fs.mkdir(logsDir, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });

  const dest = path.join(backupDir, `noteslip-backup-${formatTimestampForPath(new Date())}`);
  await copyDirMdFiles(logsDir, dest);
  return { ok: true, canceled: false, backupPath: dest };
}

async function chooseDirectoryDialog(title) {
  const picked = await dialog.showOpenDialog(getDialogParentWindow(), {
    title: title || "选择目录",
    properties: ["openDirectory", "createDirectory"]
  });
  if (picked.canceled || !picked.filePaths || !picked.filePaths[0]) return { ok: true, canceled: true };
  return { ok: true, canceled: false, path: picked.filePaths[0] };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
}

app.whenReady().then(() => {
  getSettings().catch(() => {});

  ipcMain.handle("logs:today", async () => getTodayDate());
  ipcMain.handle("logs:list", async () => listLogDates());
  ipcMain.handle("logs:read", async (_event, date) => readLog(date));
  ipcMain.handle("logs:write", async (_event, payload) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid payload");
    const { date, content } = payload;
    await writeLog(date, content);
    return { ok: true };
  });
  ipcMain.handle("logs:search", async (_event, payload) => {
    const query = payload?.query;
    const options = payload?.options;
    return { ok: true, results: await searchLogs(query, options) };
  });
  ipcMain.handle("logs:export", async (_event, payload) => exportLogs(payload));
  ipcMain.handle("logs:openDir", async () => openLogsDir());
  ipcMain.handle("logs:backupNow", async () => backupNow());

  ipcMain.handle("settings:get", async () => ({ ok: true, settings: await getSettings() }));
  ipcMain.handle("settings:set", async (_event, payload) => {
    const current = await getSettings();
    const next = { ...current, ...(payload?.settings || {}) };
    const migrate = Boolean(payload?.migrate);
    const oldDir = getLogsDirSync(current);
    const nextSaved = await saveSettings(next);
    const newDir = getLogsDirSync(nextSaved);
    if (migrate && oldDir !== newDir) {
      await migrateLogsDir(oldDir, newDir);
    }
    return { ok: true, settings: nextSaved };
  });

  ipcMain.handle("dialogs:chooseDir", async (_event, payload) => chooseDirectoryDialog(payload?.title));
  ipcMain.handle("calendar:icsDates", async () => fetchIcsDatesFromSettings());

  createWindow();

  const menu = Menu.buildFromTemplate([
    {
      label: "文件",
      submenu: [
        {
          label: "导出...",
          click: () => dispatchMenuAction("export")
        },
        { type: "separator" },
        {
          label: "打开日志目录",
          click: async () => {
            try {
              await openLogsDir();
            } catch (_e) {}
          }
        },
        {
          label: "立即备份...",
          click: async () => {
            try {
              await backupNow();
            } catch (_e) {}
          }
        },
        { type: "separator" },
        {
          label: "设置...",
          click: () => dispatchMenuAction("settings")
        },
        { type: "separator" },
        { role: "quit", label: "退出" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "forceReload", label: "强制重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "重置缩放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "使用帮助",
          click: () => dispatchMenuAction("help")
        },
        {
          label: "关于软件",
          click: () => dispatchMenuAction("learnMore")
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

