const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("noteslip", {
  getToday: () => ipcRenderer.invoke("logs:today"),
  listLogs: () => ipcRenderer.invoke("logs:list"),
  readLog: (date) => ipcRenderer.invoke("logs:read", date),
  writeLog: (date, content) => ipcRenderer.invoke("logs:write", { date, content })
});
