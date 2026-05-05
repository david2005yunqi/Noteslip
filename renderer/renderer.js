(() => {
  if (window.noteslip || !window.__TAURI__) return;
  const invoke = window.__TAURI__.tauri.invoke;
  const listen = window.__TAURI__.event.listen;
  window.noteslip = {
    getToday: () => invoke("logs_today"),
    listLogs: () => invoke("logs_list"),
    readLog: (date) => invoke("logs_read", { date }),
    writeLog: (date, content) => invoke("logs_write", { date, content }),
    searchLogs: (query, options) => invoke("logs_search", { query, options }),
    exportLogs: (payload) => invoke("logs_export", { payload }),
    openLogsDir: () => invoke("logs_open_dir"),
    backupNow: () => invoke("logs_backup_now"),
    getSettings: () => invoke("settings_get"),
    setSettings: (settings, migrate) => invoke("settings_set", { settings, migrate }),
    chooseDir: (title) => invoke("dialogs_choose_dir", { title }),
    getIcsDates: () => invoke("calendar_ics_dates"),
    onMenuAction: (handler) => {
      if (typeof handler !== "function") return () => {};
      let unlisten = null;
      listen("menu:action", (event) => handler(event.payload)).then((fn) => {
        unlisten = fn;
      });
      return () => {
        if (unlisten) unlisten();
      };
    }
  };
})();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const APP_VERSION = "26.0.1.0";
const WEEK_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ICS_AUTO_REFRESH_MS = 30 * 60 * 1000;
function isValidDate(date) {
  return typeof date === "string" && DATE_RE.test(date);
}

function isValidTimeHHMM(v) {
  return typeof v === "string" && TIME_RE.test(v);
}

function debounce(fn, waitMs) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), waitMs);
  };
}

function setDisabled(el, disabled) {
  if (!el) return;
  el.disabled = Boolean(disabled);
}

