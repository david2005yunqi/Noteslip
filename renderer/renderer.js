const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const APP_VERSION = "26.0.1.0";
const MARKDOWN_CHEAT_SHEET = `# Markdown Cheat Sheet

Thanks for visiting [The Markdown Guide](https://www.markdownguide.org)!        

This Markdown cheat sheet provides a quick overview of all the Markdown syntax elements. It can’t cover every edge case, so if you need more information about any of these elements, refer to the reference guides for [basic syntax](https://www.markdownguide.org/basic-syntax/) and [extended syntax](https://www.markdownguide.org/extended-syntax/).

## Basic Syntax

These are the elements outlined in John Gruber’s original design document. All Markdown applications support these elements.

### Heading

# H1
## H2
### H3

### Bold

**bold text**

### Italic

*italicized text*

### Blockquote

> blockquote

### Ordered List

1. First item
2. Second item
3. Third item

### Unordered List

- First item
- Second item
- Third item

### Code

\`code\`

### Horizontal Rule

---

### Link

[Markdown Guide](https://www.markdownguide.org)

### Image

![alt text](https://www.markdownguide.org/assets/images/tux.png)

## Extended Syntax

These elements extend the basic syntax by adding additional features. Not all Markdown applications support these elements.

### Table

| Syntax | Description |
| ----------- | ----------- |
| Header | Title |
| Paragraph | Text |

### Fenced Code Block

\`\`\`
{
  "firstName": "John",
  "lastName": "Smith",
  "age": 25
}
\`\`\`

### Footnote

Here's a sentence with a footnote. [^1]

[^1]: This is the footnote.

### Heading ID

### My Great Heading {#custom-id}

### Definition List

term
: definition

### Strikethrough

~~The world is flat.~~

### Task List

- [x] Write the press release
- [ ] Update the website
- [ ] Contact the media

### Emoji

That is so funny! :joy:

(See also [Copying and Pasting Emoji](https://www.markdownguide.org/extended-syntax/#copying-and-pasting-emoji))

### Highlight

I need to highlight these ==very important words==.

### Subscript

H~2~O

### Superscript

X^2^
`;

