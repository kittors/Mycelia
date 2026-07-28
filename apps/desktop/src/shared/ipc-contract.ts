/**
 * IPC 契约。
 *
 * 主进程与渲染进程共享这一份类型定义 —— 通道名写错、参数少传，
 * 在编译期就会报错，而不是运行时静默失败。
 * preload 只暴露这里声明的方法，渲染层拿不到任何 Node 能力。
 */

import type { DocumentHit, IndexResult } from '@mycelia/core'
import type { SyncSummary } from '@mycelia/daemon'
import type {
  Config,
  GraphSnapshot,
  MemoryKind,
  MemoryPatch,
  SearchQuery,
  Sensitivity,
} from '@mycelia/shared'
import type { StoredDocument, StoredMemory, StoredSource } from '@mycelia/store'

export interface RecallResult {
  memories: StoredMemory[]
  hits: Array<{
    memoryId: string
    score: number
    breakdown: Record<string, number>
    snippet: string
    viaMemoryId?: string
  }>
  channels: { vector: number; keyword: number; graph: number }
  durationMs: number
}

export interface MemoryDetail {
  memory: StoredMemory
  neighbors: Array<{
    memory: StoredMemory
    weight: number
    kind: string
    reason?: string
  }>
  entities: Array<{ id: string; name: string; kind: string; mentionCount: number }>
  audit: Array<{ at: number; actor: string; action: string; detail: string | null }>
}

export interface DashboardData {
  stats: {
    total: number
    pending: number
    byKind: Record<string, number>
    byProject: Record<string, number>
    byAgent: Record<string, number>
    bySensitivity: Record<string, number>
    embedded: number
  }
  recent: StoredMemory[]
  pending: StoredMemory[]
  topTags: Array<{ tag: string; count: number; color?: string }>
  /** 按天统计的新增记忆，供热力图使用。date 是本地时区的 YYYY-MM-DD */
  activity: Array<{ date: string; count: number; byKind: Record<string, number> }>
  lastSyncAt: number | null
  agents: Array<{
    agent: string
    available: boolean
    path: string
    installed: boolean
    skillInstalled: boolean
  }>
  vault: { initialized: boolean; unlocked: boolean; secretCount: number }
  /** 三层知识库的规模：记忆层在 stats 里，这里是文件层 */
  knowledge: { sources: number; documents: number; chunks: number }
  models: {
    embedder: { id: string; kind: string; dims: number }
    llm: { id: string; model: string; enabled: boolean }
  }
}

/** 设置页的 agent 行所需的全部信息 */
export interface AgentIntegrationView {
  agent: string
  configPath: string
  /** MCP 是否已注册 */
  installed: boolean
  /** 本机是否装了这个 agent（CLI 在 PATH 或配置目录已生成） */
  agentPresent: boolean
  /** CLI 可执行文件路径 */
  cliPath?: string
  /** CLI 报告的版本号 */
  version?: string
  /** 配置目录是否已生成 —— 装了但没跑过时为 false */
  configDirExists: boolean
  /** 该 agent 是否有 skill 机制 */
  skillSupported: boolean
  skillInstalled: boolean
}

export interface TimelineEntry {
  weekStart: number
  weekLabel: string
  memories: StoredMemory[]
  projects: Array<{ name: string; count: number }>
  sessionCount: number
}

/** 主进程 → 渲染进程的推送事件 */
export type MainEvent =
  | { type: 'sync:start' }
  | { type: 'sync:progress'; done: number; total: number; current: string }
  | { type: 'sync:complete'; summary: SyncSummary }
  | { type: 'sync:error'; message: string }
  | { type: 'index:start'; sourceId: string }
  | { type: 'index:progress'; done: number; total: number; current: string }
  | { type: 'index:complete'; result: IndexResult }
  | { type: 'index:error'; message: string }
  | { type: 'vault:changed'; unlocked: boolean }
  | { type: 'memories:changed' }
  | { type: 'navigate'; view: string }
  | { type: 'command'; action: 'new-memory' | 'palette' | 'settings' }

export interface MyceliaApi {
  // ─── 检索与读取 ───
  recall(query: Partial<SearchQuery>): Promise<RecallResult>
  listMemories(filter: {
    kinds?: string[]
    tags?: string[]
    project?: string
    agent?: string
    status?: string[]
    sensitivity?: string[]
    limit?: number
    offset?: number
    orderBy?: string
  }): Promise<{ memories: StoredMemory[]; total: number }>
  getMemory(id: string): Promise<MemoryDetail | null>
  getDashboard(): Promise<DashboardData>
  getTimeline(weeks: number): Promise<TimelineEntry[]>
  getGraph(opts: {
    tags?: string[]
    project?: string
    kinds?: string[]
    focusId?: string
    focusDepth?: number
    statuses?: string[]
    maxNodes?: number
  }): Promise<GraphSnapshot>
  getTags(): Promise<Array<{ tag: string; count: number; color?: string; label?: string }>>
  getEntities(): Promise<Array<{ id: string; name: string; kind: string; mentionCount: number }>>

