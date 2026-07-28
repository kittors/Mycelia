import type { Db } from './db.js'

/**
 * 向量索引。
 *
 * 刻意不用 sqlite-vec / hnswlib 这类原生扩展 —— 它们会给三平台 Electron 打包
 * 带来编译与签名负担。这里的取舍是：向量全部归一化后存 Float32 BLOB，
 * 进程启动时一次性载入内存，检索走点积暴力扫描。
 *
 * 实测量级：384 维 × 10 万条 ≈ 150MB 内存、单次检索 < 50ms。
 * 个人知识库很难超过这个量级；真超了再换 HNSW 也只是替换这一个文件。
 */
export interface VectorIndexOptions {
  /** 存放向量的表名 */
  table: string
  /** 该表的主键列名 */
  idColumn: string
}

/** 记忆向量与文档块向量结构完全一致，只是落在不同的表 */
export const MEMORY_VECTORS: VectorIndexOptions = {
  table: 'memory_vectors',
  idColumn: 'memory_id',
}
export const CHUNK_VECTORS: VectorIndexOptions = { table: 'chunk_vectors', idColumn: 'chunk_id' }

export class VectorIndex {
  private readonly vectors = new Map<string, Float32Array>()
  private dim = 0
  private model = ''
  private readonly table: string
  private readonly idColumn: string

  constructor(options: VectorIndexOptions = MEMORY_VECTORS) {
    this.table = options.table
    this.idColumn = options.idColumn
  }

  get size(): number {
    return this.vectors.size
  }

  get dimensions(): number {
    return this.dim
  }

  get modelId(): string {
    return this.model
  }

  /** 从数据库全量载入。只在进程启动或换模型后调用 */
  load(db: Db): void {
    this.vectors.clear()
    const rows = db
      .prepare(`SELECT ${this.idColumn} AS id, model, dim, vec FROM ${this.table}`)
      .all() as Array<{ id: string; model: string; dim: number; vec: Buffer }>

    for (const row of rows) {
      this.vectors.set(row.id, bufferToVector(row.vec))
      if (!this.dim) {
        this.dim = row.dim
        this.model = row.model
      }
    }
  }

  has(id: string): boolean {
    return this.vectors.has(id)
  }

  upsert(db: Db, id: string, model: string, vector: Float32Array): void {
    const normalized = normalize(vector)
    this.vectors.set(id, normalized)
    this.dim = normalized.length
    this.model = model
    db.prepare(`
      INSERT INTO ${this.table} (${this.idColumn}, model, dim, vec, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(${this.idColumn}) DO UPDATE SET
        model = excluded.model, dim = excluded.dim,
        vec = excluded.vec, updated_at = excluded.updated_at
    `).run(id, model, normalized.length, vectorToBuffer(normalized), Date.now())
  }

  /** 批量写入。文档索引一次产出几百个块，逐条开事务会慢一个数量级 */
  upsertMany(
    db: Db,
    model: string,
    entries: ReadonlyArray<{ id: string; vector: Float32Array }>,
  ): void {
    if (entries.length === 0) return
    const stmt = db.prepare(`
      INSERT INTO ${this.table} (${this.idColumn}, model, dim, vec, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(${this.idColumn}) DO UPDATE SET
        model = excluded.model, dim = excluded.dim,
        vec = excluded.vec, updated_at = excluded.updated_at
    `)
    const now = Date.now()
    db.transaction(() => {
      for (const entry of entries) {
        const normalized = normalize(entry.vector)
        this.vectors.set(entry.id, normalized)
        this.dim = normalized.length
        stmt.run(entry.id, model, normalized.length, vectorToBuffer(normalized), now)
      }
    })()
    this.model = model
  }

  remove(db: Db, id: string): void {
    this.vectors.delete(id)
    db.prepare(`DELETE FROM ${this.table} WHERE ${this.idColumn} = ?`).run(id)
  }

  /** 批量剔除内存副本。级联删除已经处理了数据库侧，这里只同步内存 */
  forget(ids: Iterable<string>): void {
    for (const id of ids) this.vectors.delete(id)
  }

  /**
   * 近邻检索。
   * filter 在打分前生效 —— 先过滤再算分，而不是算完再筛，
   * 这样带条件的检索（比如「只在 infra 标签里找」）不会白算几万次点积。
   */
  search(
    query: Float32Array,
    limit: number,
    filter?: (id: string) => boolean,
  ): Array<{ id: string; score: number }> {
    const q = normalize(query)
    if (q.length !== this.dim && this.dim !== 0) return []

    // 小顶堆的效果用「维护一个长度为 limit 的有序数组」近似，limit 通常 < 50
    const top: Array<{ id: string; score: number }> = []
    let min = -Infinity

    for (const [id, vec] of this.vectors) {
      if (filter && !filter(id)) continue
      const score = dot(q, vec)
      if (top.length < limit) {
        top.push({ id, score })
        if (top.length === limit) {
          top.sort((a, b) => b.score - a.score)
          min = top[top.length - 1]!.score
        }
      } else if (score > min) {
        top[top.length - 1] = { id, score }
        // 插入排序：几乎有序，比全量 sort 快得多
        for (let i = top.length - 1; i > 0 && top[i]!.score > top[i - 1]!.score; i--) {
          const tmp = top[i]!
          top[i] = top[i - 1]!
          top[i - 1] = tmp
        }
        min = top[top.length - 1]!.score
      }
    }

    if (top.length < limit) top.sort((a, b) => b.score - a.score)
    return top
  }

  /** 取某个条目的向量，用于「找相似记忆」与语义边生成 */
  get(id: string): Float32Array | undefined {
    return this.vectors.get(id)
  }

  /** 全量遍历，供图谱构建批量算相似度 */
  entries(): IterableIterator<[string, Float32Array]> {
    return this.vectors.entries()
  }
}

export function normalize(v: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!
  const norm = Math.sqrt(sum)
  if (norm === 0 || Math.abs(norm - 1) < 1e-6) return v
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm
  return out
}

/** 两个已归一化向量的点积 == 余弦相似度 */
export function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let sum = 0
  // 四路展开：V8 对这个模式的向量化效果最好
  let i = 0
  for (; i + 3 < n; i += 4) {
    sum += a[i]! * b[i]! + a[i + 1]! * b[i + 1]! + a[i + 2]! * b[i + 2]! + a[i + 3]! * b[i + 3]!
  }
  for (; i < n; i++) sum += a[i]! * b[i]!
  return sum
}

export function cosine(a: Float32Array, b: Float32Array): number {
  return dot(normalize(a), normalize(b))
}

function vectorToBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

function bufferToVector(buf: Buffer): Float32Array {
  // Buffer 可能不是 4 字节对齐，直接 new Float32Array(buf.buffer) 会抛错，必须拷贝
  const out = new Float32Array(buf.byteLength / 4)
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4)
  return out
}
