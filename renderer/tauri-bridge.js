(function () {
  const tauri = window.__TAURI__;
  const invoke = tauri && (tauri.core ? tauri.core.invoke : (tauri.tauri && tauri.tauri.invoke));
  const listen = tauri && tauri.event && tauri.event.listen;

  if (!invoke || window.noteslip_whiteboard) return;

  const on = (event, handler) => {
    if (!listen) return () => {};
    let unlisten = null;
    listen(event, (payload) => handler(payload && payload.payload)).then((off) => {
      unlisten = off;
    });
    return () => {
      if (unlisten) unlisten();
    };
  };

  // We expose a compatible interface for the Excalidraw bundle
  window.noteseye = {
    getWhiteboardContext: async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const name = urlParams.get('name');
        return { title: name || "" };
    },
    getWhiteboardData: async (name) => {
        return invoke("whiteboard_read", { name });
    },
    setWhiteboardData: async (payload) => {
        return invoke("whiteboard_write", { name: payload.title, content: payload.data });
    }
  };
})();