function formatDateLocal(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDateFromYMD(ymd) {
  const [y, m, d] = String(ymd).split("-").map((n) => Number(n));
  return new Date(y, (m || 1) - 1, d || 1);
}

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function shiftMonth(base, delta) {
  return new Date(base.getFullYear(), base.getMonth() + delta, 1);
}

function dateToMinutes(hhmm) {
  const m = String(hhmm ?? "").match(TIME_RE);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

function inDarkWindow(nowMinutes, startMinutes, endMinutes) {
  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

function monthKeyFromDate(dateStr) {
  return String(dateStr || "").slice(0, 7);
}

function monthKeyFromDateObj(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function extractMarkdownTodos(md) {
  const lines = String(md ?? "").split(/\r?\n/);
  const todos = [];
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (!m) continue;
    todos.push({ done: String(m[1]).toLowerCase() === "x", text: String(m[2] || "").trim() });
  }
  return todos;
}

function groupDatesByMonth(dates) {
  const map = new Map();
  for (const d of dates) {
    const key = monthKeyFromDate(d);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(d);
  }
  return map;
}

function buildIcsEventsByDate(events) {
  const map = new Map();
  for (const ev of events || []) {
    const date = String(ev?.date || "");
    if (!isValidDate(date)) continue;
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(ev);
  }
  for (const [k, arr] of map.entries()) {
    arr.sort((a, b) => {
      const ta = String(a?.time || "");
      const tb = String(b?.time || "");
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      return String(a?.summary || "").localeCompare(String(b?.summary || ""));
    });
    map.set(k, arr);
  }
  return map;
}

const els = {
  todayBtn: document.getElementById("todayBtn"),
  searchInput: document.getElementById("searchInput"),
  clearSearchBtn: document.getElementById("clearSearchBtn"),
  listHeader: document.getElementById("listHeader"),
  logList: document.getElementById("logList"),
  currentDate: document.getElementById("currentDate"),
  status: document.getElementById("status"),
  previewBtn: document.getElementById("previewBtn"),
  editorBody: document.getElementById("editorBody"),
  content: document.getElementById("content"),
  preview: document.getElementById("preview"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  storageDirInput: document.getElementById("storageDirInput"),
  backupDirInput: document.getElementById("backupDirInput"),
  templateInput: document.getElementById("templateInput"),
  themeModeLight: document.getElementById("themeModeLight"),
  themeModeDark: document.getElementById("themeModeDark"),
  themeModeAuto: document.getElementById("themeModeAuto"),
  themeAutoRangeRow: document.getElementById("themeAutoRangeRow"),
  autoDarkStartInput: document.getElementById("autoDarkStartInput"),
  autoDarkEndInput: document.getElementById("autoDarkEndInput"),
  icsFeedsInput: document.getElementById("icsFeedsInput"),
  chooseStorageDirBtn: document.getElementById("chooseStorageDirBtn"),
  chooseBackupDirBtn: document.getElementById("chooseBackupDirBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  infoBackdrop: document.getElementById("infoBackdrop"),
  infoTitle: document.getElementById("infoTitle"),
  infoBody: document.getElementById("infoBody"),
  closeInfoBtn: document.getElementById("closeInfoBtn"),
  exportBackdrop: document.getElementById("exportBackdrop"),
  closeExportBtn: document.getElementById("closeExportBtn"),
  cancelExportBtn: document.getElementById("cancelExportBtn"),
  doExportBtn: document.getElementById("doExportBtn"),
  exportKindCurrent: document.getElementById("exportKindCurrent"),
  exportKindRange: document.getElementById("exportKindRange"),
  exportKindAll: document.getElementById("exportKindAll"),
  exportCurrentDate: document.getElementById("exportCurrentDate"),
  exportRangeRow: document.getElementById("exportRangeRow"),
  exportFrom: document.getElementById("exportFrom"),
  exportTo: document.getElementById("exportTo"),
  exportError: document.getElementById("exportError"),
  calendarPrevBtn: document.getElementById("calendarPrevBtn"),
  calendarNextBtn: document.getElementById("calendarNextBtn"),
  calendarTodayBtn: document.getElementById("calendarTodayBtn"),
  refreshIcsBtn: document.getElementById("refreshIcsBtn"),
  calendarMonthLabel: document.getElementById("calendarMonthLabel"),
  calendarWeek: document.getElementById("calendarWeek"),
  calendarGrid: document.getElementById("calendarGrid"),
  icsSummary: document.getElementById("icsSummary")
};

const state = {
  currentDate: null,
  dirty: false,
  saving: false,
  lastSavedContent: "",
  saveSeq: 0,
  savePromise: null,
  previewEnabled: false,
  settings: null,
  searchQuery: "",
  searchResults: [],
  searchSeq: 0,
  themeTimer: null,
  icsAutoRefreshTimer: null,
  icsRefreshPromise: null,
  lastIcsRefreshAt: 0,
  calendarMonth: monthStart(new Date()),
  logDates: [],
  logDatesSet: new Set(),
  icsDatesSet: new Set(),
  icsEvents: [],
  icsEventsByDate: new Map(),
  icsSources: [],
  todoByDate: new Map(),
  todoMonthKey: "",
  todoRefreshSeq: 0,
  collapsedMonths: new Set()
};

function setStatus(text) {
  els.status.textContent = text || "";
}

function setUiSaving(isSaving) {
  state.saving = Boolean(isSaving);
  setDisabled(els.todayBtn, state.saving);
  setDisabled(els.searchInput, state.saving);
  setDisabled(els.clearSearchBtn, state.saving);
  setDisabled(els.previewBtn, state.saving);
  setDisabled(els.calendarPrevBtn, state.saving);
  setDisabled(els.calendarNextBtn, state.saving);
  setDisabled(els.calendarTodayBtn, state.saving);
  setDisabled(els.refreshIcsBtn, state.saving);
  els.logList.style.pointerEvents = state.saving ? "none" : "auto";
  els.logList.style.opacity = state.saving ? "0.6" : "1";
}

function setCurrentDate(date) {
  state.currentDate = date;
  els.currentDate.textContent = date || "";
  renderActiveListItem();
  renderCalendar();
}

function getEditorContent() {
  return els.content.value ?? "";
}

function setEditorContent(text) {
  els.content.value = text ?? "";
}

function markClean(savedContent) {
  state.dirty = false;
  state.lastSavedContent = savedContent ?? "";
  setStatus("Saved");
}

function markDirty() {
  state.dirty = true;
  if (!state.saving) setStatus("Unsaved");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeMarkdownToHtml(md) {
  const src = String(md ?? "");
  const lines = src.split(/\r?\n/);
  const out = [];
  let i = 0;
  let inCode = false;

  function renderInline(text) {
    let t = escapeHtml(text);
    t = t.replace(/`([^`]+?)`/g, (_m, p1) => `<code>${p1}</code>`);
    t = t.replace(/\*\*([^\*]+?)\*\*/g, (_m, p1) => `<strong>${p1}</strong>`);
    t = t.replace(/\*([^\*]+?)\*/g, (_m, p1) => `<em>${p1}</em>`);
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, p1, p2) => {
      const url = String(p2 || "").trim();
      const safeUrl = /^(https?:\/\/|mailto:)/i.test(url) ? url : "#";
      return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">${p1}</a>`;
    });
    return t;
  }

  while (i < lines.length) {
    const line = String(lines[i] ?? "");
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      if (!inCode) {
        inCode = true;
        out.push("<pre><code>");
      } else {
        inCode = false;
        out.push("</code></pre>");
      }
      i++;
      continue;
    }

    if (inCode) {
      out.push(`${escapeHtml(line)}\n`);
      i++;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${renderInline(h[2] || "")}</h${level}>`);
      i++;
      continue;
    }

    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      const items = [];
      while (i < lines.length) {
        const m = String(lines[i] ?? "").match(/^\s*[-*]\s+(.*)$/);
        if (!m) break;
        items.push(`<li>${renderInline(m[1] || "")}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (!line.trim()) {
      out.push("");
      i++;
      continue;
    }

    out.push(`<p>${renderInline(line)}</p>`);
    i++;
  }

  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

function renderPreviewNow() {
  if (!state.previewEnabled) return;
  els.preview.innerHTML = safeMarkdownToHtml(getEditorContent());
}

const renderPreviewDebounced = debounce(renderPreviewNow, 120);

function resolveThemeMode(now = new Date()) {
  const mode = state.settings?.themeMode || "auto";
  if (mode === "light" || mode === "dark") return mode;
  const start = isValidTimeHHMM(state.settings?.autoDarkStart) ? state.settings.autoDarkStart : "19:00";
  const end = isValidTimeHHMM(state.settings?.autoDarkEnd) ? state.settings.autoDarkEnd : "07:00";
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = dateToMinutes(start);
  const endMinutes = dateToMinutes(end);
  return inDarkWindow(nowMinutes, startMinutes, endMinutes) ? "dark" : "light";
}

function applyThemeNow() {
  document.body.dataset.theme = resolveThemeMode();
}

function ensureThemeTimer() {
  if (state.themeTimer) clearInterval(state.themeTimer);
  state.themeTimer = setInterval(() => {
    if ((state.settings?.themeMode || "auto") !== "auto") return;
    applyThemeNow();
  }, 30 * 1000);
}

function syncThemeAutoRow() {
  const show = Boolean(els.themeModeAuto.checked);
  if (show) els.themeAutoRangeRow.classList.remove("hidden");
  else els.themeAutoRangeRow.classList.add("hidden");
}

function setThemeInputsFromSettings(settings) {
  const mode = settings?.themeMode || "auto";
  els.themeModeLight.checked = mode === "light";
  els.themeModeDark.checked = mode === "dark";
  els.themeModeAuto.checked = mode === "auto";
  els.autoDarkStartInput.value = isValidTimeHHMM(settings?.autoDarkStart) ? settings.autoDarkStart : "19:00";
  els.autoDarkEndInput.value = isValidTimeHHMM(settings?.autoDarkEnd) ? settings.autoDarkEnd : "07:00";
  syncThemeAutoRow();
}

function getThemeSettingsFromInputs() {
  const mode = els.themeModeLight.checked ? "light" : els.themeModeDark.checked ? "dark" : "auto";
  const autoDarkStart = isValidTimeHHMM(els.autoDarkStartInput.value) ? els.autoDarkStartInput.value : "19:00";
  const autoDarkEnd = isValidTimeHHMM(els.autoDarkEndInput.value) ? els.autoDarkEndInput.value : "07:00";
  return { mode, autoDarkStart, autoDarkEnd };
}

function renderCalendarWeek() {
  els.calendarWeek.innerHTML = "";
  for (const wd of WEEK_LABELS) {
    const item = document.createElement("div");
    item.className = "calendarWeekItem";
    item.textContent = wd;
    els.calendarWeek.appendChild(item);
  }
}

function renderCalendar() {
  const monthBase = state.calendarMonth;
  const year = monthBase.getFullYear();
  const month = monthBase.getMonth();
  els.calendarMonthLabel.textContent = `${year}-${String(month + 1).padStart(2, "0")}`;

  const firstDay = new Date(year, month, 1);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - firstWeekday);

  els.calendarGrid.innerHTML = "";
  const today = formatDateLocal(new Date());

  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    const dateStr = formatDateLocal(d);
    const day = document.createElement("button");
    day.type = "button";
    day.className = "calendarDay";
    day.textContent = String(d.getDate());
    if (d.getMonth() !== month) day.classList.add("muted");
    if (dateStr === today) day.classList.add("today");
    if (dateStr === state.currentDate) day.classList.add("active");
    if (state.logDatesSet.has(dateStr)) day.classList.add("has-log");
    if (state.icsDatesSet.has(dateStr)) day.classList.add("has-ics");
    if (state.todoByDate.has(dateStr)) day.classList.add("has-todo");
    day.addEventListener("click", () => {
      openDate(dateStr).catch(() => setStatus("Open failed"));
    });
    els.calendarGrid.appendChild(day);
  }
  renderCalendarInfo();
}

function getInfoDate() {
  const monthKey = monthKeyFromDateObj(state.calendarMonth);
  if (isValidDate(state.currentDate) && monthKeyFromDate(state.currentDate) === monthKey) return state.currentDate;
  const firstInMonth = `${monthKey}-01`;
  return isValidDate(firstInMonth) ? firstInMonth : formatDateLocal(new Date());
}

function formatIcsEventLabel(ev) {
  const prefix = ev?.allDay ? "全天" : ev?.time ? ev.time : "事件";
  const summary = String(ev?.summary || "(Untitled)");
  const location = String(ev?.location || "").trim();
  return location ? `${prefix} ${summary} @ ${location}` : `${prefix} ${summary}`;
}

function buildIcsEventMarkdown(ev) {
  const marker = `<!-- ics:${String(ev?.uid || "")} -->`;
  const line = `- [ ] ${formatIcsEventLabel(ev)}`;
  return `\n## ICS 事件\n${line}\n${marker}\n`;
}

async function insertIcsEventToDateLog(ev) {
  const suggested = isValidDate(ev?.date) ? ev.date : getInfoDate();
  const picked = window.prompt("输入要写入的日志日期（YYYY-MM-DD）", suggested);
  if (picked == null) return;
  const targetDate = String(picked).trim();
  if (!isValidDate(targetDate)) {
    setStatus("日期格式错误，需为 YYYY-MM-DD");
    return;
  }

  if (targetDate === state.currentDate && state.dirty) {
    const ok = await ensureSaved();
    if (!ok) return;
  }

  const read = await window.noteslip.readLog(targetDate);
  const oldContent = String(read?.content ?? "");
  const uid = String(ev?.uid || "");
  const marker = uid ? `<!-- ics:${uid} -->` : "";
  if (marker && oldContent.includes(marker)) {
    setStatus("该 ICS 事件已存在于目标日志");
    return;
  }

  const appendBlock = buildIcsEventMarkdown(ev);
  const prefix = oldContent.trimEnd();
  const newContent = prefix ? `${prefix}\n${appendBlock}` : appendBlock.trimStart();
  await window.noteslip.writeLog(targetDate, newContent);

  if (targetDate === state.currentDate) {
    setEditorContent(newContent);
    markClean(newContent);
    renderPreviewNow();
  }

  await refreshList();
  await refreshTodosForVisibleMonth(true);
  renderCalendarInfo();
  setStatus(`已写入 ${targetDate}`);
}

function renderCalendarInfo() {
  if (!els.icsSummary) return;
  els.icsSummary.innerHTML = "";
  const infoDate = getInfoDate();

  const title = document.createElement("div");
  title.className = "icsEmpty";
  title.textContent = `日期：${infoDate}`;
  els.icsSummary.appendChild(title);

  const failed = (state.icsSources || []).filter((s) => s && s.ok === false);
  if (failed.length) {
    const err = document.createElement("div");
    err.className = "icsError";
    const first = failed[0];
    const reason = first && first.error ? String(first.error) : "Unknown error";
    err.textContent = `订阅失败 ${failed.length} 个：${reason}`;
    els.icsSummary.appendChild(err);
  }

  const icsTitle = document.createElement("div");
  icsTitle.className = "icsEmpty";
  icsTitle.textContent = "ICS 事件";
  els.icsSummary.appendChild(icsTitle);

  const dayEvents = state.icsEventsByDate.get(infoDate) || [];
  if (!dayEvents.length) {
    const emptyEvents = document.createElement("div");
    emptyEvents.className = "icsEmpty";
    emptyEvents.textContent = "当日无 ICS 事件";
    els.icsSummary.appendChild(emptyEvents);
  } else {
    for (const ev of dayEvents) {
      const row = document.createElement("div");
      row.className = "icsInfoRow";

      const text = document.createElement("div");
      text.className = "icsInfoText";
      text.textContent = formatIcsEventLabel(ev);
      row.appendChild(text);

      const actions = document.createElement("div");
      actions.className = "icsInfoActions";

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "icsDateBtn";
      addBtn.textContent = "插入日志";
      addBtn.addEventListener("click", () => {
        insertIcsEventToDateLog(ev).catch(() => setStatus("写入日志失败"));
      });
      actions.appendChild(addBtn);

      row.appendChild(actions);
      els.icsSummary.appendChild(row);
    }
  }

  const todoTitle = document.createElement("div");
  todoTitle.className = "icsEmpty";
  todoTitle.textContent = "日志 TODO";
  els.icsSummary.appendChild(todoTitle);

  const todos = state.todoByDate.get(infoDate) || [];
  if (!todos.length) {
    const emptyTodos = document.createElement("div");
    emptyTodos.className = "icsEmpty";
    emptyTodos.textContent = "当日无 Markdown TODO";
    els.icsSummary.appendChild(emptyTodos);
  } else {
    for (const td of todos) {
      const t = document.createElement("div");
      t.className = td.done ? "icsTodoDone" : "icsTodoOpen";
      t.textContent = `${td.done ? "[x]" : "[ ]"} ${td.text}`;
      els.icsSummary.appendChild(t);
    }
  }
}

async function refreshTodosForVisibleMonth(force = false) {
  const monthKey = monthKeyFromDateObj(state.calendarMonth);
  if (!force && state.todoMonthKey === monthKey) return;
  const seq = ++state.todoRefreshSeq;

  const monthDates = state.logDates.filter((d) => monthKeyFromDate(d) === monthKey);
  const todoMap = new Map();
  for (const d of monthDates) {
    const res = await window.noteslip.readLog(d);
    const todos = extractMarkdownTodos(res?.content || "");
    if (todos.length) todoMap.set(d, todos);
  }

  if (seq !== state.todoRefreshSeq) return;
  state.todoByDate = todoMap;
  state.todoMonthKey = monthKey;
  renderCalendar();
}

function setCalendarToDate(dateStr) {
  if (!isValidDate(dateStr)) return;
  state.calendarMonth = monthStart(parseDateFromYMD(dateStr));
  renderCalendar();
  refreshTodosForVisibleMonth(false).catch(() => {});
}

function shiftCalendarBy(delta) {
  state.calendarMonth = shiftMonth(state.calendarMonth, delta);
  renderCalendar();
  refreshTodosForVisibleMonth(false).catch(() => {});
}

async function refreshIcsDates(options = {}) {
  const silent = Boolean(options.silent);
  if (state.icsRefreshPromise) return state.icsRefreshPromise;

  const p = (async () => {
    try {
      if (!silent) setStatus("Refreshing ICS...");
      const res = await window.noteslip.getIcsDates();
      const dates = Array.isArray(res?.dates) ? res.dates : [];
      const events = Array.isArray(res?.events) ? res.events : [];
      state.icsDatesSet = new Set(dates.filter(isValidDate));
      state.icsEvents = events.filter((ev) => isValidDate(ev?.date));
      state.icsEventsByDate = buildIcsEventsByDate(state.icsEvents);
      state.icsSources = Array.isArray(res?.sources) ? res.sources : [];
      state.lastIcsRefreshAt = Date.now();
      renderCalendar();
      if (!silent) {
        const failCount = state.icsSources.filter((s) => s && s.ok === false).length;
        setStatus(failCount ? `ICS updated, ${failCount} feed(s) failed` : `ICS updated (${state.icsEvents.length} event(s))`);
      }
    } catch (_e) {
      if (!silent) setStatus("ICS refresh failed");
    } finally {
      if (state.icsRefreshPromise === p) state.icsRefreshPromise = null;
    }
  })();

  state.icsRefreshPromise = p;
  return p;
}

function ensureIcsAutoRefreshTimer() {
  if (state.icsAutoRefreshTimer) clearInterval(state.icsAutoRefreshTimer);
  state.icsAutoRefreshTimer = setInterval(() => {
    refreshIcsDates({ silent: true }).catch(() => {});
  }, ICS_AUTO_REFRESH_MS);
}

function refreshIcsIfStale() {
  const elapsed = Date.now() - Number(state.lastIcsRefreshAt || 0);
  if (elapsed < ICS_AUTO_REFRESH_MS) return;
  refreshIcsDates({ silent: true }).catch(() => {});
}

async function refreshList() {
  if (state.searchQuery) {
    renderSearchResults();
    return;
  }

  const dates = await window.noteslip.listLogs();
  state.logDates = dates;
  state.logDatesSet = new Set(dates);
  renderLogListGrouped();
  await refreshTodosForVisibleMonth(false);
  renderActiveListItem();
}

function toggleMonthCollapsed(monthKey) {
  if (state.collapsedMonths.has(monthKey)) state.collapsedMonths.delete(monthKey);
  else state.collapsedMonths.add(monthKey);
  renderLogListGrouped();
  renderActiveListItem();
}

function renderLogListGrouped() {
  els.logList.innerHTML = "";
  els.listHeader.textContent = "日志（按月分组）";
  const groups = groupDatesByMonth(state.logDates);
  const keys = [...groups.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  if (!keys.length) {
    const empty = document.createElement("div");
    empty.className = "logItem";
    empty.style.cursor = "default";
    empty.textContent = "暂无日志";
    els.logList.appendChild(empty);
    return;
  }

  if (!state.collapsedMonths.size && keys.length > 1) {
    const keep = state.currentDate ? monthKeyFromDate(state.currentDate) : keys[0];
    for (const k of keys) {
      if (k !== keep) state.collapsedMonths.add(k);
    }
  }

  for (const key of keys) {
    const monthWrap = document.createElement("div");
    monthWrap.className = "monthGroup";
    const dates = groups.get(key) || [];

    const header = document.createElement("button");
    header.type = "button";
    header.className = "monthHeader";
    const collapsed = state.collapsedMonths.has(key);
    header.textContent = `${collapsed ? "▶" : "▼"} ${key} (${dates.length})`;
    header.addEventListener("click", () => toggleMonthCollapsed(key));
    monthWrap.appendChild(header);

    if (!collapsed) {
      const body = document.createElement("div");
      body.className = "monthBody";
      for (const date of dates) {
        const item = document.createElement("div");
        item.className = "logItem";
        item.dataset.date = date;
        item.addEventListener("click", async () => {
          await openDate(date);
        });

        const left = document.createElement("div");
        left.textContent = date;

        const right = document.createElement("div");
        right.className = "badges";
        item.appendChild(left);
        item.appendChild(right);
        body.appendChild(item);
      }
      monthWrap.appendChild(body);
    }
    els.logList.appendChild(monthWrap);
  }
}

function renderActiveListItem() {
  const items = els.logList.querySelectorAll(".logItem");
  for (const it of items) {
    if (it.dataset.date === state.currentDate) it.classList.add("active");
    else it.classList.remove("active");

    const badges = it.querySelector(".badges");
    if (!badges) continue;
    badges.innerHTML = "";
    if (it.dataset.date === state.currentDate) {
      const b1 = document.createElement("div");
      b1.className = "badge";
      b1.textContent = "Current";
      badges.appendChild(b1);
      if (state.dirty) {
        const b2 = document.createElement("div");
        b2.className = "badge unsaved";
        b2.textContent = "Unsaved";
        badges.appendChild(b2);
      }
    }
  }
}

async function saveNow() {
  if (!state.currentDate) return { ok: false, skipped: true };
  const content = getEditorContent();
  if (!state.dirty && content === state.lastSavedContent) {
    if (!state.saving) setStatus("Saved");
    return { ok: true, skipped: true };
  }

  setUiSaving(true);
  setStatus("Saving...");
  const seq = ++state.saveSeq;
  const p = (async () => {
    try {
      await window.noteslip.writeLog(state.currentDate, content);
      if (seq !== state.saveSeq) return { ok: true, superseded: true };
      setUiSaving(false);
      markClean(content);
      await refreshList();
      return { ok: true };
    } catch (_e) {
      if (seq !== state.saveSeq) return { ok: false, superseded: true };
      setUiSaving(false);
      state.dirty = true;
      setStatus("Save failed (Ctrl+S to retry)");
      return { ok: false };
    } finally {
      if (state.savePromise === p) state.savePromise = null;
    }
  })();

  state.savePromise = p;
  return p;
}

const saveDebounced = debounce(() => {
  saveNow();
}, 500);

async function ensureSaved() {
  if (state.saving && state.savePromise) {
    const res = await state.savePromise;
    if (res && res.ok === false) return false;
  }
  if (!state.dirty) return true;
  const res = await saveNow();
  return !(res && res.ok === false);
}

async function openDate(date) {
  if (!isValidDate(date)) return;
  if (state.currentDate === date) return;

  const ok = await ensureSaved();
  if (!ok) return;

  const res = await window.noteslip.readLog(date);
  const content = res && typeof res === "object" ? res.content : "";
  const exists = Boolean(res && typeof res === "object" ? res.exists : false);
  setCurrentDate(date);
  setCalendarToDate(date);
  setEditorContent(content);
  if (exists) {
    markClean(content);
    await refreshList();
  } else {
    state.lastSavedContent = "";
    if (String(content ?? "")) markDirty();
    else setStatus("");
    await refreshList();
  }
  renderPreviewNow();
}

async function openToday() {
  const today = await window.noteslip.getToday();
  await openDate(today);
}

function wireEvents() {
  els.todayBtn.addEventListener("click", () => {
    openToday().catch(() => setStatus("Open failed"));
  });

  els.content.addEventListener("input", () => {
    markDirty();
    renderPreviewDebounced();
    saveDebounced();
    renderActiveListItem();
  });

  els.previewBtn.addEventListener("click", () => {
    state.previewEnabled = !state.previewEnabled;
    if (state.previewEnabled) {
      els.preview.classList.remove("hidden");
      els.editorBody.classList.add("split");
      els.previewBtn.textContent = "Edit";
      renderPreviewNow();
    } else {
      els.preview.classList.add("hidden");
      els.editorBody.classList.remove("split");
      els.previewBtn.textContent = "Preview";
    }
  });

  els.calendarPrevBtn.addEventListener("click", () => shiftCalendarBy(-1));
  els.calendarNextBtn.addEventListener("click", () => shiftCalendarBy(1));
  els.calendarTodayBtn.addEventListener("click", () => {
    state.calendarMonth = monthStart(new Date());
    renderCalendar();
    refreshTodosForVisibleMonth(false).catch(() => {});
  });
  els.refreshIcsBtn.addEventListener("click", () => {
    refreshIcsDates().catch(() => setStatus("ICS refresh failed"));
  });

  els.closeSettingsBtn.addEventListener("click", closeSettings);
  els.modalBackdrop.addEventListener("click", (e) => {
    if (e.target === els.modalBackdrop) closeSettings();
  });

  els.themeModeLight.addEventListener("change", syncThemeAutoRow);
  els.themeModeDark.addEventListener("change", syncThemeAutoRow);
  els.themeModeAuto.addEventListener("change", syncThemeAutoRow);

  els.closeInfoBtn.addEventListener("click", closeInfo);
  els.infoBackdrop.addEventListener("click", (e) => {
    if (e.target === els.infoBackdrop) closeInfo();
  });

  els.closeExportBtn.addEventListener("click", closeExport);
  els.cancelExportBtn.addEventListener("click", closeExport);
  els.exportBackdrop.addEventListener("click", (e) => {
    if (e.target === els.exportBackdrop) closeExport();
  });

  els.exportKindCurrent.addEventListener("change", syncExportKindUi);
  els.exportKindRange.addEventListener("change", syncExportKindUi);
  els.exportKindAll.addEventListener("change", syncExportKindUi);
  els.doExportBtn.addEventListener("click", () => {
    runExportFromModal().catch(() => {
      setExportError("Export failed");
      setStatus("Export failed");
    });
  });

  els.chooseStorageDirBtn.addEventListener("click", async () => {
    const res = await window.noteslip.chooseDir("Choose storage directory");
    if (res && !res.canceled && res.path) els.storageDirInput.value = res.path;
  });

  els.chooseBackupDirBtn.addEventListener("click", async () => {
    const res = await window.noteslip.chooseDir("Choose backup directory");
    if (res && !res.canceled && res.path) els.backupDirInput.value = res.path;
  });

  els.saveSettingsBtn.addEventListener("click", () => {
    saveSettingsFromModal().catch(() => setStatus("Save settings failed"));
  });

  els.searchInput.addEventListener("input", () => {
    const q = String(els.searchInput.value ?? "").trim();
    state.searchQuery = q;
    if (!q) {
      state.searchResults = [];
      els.listHeader.textContent = "Logs";
      refreshList().catch(() => {});
      return;
    }
    els.listHeader.textContent = "Searching...";
    searchDebounced();
  });

  els.clearSearchBtn.addEventListener("click", () => {
    els.searchInput.value = "";
    state.searchQuery = "";
    state.searchResults = [];
    refreshList().catch(() => {});
  });

  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (String(e.key || "").toLowerCase() !== "s") return;
    e.preventDefault();
    if (state.saving && state.savePromise) {
      state.savePromise.then(() => saveNow());
      return;
    }
    saveNow();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!els.exportBackdrop.classList.contains("hidden")) return closeExport();
    if (!els.infoBackdrop.classList.contains("hidden")) return closeInfo();
    if (!els.modalBackdrop.classList.contains("hidden")) closeSettings();
  });

  window.addEventListener("beforeunload", (e) => {
    if (!state.dirty && !state.saving) return;
    e.preventDefault();
    e.returnValue = "";
  });

  window.addEventListener("focus", refreshIcsIfStale);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshIcsIfStale();
  });

  if (window.noteslip.onMenuAction) {
    window.noteslip.onMenuAction((action) => {
      const a = String(action || "");
      if (a === "help") openInfo("Help", helpHtml());
      else if (a === "learnMore") openInfo("About", aboutHtml());
      else if (a === "export") openExport();
      else if (a === "settings") openSettings().catch(() => setStatus("Open settings failed"));
    });
  }
}

