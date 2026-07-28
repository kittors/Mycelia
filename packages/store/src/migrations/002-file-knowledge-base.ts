/**
 * v2 文件目录知识库。
 *
 * 知识源 / 文档 / 块三张表加各自的检索索引。
 * 这一层全是索引产物，整个删掉重建也不会丢用户数据 —— 文件才是事实来源。
 */

import type { Migration } from './types.js'

export const migration: Migration = {
  version: 2,
  name: 'file_knowledge_base',
  up: /* sql */ `
      -- 文件目录知识库：用户本地文档目录的只读镜像。
      -- 文件永远是事实来源，这里存的是索引产物，随时可以整个删掉重建。
      CREATE TABLE knowledge_sources (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        path            TEXT NOT NULL UNIQUE,
        enabled         INTEGER NOT NULL DEFAULT 1,
        watch           INTEGER NOT NULL DEFAULT 1,
        extensions      TEXT NOT NULL DEFAULT '["md"]',
        exclude         TEXT NOT NULL DEFAULT '[]',
        status          TEXT NOT NULL DEFAULT 'idle',
        error           TEXT,
        doc_count       INTEGER NOT NULL DEFAULT 0,
        chunk_count     INTEGER NOT NULL DEFAULT 0,
        last_indexed_at INTEGER,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      );

      CREATE TABLE documents (
        id           TEXT PRIMARY KEY,
        source_id    TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
        rel_path     TEXT NOT NULL,
        abs_path     TEXT NOT NULL,
        title        TEXT NOT NULL DEFAULT '',
        ext          TEXT NOT NULL DEFAULT '',
        size_bytes   INTEGER NOT NULL DEFAULT 0,
        mtime        INTEGER NOT NULL DEFAULT 0,
        -- 内容哈希是增量索引的依据：mtime 变了但内容没变就跳过重新嵌入
        content_hash TEXT NOT NULL,
        chunk_count  INTEGER NOT NULL DEFAULT 0,
        indexed_at   INTEGER NOT NULL,
        UNIQUE(source_id, rel_path)
      );
      CREATE INDEX idx_documents_source ON documents(source_id);
      CREATE INDEX idx_documents_hash   ON documents(content_hash);

      CREATE TABLE chunks (
        id         TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        source_id  TEXT NOT NULL,
        ord        INTEGER NOT NULL,
        -- 所属标题路径（"部署 › 生产环境"），检索结果里给用户定位用
        heading    TEXT NOT NULL DEFAULT '',
        content    TEXT NOT NULL,
        char_start INTEGER NOT NULL DEFAULT 0,
        char_end   INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_chunks_document ON chunks(document_id);
      CREATE INDEX idx_chunks_source   ON chunks(source_id);

      CREATE VIRTUAL TABLE chunk_fts USING fts5(
        chunk_id UNINDEXED,
        heading,
        content,
        tokenize = 'trigram'
      );

      CREATE TABLE chunk_vectors (
        chunk_id   TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
        model      TEXT NOT NULL,
        dim        INTEGER NOT NULL,
        vec        BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
}
