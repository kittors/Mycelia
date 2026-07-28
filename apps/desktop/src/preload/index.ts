import { contextBridge, ipcRenderer } from 'electron'
import type { MainEvent, MyceliaApi } from '../shared/ipc-contract.js'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args)

const api: MyceliaApi = {
  recall: (query) => invoke('recall', query),
  listMemories: (filter) => invoke('listMemories', filter),
  getMemory: (id) => invoke('getMemory', id),
  getDashboard: () => invoke('getDashboard'),
  getTimeline: (weeks) => invoke('getTimeline', weeks),
  getGraph: (opts) => invoke('getGraph', opts),
  getTags: () => invoke('getTags'),
  getEntities: () => invoke('getEntities'),
  createMemory: (input) => invoke('createMemory', input),
  updateMemory: (id, patch) => invoke('updateMemory', id, patch),
  deleteMemory: (id) => invoke('deleteMemory', id),
  acceptMemory: (id) => invoke('acceptMemory', id),
  rejectMemory: (id) => invoke('rejectMemory', id),
  bulkAction: (ids, action) => invoke('bulkAction', ids, action),
  setTagMeta: (tag, patch) => invoke('setTagMeta', tag, patch),
  renameTag: (from, to) => invoke('renameTag', from, to),
  syncNow: (force) => invoke('syncNow', force),
  cancelSync: () => invoke('cancelSync'),
  getSyncState: () => invoke('getSyncState'),
  rebuildGraph: () => invoke('rebuildGraph'),
  vaultStatus: () => invoke('vaultStatus'),
  vaultInit: (passphrase) => invoke('vaultInit', passphrase),
  vaultUnlock: (passphrase) => invoke('vaultUnlock', passphrase),
  vaultLock: () => invoke('vaultLock'),
  vaultUnlockWithKeychain: () => invoke('vaultUnlockWithKeychain'),
  vaultEnableKeychain: () => invoke('vaultEnableKeychain'),
  listSources: () => invoke('listSources'),
  pickAndAddSource: () => invoke('pickAndAddSource'),
  updateSource: (id, patch) => invoke('updateSource', id, patch),
  removeSource: (id) => invoke('removeSource', id),
  indexSource: (id, force) => invoke('indexSource', id, force),
  cancelIndex: () => invoke('cancelIndex'),
  listDocuments: (sourceId) => invoke('listDocuments', sourceId),
  readDocument: (documentId) => invoke('readDocument', documentId),
  saveGraphLayout: (points) => invoke('saveGraphLayout', points),
  resetGraphLayout: () => invoke('resetGraphLayout'),
  searchGraphNodes: (text, limit) => invoke('searchGraphNodes', text, limit),
  searchDocuments: (query, opts) => invoke('searchDocuments', query, opts),
  saveNote: (input) => invoke('saveNote', input),
  readNote: (documentId) => invoke('readNote', documentId),
  getConfig: () => invoke('getConfig'),
  setConfig: (patch) => invoke('setConfig', patch),
  testLlm: () => invoke('testLlm'),
  getIntegrations: () => invoke('getIntegrations'),
  installIntegration: (agent) => invoke('installIntegration', agent),
  uninstallIntegration: (agent) => invoke('uninstallIntegration', agent),
  getDigest: (days) => invoke('getDigest', days),
  openExternal: (url) => invoke('openExternal', url),
  openPath: (path) => invoke('openPath', path),
  getPlatform: () => invoke('getPlatform'),
  onEvent: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: MainEvent) => handler(payload)
    ipcRenderer.on('mycelia:event', listener)
    return () => ipcRenderer.removeListener('mycelia:event', listener)
  },
}

contextBridge.exposeInMainWorld('mycelia', api)
