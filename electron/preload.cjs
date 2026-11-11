// The only bridge between the page and Electron: fullscreen and quit. No Node access for the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('motionfit', {
  isDesktop: true,
  setFullscreen: (on) => ipcRenderer.send('fullscreen:set', !!on),
  isFullscreen: () => ipcRenderer.invoke('fullscreen:get'),
  quit: () => ipcRenderer.send('app:quit'),
});
