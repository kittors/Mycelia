/**
 * v1 初始表结构。
 *
 * 已发布的迁移永远不改 —— 要调整就追加新版本。
 * 用户库里已经跑过的 SQL 改了也不会重放，只会让新旧库结构分叉。
 */

import type { Migration } from './types.js'

export const migration: Migration = {
  version: 1,
  name: 'initial_schema',
  up: /* sql */ `
      CREATE TABLE memories (
        id                TEXT PRIMARY KEY,
        kind              TEXT NOT NULL,
        title             TEXT NOT NULL,
        content           TEXT NOT NULL,
        summary           TEXT NOT NULL DEFAULT '',
        tags              TEXT NOT NULL DEFAULT '[]',
        sensitivity       TEXT NOT NULL DEFAULT 'public',
        status            TEXT NOT NULL DEFAULT 'active',
        confidence        REAL NOT NULL DEFAULT 0.8,
        importance        REAL NOT NULL DEFAULT 0.5,
        pinned            INTEGER NOT NULL DEFAULT 0,
        origin            TEXT NOT NULL DEFAULT '{}',
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        last_accessed_at  INTEGER,
        access_count      INTEGER NOT NULL DEFAULT 0,
        expires_at        INTEGER,
        content_hash      TEXT NOT NULL,
        embedding_model   TEXT
      );

      CREATE INDEX idx_memories_kind        ON memories(kind);
      CREATE INDEX idx_memories_status      ON memories(status);
      CREATE INDEX idx_memories_updated     ON memories(updated_at DESC);
      CREATE INDEX idx_memories_created     ON memories(created_at DESC);
      CREATE INDEX idx_memories_hash        ON memories(content_hash);
      CREATE INDEX idx_memories_sensitivity ON memories(sensitivity);

      -- 归一化向量以 Float32 小端 BLOB 存储；检索时点积即余弦相似度
      CREATE TABLE memory_vectors (
        memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
        model     TEXT NOT NULL,
        dim       INTEGER NOT NULL,
        vec       BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- trigram 分词器对中文友好：无需外部分词库即可做子串匹配
      CREATE VIRTUAL TABLE memory_fts USING fts5(
        memory_id UNINDEXED,
        title,
        content,
        tags,
        tokenize = 'trigram'
      );

      CREATE TABLE edges (
        id         TEXT PRIMARY KEY,
        source_id  TEXT NOT NULL,
        target_id  TEXT NOT NULL,
        kind       TEXT NOT NULL,
        weight     REAL NOT NULL DEFAULT 0.5,
        reason     TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(source_id, target_id, kind)
      );
      CREATE INDEX idx_edges_source ON edges(source_id);
      CREATE INDEX idx_edges_target ON edges(target_id);
      CREATE INDEX idx_edges_kind   ON edges(kind);

      CREATE TABLE entities (
        id            TEXT PRIMARY KEY,
        kind          TEXT NOT NULL,
        key           TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        aliases       TEXT NOT NULL DEFAULT '[]',
        description   TEXT NOT NULL DEFAULT '',
        mention_count INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX idx_entities_kind ON entities(kind);

      CREATE TABLE memory_entities (
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        PRIMARY KEY (memory_id, entity_id)
      );
      CREATE INDEX idx_me_entity ON memory_entities(entity_id);

      -- 标签元数据：颜色、显示名、使用计数
      CREATE TABLE tags (
        tag         TEXT PRIMARY KEY,
        label       TEXT,
        color       TEXT,
        description TEXT,
        count       INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL
      );

      -- 已摄取的会话，避免重复提取；同时是「记忆来自哪次对话」的溯源表
      CREATE TABLE conversations (
        id            TEXT PRIMARY KEY,
        agent         TEXT NOT NULL,
        session_id    TEXT NOT NULL,
        title         TEXT NOT NULL DEFAULT '',
        cwd           TEXT,
        project       TEXT,
        branch        TEXT,
        model         TEXT,
        started_at    INTEGER NOT NULL,
        ended_at      INTEGER NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        source_ref    TEXT NOT NULL,
        processed_at  INTEGER,
        memory_count  INTEGER NOT NULL DEFAULT 0,
        digest        TEXT
      );
      CREATE INDEX idx_conv_agent   ON conversations(agent);
      CREATE INDEX idx_conv_ended   ON conversations(ended_at DESC);
      CREATE INDEX idx_conv_project ON conversations(project);

      -- 增量摄取游标：断点续读的依据
      CREATE TABLE ingest_cursors (
        source_ref      TEXT PRIMARY KEY,
        agent           TEXT NOT NULL,
        offset          INTEGER NOT NULL DEFAULT 0,
        last_modified   INTEGER NOT NULL DEFAULT 0,
        last_message_id TEXT,
        message_count   INTEGER NOT NULL DEFAULT 0,
        updated_at      INTEGER NOT NULL
      );

      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- 单例租约：保证同一时刻只有一个进程在跑摄取流水线
      CREATE TABLE leases (
        name       TEXT PRIMARY KEY,
        owner      TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

      -- 审计日志：记忆的每一次增删改都留痕，用户永远能回答「这条记忆怎么来的」
      CREATE TABLE audit_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        at         INTEGER NOT NULL,
        actor      TEXT NOT NULL,
        action     TEXT NOT NULL,
        memory_id  TEXT,
        detail     TEXT
      );
      CREATE INDEX idx_audit_at     ON audit_log(at DESC);
      CREATE INDEX idx_audit_memory ON audit_log(memory_id);
    `,
}