function renderSearchResults() {
  els.logList.innerHTML = "";
  const q = state.searchQuery;
  els.listHeader.textContent = q ? `Search results (${state.searchResults.length})` : "Logs";
  if (!q) return;

  if (!state.searchResults.length) {
    const empty = document.createElement("div");
    empty.className = "logItem";
    empty.style.cursor = "default";
    empty.textContent = "No results";
    els.logList.appendChild(empty);
    return;
  }

  for (const r of state.searchResults) {
    const item = document.createElement("div");
    item.className = "logItem";
    item.dataset.date = r.date;

    const left = document.createElement("div");
    left.textContent = `${r.date}:${r.line}`;

    const right = document.createElement("div");
    right.className = "previewLine";
    right.textContent = r.preview || "";

    item.appendChild(left);
    item.appendChild(right);

    item.addEventListener("click", async () => {
      await openDate(r.date);
      const content = getEditorContent();
      const idx = content.toLowerCase().indexOf(String(q).toLowerCase());
      if (idx >= 0) {
        els.content.focus();
        els.content.setSelectionRange(idx, idx + q.length);
        setStatus("Located");
      }
    });

    els.logList.appendChild(item);
  }
}

async function doSearch() {
  const q = String(state.searchQuery ?? "").trim();
  if (!q) return;
  const seq = ++state.searchSeq;
  try {
    const res = await window.noteslip.searchLogs(q, { limit: 120, caseSensitive: false });
    if (seq !== state.searchSeq) return;
    state.searchResults = res && res.results ? res.results : [];
    renderSearchResults();
  } catch (_e) {
    if (seq !== state.searchSeq) return;
    state.searchResults = [];
    els.listHeader.textContent = "Search failed";
  }
}