function isValidDate(date) {
  return typeof date === "string" && DATE_RE.test(date);
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

const els = {
  todayBtn: document.getElementById("todayBtn"),
  datePicker: document.getElementById("datePicker"),
  openBtn: document.getElementById("openBtn"),
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
  exportError: document.getElementById("exportError")
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
  searchSeq: 0
};

function setStatus(text) {
  els.status.textContent = text || "";
}

function setUiSaving(isSaving) {
  state.saving = Boolean(isSaving);
  setDisabled(els.todayBtn, state.saving);
  setDisabled(els.openBtn, state.saving);
  setDisabled(els.datePicker, state.saving);
  setDisabled(els.searchInput, state.saving);
  setDisabled(els.clearSearchBtn, state.saving);
  setDisabled(els.previewBtn, state.saving);
  els.logList.style.pointerEvents = state.saving ? "none" : "auto";
  els.logList.style.opacity = state.saving ? "0.6" : "1";
}

function setCurrentDate(date) {
  state.currentDate = date;
  els.currentDate.textContent = date || "";
  els.datePicker.value = date || "";
  renderActiveListItem();
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
  setStatus("已保存");
}

function markDirty() {
  state.dirty = true;
  if (!state.saving) setStatus("未保存");
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
  let codeLang = "";

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
    const raw = lines[i];
    const line = String(raw ?? "");

    const fence = line.match(/^```(.*)$/);
    if (fence) {
      if (!inCode) {
        inCode = true;
        codeLang = String(fence[1] || "").trim();
        out.push(`<pre><code data-lang="${escapeHtml(codeLang)}">`);
      } else {
        inCode = false;
        codeLang = "";
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

async function refreshList() {
  if (state.searchQuery) {
    renderSearchResults();
    return;
  }

  const dates = await window.noteslip.listLogs();
  els.logList.innerHTML = "";
  els.listHeader.textContent = "已有日志";

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
    if (date === state.currentDate) {
      const b1 = document.createElement("div");
      b1.className = "badge";
      b1.textContent = "当前";
      right.appendChild(b1);
      if (state.dirty) {
        const b2 = document.createElement("div");
        b2.className = "badge unsaved";
        b2.textContent = "未保存";
        right.appendChild(b2);
      }
    }

    item.appendChild(left);
    item.appendChild(right);
    els.logList.appendChild(item);
  }

  renderActiveListItem();
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
      b1.textContent = "当前";
      badges.appendChild(b1);
      if (state.dirty) {
        const b2 = document.createElement("div");
        b2.className = "badge unsaved";
        b2.textContent = "未保存";
        badges.appendChild(b2);
      }
    }
  }
}

async function saveNow() {
  if (!state.currentDate) return { ok: false, skipped: true };
  const content = getEditorContent();
  if (!state.dirty && content === state.lastSavedContent) {
    if (!state.saving) setStatus("已保存");
    return { ok: true, skipped: true };
  }

  setUiSaving(true);
  setStatus("正在保存…");
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
      setStatus("保存失败（Ctrl+S 重试）");
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
    openToday().catch(() => setStatus("打开失败"));
  });

  els.openBtn.addEventListener("click", () => {
    const date = els.datePicker.value;
    openDate(date).catch(() => setStatus("打开失败"));
  });

  els.datePicker.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const date = els.datePicker.value;
      openDate(date).catch(() => setStatus("打开失败"));
    }
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
      els.previewBtn.textContent = "编辑";
      renderPreviewNow();
    } else {
      els.preview.classList.add("hidden");
      els.editorBody.classList.remove("split");
      els.previewBtn.textContent = "预览";
    }
  });

  els.closeSettingsBtn.addEventListener("click", () => closeSettings());
  els.modalBackdrop.addEventListener("click", (e) => {
    if (e.target === els.modalBackdrop) closeSettings();
  });

  els.closeInfoBtn.addEventListener("click", () => closeInfo());
  els.infoBackdrop.addEventListener("click", (e) => {
    if (e.target === els.infoBackdrop) closeInfo();
  });

  els.closeExportBtn.addEventListener("click", () => closeExport());
  els.cancelExportBtn.addEventListener("click", () => closeExport());
  els.exportBackdrop.addEventListener("click", (e) => {
    if (e.target === els.exportBackdrop) closeExport();
  });
  els.exportKindCurrent.addEventListener("change", () => syncExportKindUi());
  els.exportKindRange.addEventListener("change", () => syncExportKindUi());
  els.exportKindAll.addEventListener("change", () => syncExportKindUi());
  els.doExportBtn.addEventListener("click", () => {
    runExportFromModal().catch(() => {
      setExportError("导出失败");
      setStatus("导出失败");
    });
  });

  els.chooseStorageDirBtn.addEventListener("click", async () => {
    const res = await window.noteslip.chooseDir("选择存储目录");
    if (res && !res.canceled && res.path) els.storageDirInput.value = res.path;
  });

  els.chooseBackupDirBtn.addEventListener("click", async () => {
    const res = await window.noteslip.chooseDir("选择备份目录");
    if (res && !res.canceled && res.path) els.backupDirInput.value = res.path;
  });

  els.saveSettingsBtn.addEventListener("click", () => {
    saveSettingsFromModal().catch(() => setStatus("保存设置失败"));
  });

  els.searchInput.addEventListener("input", () => {
    const q = String(els.searchInput.value ?? "").trim();
    state.searchQuery = q;
    if (!q) {
      state.searchResults = [];
      els.listHeader.textContent = "已有日志";
      refreshList().catch(() => {});
      return;
    }
    els.listHeader.textContent = "搜索中…";
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
    if (!els.exportBackdrop.classList.contains("hidden")) {
      closeExport();
      return;
    }
    if (!els.infoBackdrop.classList.contains("hidden")) {
      closeInfo();
      return;
    }
    if (!els.modalBackdrop.classList.contains("hidden")) {
      closeSettings();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (!state.dirty && !state.saving) return;
    e.preventDefault();
    e.returnValue = "";
  });

  if (window.noteslip.onMenuAction) {
    window.noteslip.onMenuAction((action) => {
      const a = String(action || "");
      if (a === "help") openInfo("帮助", helpHtml());
      else if (a === "learnMore") openInfo("关于软件", aboutHtml());
      else if (a === "export") openExport();
      else if (a === "settings") openSettings().catch(() => setStatus("打开设置失败"));
    });
  }
}

function renderSearchResults() {
  els.logList.innerHTML = "";
  const q = state.searchQuery;
  els.listHeader.textContent = q ? `搜索结果（${state.searchResults.length}）` : "已有日志";

  if (!q) return;

  if (!state.searchResults.length) {
    const empty = document.createElement("div");
    empty.className = "logItem";
    empty.style.cursor = "default";
    empty.textContent = "无匹配结果";
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
        setStatus("已定位");
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
    els.listHeader.textContent = "搜索失败";
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
  els.exportCurrentDate.textContent = d || "（未选择日期）";
  if (!els.exportFrom.value) els.exportFrom.value = d;
  if (!els.exportTo.value) els.exportTo.value = d;
  if (!d) {
    els.exportKindAll.checked = true;
  }
  syncExportKindUi();
  els.exportBackdrop.classList.remove("hidden");
}

function closeExport() {
  els.exportBackdrop.classList.add("hidden");
}

async function runExportFromModal() {
  setExportError("");
  if (state.saving) {
    setExportError("正在保存中，请稍后再导出");
    return;
  }

  const ok = await ensureSaved();
  if (!ok) {
    setExportError("保存失败，无法导出（可用 Ctrl+S 重试保存）");
    return;
  }

  const kind = getSelectedExportKind();
  try {
    if (kind === "current") {
      if (!state.currentDate) {
        setExportError("未选择日期，无法导出“当前日期”");
        return;
      }
      const res = await window.noteslip.exportLogs({ kind: "current", date: state.currentDate });
      if (res && res.canceled) return closeExport();
      if (res && res.ok === false) throw new Error(res.message || "导出失败");
      closeExport();
      setStatus("已导出");
      return;
    }

    if (kind === "all") {
      const res = await window.noteslip.exportLogs({ kind: "all" });
      if (res && res.canceled) return closeExport();
      if (res && res.ok === false) throw new Error(res.message || "导出失败");
      closeExport();
      setStatus("已导出");
      return;
    }

    const from = String(els.exportFrom.value ?? "");
    const to = String(els.exportTo.value ?? "");
    if (!isValidDate(from) || !isValidDate(to)) {
      setExportError("日期格式不正确（需要 YYYY-MM-DD）");
      return;
    }
    const res = await window.noteslip.exportLogs({ kind: "range", from, to });
    if (res && res.canceled) return closeExport();
    if (res && res.ok === false) throw new Error(res.message || "导出失败");
    closeExport();
    setStatus("已导出");
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "";
    setExportError(msg ? `导出失败：${msg}` : "导出失败");
    setStatus(msg ? `导出失败：${msg}` : "导出失败");
  }
}

function helpHtml() {
  return `
<div class="field">
  <div class="label">快捷键</div>
  <div class="hint">Ctrl+S / Cmd+S：立即保存</div>
  <div class="hint">日期输入框回车：打开对应日期</div>
  <div class="hint">预览：右上角“预览/编辑”切换</div>
</div>
<div class="field">
  <div class="label">搜索</div>
  <div class="hint">左侧搜索框输入关键词，会按日志内容逐行匹配；点击结果可跳转并选中命中</div>
</div>
<div class="field">
  <div class="label">数据</div>
  <div class="hint">每一天 1 个 Markdown 文件；导出/备份都只处理 .md 文件</div>
</div>
<div class="field">
  <div class="label">导出</div>
  <div class="hint">菜单栏“文件 → 导出…”；支持导出当前/范围/全部</div>
</div>
<div class="field">
  <div class="label">Markdown 速查表</div>
  <div class="hint">来源：<a href="https://www.markdownguide.org/" target="_blank" rel="noreferrer">The Markdown Guide</a></div>
  <pre>${escapeHtml(MARKDOWN_CHEAT_SHEET)}</pre>
</div>
`;
}

function aboutHtml() {
  return `
<div class="field">
  <div class="label">Noteslip</div>
  <div class="hint">版本：${escapeHtml(APP_VERSION)}</div>
</div>
<div class="field">
  <div class="label">开源库</div>
  <div class="hint"><a href="https://www.electronjs.org/" target="_blank" rel="noreferrer">Electron</a></div>
  <div class="hint"><a href="https://www.electron.build/" target="_blank" rel="noreferrer">electron-builder</a></div>
  <div class="hint"><a href="https://www.npmjs.com/package/universalify" target="_blank" rel="noreferrer">universalify</a></div>
</div>
<div class="field">
  <div class="label">GitHub 仓库</div>
  <div class="hint"><a href="https://github.com/david2005yunqi/Noteslip" target="_blank" rel="noreferrer">https://github.com/david2005yunqi/Noteslip</a></div>
</div>
<div class="field">
  <div class="label">反馈与建议</div>
  <div class="hint"><a href="https://github.com/david2005yunqi/Noteslip/issues" target="_blank" rel="noreferrer">https://github.com/david2005yunqi/Noteslip/issues</a></div>
</div>
<div class="field">
  <div class="label">License</div>
  <div class="hint">GNU General Public License v3.0 (GPL-3.0)</div>
</div>
`;
}

async function openSettings() {
  const res = await window.noteslip.getSettings();
  const settings = res && res.settings ? res.settings : null;
  state.settings = settings;
  els.storageDirInput.value = String(settings?.storageDir ?? "");
  els.backupDirInput.value = String(settings?.backupDir ?? "");
  els.templateInput.value = String(settings?.template ?? "");
  openModal();
}

async function saveSettingsFromModal() {
  const prev = state.settings || (await window.noteslip.getSettings()).settings;
  const next = {
    storageDir: String(els.storageDirInput.value ?? "").trim(),
    backupDir: String(els.backupDirInput.value ?? "").trim(),
    template: String(els.templateInput.value ?? "")
  };
  const storageChanged = String(prev?.storageDir ?? "").trim() !== next.storageDir;
  const migrate = storageChanged ? window.confirm("存储目录已变更，是否把旧日志复制到新目录？") : false;
  const res = await window.noteslip.setSettings(next, migrate);
  state.settings = res && res.settings ? res.settings : next;
  closeSettings();
  await refreshList();
  setStatus("设置已保存");
}

async function init() {
  wireEvents();
  setStatus("");
  await refreshList();
  await openToday();
}

init().catch(() => {
  setStatus("初始化失败");
});