  // ─── 写入 ───
  createMemory(input: {
    title: string
    content: string
    kind: MemoryKind
    tags: string[]
    sensitivity: Sensitivity
    importance: number
    project?: string
    pinned?: boolean
  }): Promise<StoredMemory>
  updateMemory(id: string, patch: MemoryPatch): Promise<StoredMemory>
  deleteMemory(id: string): Promise<boolean>
  acceptMemory(id: string): Promise<StoredMemory>
  rejectMemory(id: string): Promise<boolean>
  bulkAction(
    ids: string[],
    action: 'accept' | 'reject' | 'archive' | 'pin' | 'unpin',
  ): Promise<number>
  setTagMeta(tag: string, patch: { color?: string; label?: string }): Promise<void>
  renameTag(from: string, to: string): Promise<number>

  // ─── 同步 ───
  syncNow(force?: boolean): Promise<SyncSummary>
  cancelSync(): Promise<void>
  getSyncState(): Promise<{ state: string; lastSummary: SyncSummary | null }>
  rebuildGraph(): Promise<{ created: number; scanned: number; durationMs: number }>

  // ─── 保险箱 ───
  vaultStatus(): Promise<{
    initialized: boolean
    unlocked: boolean
    wrappers: Array<{ id: string; type: string; label?: string; createdAt: number }>
  }>
  vaultInit(passphrase: string): Promise<boolean>
  vaultUnlock(passphrase: string): Promise<boolean>
  vaultLock(): Promise<void>
  /** 用系统钥匙串免密解锁（Electron safeStorage） */
  vaultUnlockWithKeychain(): Promise<boolean>
  vaultEnableKeychain(): Promise<boolean>

  // ─── 文件目录知识库 ───
  listSources(): Promise<StoredSource[]>
  /** 打开系统目录选择器并挂载。返回 null 表示用户取消 */
  pickAndAddSource(): Promise<StoredSource | null>
  updateSource(
    id: string,
    patch: { name?: string; enabled?: boolean; watch?: boolean; extensions?: string[] },
  ): Promise<StoredSource | null>
  removeSource(id: string): Promise<boolean>
  indexSource(id: string, force?: boolean): Promise<IndexResult>
  cancelIndex(): Promise<void>
  listDocuments(sourceId: string): Promise<StoredDocument[]>
  /** 已用过的标签及其频次，写入记忆时作为候选 */
  listTags(): Promise<Array<{ tag: string; count: number; color?: string; label?: string }>>
  /** 存一张图，返回可直接写进 Markdown 的 asset:// 地址 */
  saveImage(input: { base64: string; ext: string }): Promise<{ url: string; name: string }>
  /** 让视觉模型描述一张图，用于让图片可被检索 */
  describeImage(input: {
    base64: string
    mime: string
    hint?: string
  }): Promise<{ text: string; enabled: boolean }>
  /** 存下图谱布局坐标，下次进入直接复用 */
  saveGraphLayout(points: ReadonlyArray<{ id: string; x: number; y: number }>): Promise<void>
  /** 清空布局，下次进入重新排布 */
  resetGraphLayout(): Promise<void>
  /** 图内节点搜索，查全库（不限于当前视图渲染的节点） */
  searchGraphNodes(
    text: string,
    limit?: number,
  ): Promise<Array<{ id: string; label: string; kind: string }>>
  searchDocuments(
    query: string,
    opts?: { limit?: number; sourceIds?: string[] },
  ): Promise<DocumentHit[]>
  /**
   * 读一篇文档的正文供编辑。
   *
   * onDisk 为 true 表示正本是磁盘上的文件，保存要走 writeDocument ——
   * 走 saveNote 会另存成一篇手记，磁盘上那份纹丝不动，改了个寂寞。
   */
  readDocument(documentId: string): Promise<{
    text: string
    title: string
    absPath: string
    onDisk: boolean
  } | null>
  /** 把改动写回磁盘原文件并重新索引 */
  writeDocument(documentId: string, text: string): Promise<{ chunkCount: number }>
  /** 手写一篇知识入库。传 documentId 表示编辑已有的那篇 */
  saveNote(input: {
    title: string
    text: string
    documentId?: string
  }): Promise<{ documentId: string; chunkCount: number }>
  /** 读回手记原文供编辑（已剥掉入库时补的标题行） */
  readNote(documentId: string): Promise<{ document: StoredDocument; text: string } | null>

  // ─── 配置与集成 ───
  getConfig(): Promise<Config>
  setConfig(patch: Record<string, unknown>): Promise<Config>
  testLlm(): Promise<{ ok: boolean; message: string; latencyMs?: number }>
  getIntegrations(): Promise<AgentIntegrationView[]>
  installIntegration(agent: string): Promise<boolean>
  uninstallIntegration(agent: string): Promise<boolean>

  // ─── 汇总 ───
  getDigest(days: number): Promise<string>

  // ─── 系统 ───
  openExternal(url: string): Promise<void>
  openPath(path: string): Promise<void>
  getPlatform(): Promise<{ platform: string; dataDir: string; version: string }>
  onEvent(handler: (event: MainEvent) => void): () => void
}