const searchDebounced = debounce(() => {
  doSearch();
}, 250);

function openModal() {
  els.modalBackdrop.classList.remove("hidden");
}

function closeSettings() {
  els.modalBackdrop.classList.add("hidden");
}

function openInfo(title, html) {
  els.infoTitle.textContent = String(title ?? "");
  els.infoBody.innerHTML = String(html ?? "");
  els.infoBackdrop.classList.remove("hidden");
}

function closeInfo() {
  els.infoBackdrop.classList.add("hidden");
}

function setExportError(text) {
  const t = String(text ?? "").trim();
  if (!t) {
    els.exportError.textContent = "";
    els.exportError.classList.add("hidden");
    return;
  }
  els.exportError.textContent = t;
  els.exportError.classList.remove("hidden");
}

function getSelectedExportKind() {
  if (els.exportKindRange.checked) return "range";
  if (els.exportKindAll.checked) return "all";
  return "current";
}

function syncExportKindUi() {
  const kind = getSelectedExportKind();
  if (kind === "range") els.exportRangeRow.classList.remove("hidden");
  else els.exportRangeRow.classList.add("hidden");
}

function openExport() {
  setExportError("");
  const d = state.currentDate || "";
  els.exportCurrentDate.textContent = d || "(No date selected)";
  if (!els.exportFrom.value) els.exportFrom.value = d;
  if (!els.exportTo.value) els.exportTo.value = d;
  if (!d) els.exportKindAll.checked = true;
  syncExportKindUi();
  els.exportBackdrop.classList.remove("hidden");
}

