const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs/promises");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertValidDate(date) {
  if (typeof date !== "string" || !DATE_RE.test(date)) {
    throw new Error("Invalid date");
  }
}

function getLogsDir() {
  return path.join(app.getPath("userData"), "daily-logs");
}

async function ensureLogsDir() {
  await fs.mkdir(getLogsDir(), { recursive: true });
}

function getLogPath(date) {
  assertValidDate(date);
  return path.join(getLogsDir(), `${date}.md`);
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
  const entries = await fs.readdir(getLogsDir(), { withFileTypes: true });
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
  const filePath = getLogPath(date);
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return "";
    throw e;
  }
}

async function writeLog(date, content) {
  await ensureLogsDir();
  const filePath = getLogPath(date);
  await fs.writeFile(filePath, String(content ?? ""), "utf8");
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
}

app.whenReady().then(() => {
  ipcMain.handle("logs:today", async () => getTodayDate());
  ipcMain.handle("logs:list", async () => listLogDates());
  ipcMain.handle("logs:read", async (_event, date) => readLog(date));
  ipcMain.handle("logs:write", async (_event, payload) => {
    if (!payload || typeof payload !== "object") throw new Error("Invalid payload");
    const { date, content } = payload;
    await writeLog(date, content);
    return { ok: true };
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
