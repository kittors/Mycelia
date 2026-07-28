import { join } from 'node:path'
import { Vault } from '@mycelia/crypto'
import { type Config, createLogger, databasePath, dataDir } from '@mycelia/shared'
import { loadConfig, saveConfig } from './config-file.js'
import { acquireLease, type Db, getMeta, openDatabase, releaseLease, setMeta } from './db.js'
import { EdgeRepo, EntityRepo, LayoutRepo, TagRepo } from './graph/index.js'
import { ConversationRepo, CursorRepo } from './ingest.js'
import { ChunkRepo, DocumentRepo, SourceRepo } from './knowledge/index.js'
import { MemoryRepo } from './memories/index.js'
import { CHUNK_VECTORS, MEMORY_VECTORS, VectorIndex } from './vectors.js'

const log = createLogger('store')

export interface StoreOptions {
  dbPath?: string
  vaultPath?: string
  readonly?: boolean
}

/**
 * 数据层门面。
 *
 * 三个进程（Electron 主进程 / CLI / MCP server）各自 open 一个 Store 实例，
 * 通过 WAL 共享同一份 SQLite 文件。谁都可以读写，不需要中心化的 daemon。
 */
export class MyceliaStore {
  readonly db: Db
  readonly vault: Vault
  readonly vectors: VectorIndex
  readonly memories: MemoryRepo
  readonly edges: EdgeRepo
  readonly entities: EntityRepo
  readonly tags: TagRepo
  readonly conversations: ConversationRepo
  readonly cursors: CursorRepo
  // ── 文件目录知识库 ──
  readonly sources: SourceRepo
  readonly documents: DocumentRepo
  readonly chunks: ChunkRepo
  readonly layout: LayoutRepo
  readonly chunkVectors: VectorIndex

  private constructor(db: Db, vault: Vault, vectors: VectorIndex, chunkVectors: VectorIndex) {
    this.db = db
    this.vault = vault
    this.vectors = vectors
    this.chunkVectors = chunkVectors
    this.memories = new MemoryRepo(db, vectors, vault)
    this.edges = new EdgeRepo(db)
    this.entities = new EntityRepo(db)
    this.tags = new TagRepo(db)
    this.conversations = new ConversationRepo(db)
    this.cursors = new CursorRepo(db)
    this.sources = new SourceRepo(db)
    this.documents = new DocumentRepo(db)
    this.chunks = new ChunkRepo(db)
    this.layout = new LayoutRepo(db)
  }

  static open(opts: StoreOptions = {}): MyceliaStore {
    const dbPath = opts.dbPath ?? databasePath()
    const vaultPath = opts.vaultPath ?? join(dataDir(), 'vault.json')
    const db = openDatabase({ path: dbPath, readonly: opts.readonly })
    const vault = new Vault(vaultPath)
    const vectors = new VectorIndex(MEMORY_VECTORS)
    vectors.load(db)
    const chunkVectors = new VectorIndex(CHUNK_VECTORS)
    chunkVectors.load(db)
    log.debug(
      `已打开数据库 ${dbPath}，载入 ${vectors.size} 条记忆向量、${chunkVectors.size} 条文档块向量`,
    )
    return new MyceliaStore(db, vault, vectors, chunkVectors)
  }

  config(): Config {
    return loadConfig()
  }

  saveConfig(cfg: Config): void {
    saveConfig(cfg)
  }

  meta(key: string): string | undefined {
    return getMeta(this.db, key)
  }

  setMeta(key: string, value: string): void {
    setMeta(this.db, key, value)
  }

  /** 抢占摄取租约，避免多进程重复跑流水线 */
  acquireLease(name: string, owner: string, ttlMs: number): boolean {
    return acquireLease(this.db, name, owner, ttlMs)
  }

  releaseLease(name: string, owner: string): void {
    releaseLease(this.db, name, owner)
  }

  /** 审计日志查询，UI 的「记忆变更历史」用它 */
  auditLog(limit = 100, memoryId?: string) {
    const rows = memoryId
      ? this.db
          .prepare('SELECT * FROM audit_log WHERE memory_id = ? ORDER BY at DESC LIMIT ?')
          .all(memoryId, limit)
      : this.db.prepare('SELECT * FROM audit_log ORDER BY at DESC LIMIT ?').all(limit)
    return rows as Array<{
      id: number
      at: number
      actor: string
      action: string
      memory_id: string | null
      detail: string | null
    }>
  }

  /** 数据库体检：给 `myc doctor` 和桌面端设置页用 */
  health() {
    const pageCount = (this.db.pragma('page_count', { simple: true }) as number) ?? 0
    const pageSize = (this.db.pragma('page_size', { simple: true }) as number) ?? 0
    return {
      sizeBytes: pageCount * pageSize,
      walMode: this.db.pragma('journal_mode', { simple: true }) as string,
      memoryCount: this.memories.count({ status: ['active', 'pending', 'archived'] }),
      vectorCount: this.vectors.size,
      edgeCount: this.edges.count(),
      entityCount: this.entities.all().length,
      sourceCount: this.sources.all().length,
      chunkCount: this.chunks.count(),
      chunkVectorCount: this.chunkVectors.size,
      vaultInitialized: this.vault.initialized,
      vaultUnlocked: this.vault.unlocked,
    }
  }

  /** 清理过期记忆（比如设了 expiresAt 的周报类记忆） */
  purgeExpired(): number {
    const now = Date.now()
    const expired = this.db
      .prepare(
        'SELECT id FROM memories WHERE expires_at IS NOT NULL AND expires_at < ? AND pinned = 0',
      )
      .all(now) as Array<{ id: string }>
    for (const { id } of expired) this.memories.delete(id, 'system:expiry')
    return expired.length
  }

  vacuum(): void {
    this.db.exec('VACUUM')
  }

  close(): void {
    this.vault.lock()
    this.db.close()
  }
}

export * from './config-file.js'
export * from './db.js'
export * from './graph/index.js'
export * from './ingest.js'
export * from './knowledge/index.js'
export * from './memories/index.js'
export { MIGRATIONS } from './migrations/index.js'
export * from './rows.js'
export * from './vectors.js'