function closeExport() {
  els.exportBackdrop.classList.add("hidden");
}

async function runExportFromModal() {
  setExportError("");
  if (state.saving) {
    setExportError("Saving in progress, try again shortly");
    return;
  }

  const ok = await ensureSaved();
  if (!ok) {
    setExportError("Save failed; cannot export now");
    return;
  }

  const kind = getSelectedExportKind();
  try {
    if (kind === "current") {
      if (!state.currentDate) {
        setExportError("No current date selected");
        return;
      }
      const res = await window.noteslip.exportLogs({ kind: "current", date: state.currentDate });
      if (res && res.canceled) return closeExport();
      if (res && res.ok === false) throw new Error(res.message || "Export failed");
      closeExport();
      setStatus("Exported");
      return;
    }

    if (kind === "all") {
      const res = await window.noteslip.exportLogs({ kind: "all" });
      if (res && res.canceled) return closeExport();
      if (res && res.ok === false) throw new Error(res.message || "Export failed");
      closeExport();
      setStatus("Exported");
      return;
    }

    const from = String(els.exportFrom.value ?? "");
    const to = String(els.exportTo.value ?? "");
    if (!isValidDate(from) || !isValidDate(to)) {
      setExportError("Invalid date format (YYYY-MM-DD)");
      return;
    }
    const res = await window.noteslip.exportLogs({ kind: "range", from, to });
    if (res && res.canceled) return closeExport();
    if (res && res.ok === false) throw new Error(res.message || "Export failed");
    closeExport();
    setStatus("Exported");
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "";
    setExportError(msg ? `Export failed: ${msg}` : "Export failed");
    setStatus(msg ? `Export failed: ${msg}` : "Export failed");
  }
}

