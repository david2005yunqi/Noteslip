const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

const els = {
  todayBtn: document.getElementById("todayBtn"),
  datePicker: document.getElementById("datePicker"),
  openBtn: document.getElementById("openBtn"),
  logList: document.getElementById("logList"),
  currentDate: document.getElementById("currentDate"),
  status: document.getElementById("status"),
  content: document.getElementById("content")
};

const state = {
  currentDate: null,
  dirty: false,
  saving: false,
  lastSavedContent: "",
  saveSeq: 0
};

function setStatus(text) {
  els.status.textContent = text || "";
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
  if (state.saving) return;
  setStatus("已保存");
}

function markDirty() {
  state.dirty = true;
  if (state.saving) return;
  setStatus("未保存");
}

async function refreshList() {
  const dates = await window.noteslip.listLogs();
  els.logList.innerHTML = "";

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
    if (date === state.currentDate) {
      right.className = "badge";
      right.textContent = "当前";
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
    const badge = it.querySelector(".badge");
    if (badge) badge.remove();
    if (it.dataset.date === state.currentDate) {
      const right = document.createElement("div");
      right.className = "badge";
      right.textContent = "当前";
      it.appendChild(right);
    }
  }
}

async function saveNow() {
  if (!state.currentDate) return;
  const content = getEditorContent();
  if (!state.dirty && content === state.lastSavedContent) return;

  state.saving = true;
  setStatus("正在保存…");
  const seq = ++state.saveSeq;
  await window.noteslip.writeLog(state.currentDate, content);
  if (seq !== state.saveSeq) return;
  state.saving = false;
  markClean(content);
  await refreshList();
}

const saveDebounced = debounce(() => {
  saveNow().catch(() => {
    state.saving = false;
    setStatus("保存失败");
  });
}, 500);

async function openDate(date) {
  if (!isValidDate(date)) return;
  if (state.currentDate === date) return;

  if (state.dirty) {
    await saveNow();
  }

  const content = await window.noteslip.readLog(date);
  setCurrentDate(date);
  setEditorContent(content);
  markClean(content);
  await refreshList();
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
    saveDebounced();
  });

  window.addEventListener("beforeunload", () => {
    if (!state.dirty) return;
  });
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
