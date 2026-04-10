const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("noteslip", {
  getToday: () => ipcRenderer.invoke("logs:today"),
  listLogs: () => ipcRenderer.invoke("logs:list"),
  readLog: (date) => ipcRenderer.invoke("logs:read", date),
  writeLog: (date, content) => ipcRenderer.invoke("logs:write", { date, content }),
  searchLogs: (query, options) => ipcRenderer.invoke("logs:search", { query, options }),
  exportLogs: (payload) => ipcRenderer.invoke("logs:export", payload),
  openLogsDir: () => ipcRenderer.invoke("logs:openDir"),
  backupNow: () => ipcRenderer.invoke("logs:backupNow"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (settings, migrate) => ipcRenderer.invoke("settings:set", { settings, migrate }),
  chooseDir: (title) => ipcRenderer.invoke("dialogs:chooseDir", { title }),
  onMenuAction: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, action) => handler(action);
    ipcRenderer.on("menu:action", listener);
    return () => ipcRenderer.removeListener("menu:action", listener);
  }
});