function helpHtml() {
  return `
<div class="field">
  <div class="label">快捷操作</div>
  <div class="hint">Ctrl+S / Cmd+S：立即保存当前日记</div>
  <div class="hint">Esc：关闭当前弹窗</div>
</div>
<div class="field">
  <div class="label">日历使用</div>
  <div class="hint">点击日期可直接跳转到对应日记；左右箭头切换月份；“本月”回到当前月</div>
  <div class="hint">日期右下角圆点表示“本地有日志”，左下角圆点表示“ICS 有事件”</div>
</div>
<div class="field">
  <div class="label">ICS 订阅</div>
  <div class="hint">在设置中填写 ICS 地址（每行一个），可手动“刷新 ICS”，并支持每 30 分钟自动刷新</div>
</div>
<div class="field">
  <div class="label">Markdown 速查</div>
  <div class="hint"><a href="https://www.markdownguide.org/cheat-sheet/" target="_blank" rel="noreferrer">https://www.markdownguide.org/cheat-sheet/</a></div>
</div>`;
}

function aboutHtml() {
  return `
<div class="field">
  <div class="label">Noteslip</div>
  <div class="hint">版本：${escapeHtml(APP_VERSION)}</div>
</div>
<div class="field">
  <div class="label">功能概览</div>
  <div class="hint">本地优先的日记工具，支持自动保存、日历跳转、全文搜索、Markdown 预览与导出</div>
</div>
<div class="field">
  <div class="label">开源依赖</div>
  <div class="hint"><a href="https://tauri.app/" target="_blank" rel="noreferrer">Tauri</a></div>
</div>
<div class="field">
  <div class="label">License</div>
  <div class="hint">GNU General Public License v3.0 (GPL-3.0)</div>
</div>`;
}

