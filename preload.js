'use strict';

const { init: sentryRendererInit } = require('@sentry/electron/renderer');
sentryRendererInit({
  dsn: 'https://e43ea3481b44b42aebfaf0723599733e@o4511469742391296.ingest.de.sentry.io/4511469748355152',
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sk', {
  // Async (return promises)
  getMemory:    ()          => ipcRenderer.invoke('get-memory'),
  clearMemory:  ()          => ipcRenderer.invoke('clear-memory'),
  deleteFact:   (key)       => ipcRenderer.invoke('delete-fact', key),
  addNote:      (text)      => ipcRenderer.invoke('add-note', text),
  // Notes
  getNotes:     ()          => ipcRenderer.invoke('get-notes'),
  saveNote:     (n)         => ipcRenderer.invoke('save-note', n),
  deleteNote:   (id)        => ipcRenderer.invoke('delete-note', id),
  pinNote:      (id)        => ipcRenderer.invoke('pin-note', id),
  // Savings
  getSavings:   ()          => ipcRenderer.invoke('get-savings'),
  logSaving:    (s)         => ipcRenderer.invoke('log-saving', s),
  deleteSaving: (id)        => ipcRenderer.invoke('delete-saving', id),
  // Diet
  getDiet:      ()          => ipcRenderer.invoke('get-diet'),
  logDiet:      (d)         => ipcRenderer.invoke('log-diet', d),
  deleteDiet:   (id)        => ipcRenderer.invoke('delete-diet', id),
  getSettings:  ()     => ipcRenderer.invoke('get-settings'),
  saveSettings: (s)    => ipcRenderer.invoke('save-settings', s),
  getProfile:   ()     => ipcRenderer.invoke('get-profile'),
  saveProfile:  (p)    => ipcRenderer.invoke('save-profile', p),
  checkLicense: ()     => ipcRenderer.invoke('check-license'),
  checkOllama:  ()     => ipcRenderer.invoke('check-ollama'),
  getStats:     ()     => ipcRenderer.invoke('get-stats'),
  // Conversation management
  getConversations: ()   => ipcRenderer.invoke('get-conversations'),
  newChat:          ()   => ipcRenderer.invoke('new-chat'),
  loadChat:         (id) => ipcRenderer.invoke('load-chat', id),
  deleteChat:       (id) => ipcRenderer.invoke('delete-chat', id),
  chat:         (text) => ipcRenderer.invoke('chat', text),
  manualScan:   ()        => ipcRenderer.invoke('manual-scan'),
  regionSelect: ()        => ipcRenderer.invoke('region-select'),
  selectRegion: (r)       => ipcRenderer.send('region-selected', r),
  cancelRegion: ()        => ipcRenderer.send('region-cancelled'),
  analyzeImage: (b64)     => ipcRenderer.invoke('analyze-image', b64),
  estimateKcal: (item)    => ipcRenderer.invoke('estimate-kcal', item),

  // Fire and forget
  hideWindow:     ()       => ipcRenderer.send('hide-window'),
  minimizeWindow: ()       => ipcRenderer.send('minimize-window'),
  openSettings:  ()        => ipcRenderer.send('open-settings'),
  closeSettings: ()        => ipcRenderer.send('close-settings'),
  closeSetup:    ()        => ipcRenderer.send('close-setup'),
  requestScreenPermission: () => ipcRenderer.invoke('request-screen-permission'),
  toggleScan:    (on)      => ipcRenderer.send('toggle-scan', on),
  setCollapsed:  (bool)    => ipcRenderer.send('set-collapsed', bool),
  openUrl:       (url)     => ipcRenderer.send('open-url', url),
  openUrls:      (urls)    => ipcRenderer.send('open-urls', urls),
  clearHistory:  ()        => ipcRenderer.send('clear-history'),
  getWindowMode: ()        => ipcRenderer.invoke('get-window-mode'),
  installUpdate: ()        => ipcRenderer.send('install-update'),

  // Events from main → renderer
  on: (ch, fn) => {
    const wrapped = (_, data) => fn(data);
    ipcRenderer.on(ch, wrapped);
    return () => ipcRenderer.removeListener(ch, wrapped); // returns unsubscribe fn
  },
});
