const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('worldZero', {
  getState: () => ipcRenderer.invoke('get-state'),
  login: () => ipcRenderer.invoke('login'),
  install: () => ipcRenderer.invoke('install'),
  updatePack: () => ipcRenderer.invoke('update-pack'),
  play: () => ipcRenderer.invoke('play'),
  saveConfig: value => ipcRenderer.invoke('save-config', value),
  openInstance: () => ipcRenderer.invoke('open-instance'),
  openLink: url => ipcRenderer.invoke('open-link', url),
  logout: () => ipcRenderer.invoke('logout'),
  onLog: callback => ipcRenderer.on('log', (_event, data) => callback(data)),
  onProgress: callback => ipcRenderer.on('progress', (_event, data) => callback(data)),
  onGameStarted: callback => ipcRenderer.on('game-started', (_event, data) => callback(data)),
  onGameClosed: callback => ipcRenderer.on('game-closed', (_event, data) => callback(data))
});