async function openSettings() {
  const res = await window.noteslip.getSettings();
  const settings = res && res.settings ? res.settings : null;
  state.settings = settings || {};
  els.storageDirInput.value = String(settings?.storageDir ?? "");
  els.backupDirInput.value = String(settings?.backupDir ?? "");
  els.templateInput.value = String(settings?.template ?? "");
  els.icsFeedsInput.value = String(settings?.icsFeeds ?? "");
  setThemeInputsFromSettings(settings || {});
  openModal();
}

async function saveSettingsFromModal() {
  const prev = state.settings || (await window.noteslip.getSettings()).settings;
  const theme = getThemeSettingsFromInputs();
  const next = {
    storageDir: String(els.storageDirInput.value ?? "").trim(),
    backupDir: String(els.backupDirInput.value ?? "").trim(),
    template: String(els.templateInput.value ?? ""),
    icsFeeds: String(els.icsFeedsInput.value ?? ""),
    themeMode: theme.mode,
    autoDarkStart: theme.autoDarkStart,
    autoDarkEnd: theme.autoDarkEnd
  };

  const storageChanged = String(prev?.storageDir ?? "").trim() !== next.storageDir;
  const migrate = storageChanged ? window.confirm("Storage directory changed. Copy old logs to new directory?") : false;
  const res = await window.noteslip.setSettings(next, migrate);
  state.settings = res && res.settings ? res.settings : next;
  applyThemeNow();
  ensureThemeTimer();
  closeSettings();
  await refreshList();
  await refreshIcsDates({ silent: true });
  setStatus("Settings saved");
}

async function init() {
  wireEvents();
  renderCalendarWeek();
  renderCalendar();
  setStatus("");

  try {
    const settingsRes = await window.noteslip.getSettings();
    state.settings = settingsRes && settingsRes.settings ? settingsRes.settings : {};
  } catch (_e) {
    state.settings = {};
  }

  applyThemeNow();
  ensureThemeTimer();
  ensureIcsAutoRefreshTimer();
  await refreshIcsDates({ silent: true });
  await refreshList();
  await openToday();
}

init().catch(() => {
  setStatus("Init failed");
});
