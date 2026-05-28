'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sk', {
  // Async (return promises)
  getMemory:    ()          => ipcRenderer.invoke('get-memory'),
  clearMemory:  ()          => ipcRenderer.invoke('clear-memory'),
  deleteFact:   (key)       => ipcRenderer.invoke('delete-fact', key),
  addNote:      (text)      => ipcRenderer.invoke('add-note', text),
  getSettings:  ()     => ipcRenderer.invoke('get-settings'),
  saveSettings: (s)    => ipcRenderer.invoke('save-settings', s),
  checkLicense: ()     => ipcRenderer.invoke('check-license'),
  checkOllama:  ()     => ipcRenderer.invoke('check-ollama'),
  chat:         (text) => ipcRenderer.invoke('chat', text),
  manualScan:   ()     => ipcRenderer.invoke('manual-scan'),

  // Fire and forget
  hideWindow:     ()       => ipcRenderer.send('hide-window'),
  minimizeWindow: ()       => ipcRenderer.send('minimize-window'),
  openSettings:  ()        => ipcRenderer.send('open-settings'),
  closeSettings: ()        => ipcRenderer.send('close-settings'),
  closeSetup:    ()        => ipcRenderer.send('close-setup'),
  requestScreenPermission: () => ipcRenderer.invoke('request-screen-permission'),
  toggleScan:    (on)      => ipcRenderer.send('toggle-scan', on),
  setCollapsed:  (bool)    => ipcRenderer.send('set-collapsed', bool),
  setMode:       (mode)    => ipcRenderer.send('set-mode', mode),
  openUrl:       (url)     => ipcRenderer.send('open-url', url),
  openUrls:      (urls)    => ipcRenderer.send('open-urls', urls),
  clearHistory:  ()        => ipcRenderer.send('clear-history'),
  getWindowMode: ()        => ipcRenderer.invoke('get-window-mode'),

  // Events from main → renderer
  on: (ch, fn) => {
    const wrapped = (_, data) => fn(data);
    ipcRenderer.on(ch, wrapped);
    return () => ipcRenderer.removeListener(ch, wrapped); // returns unsubscribe fn
  },
});
