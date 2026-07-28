/**
 * v3 记忆的写入来源与召回统计。
 *
 * capture_mode 区分 agent 主动写入 / 用户手写 / 历史导入，审核队列据此排序；
 * recall_count 统计的是被检索命中，与 access_count（被打开查看）含义不同。
 */

import type { Migration } from './types.js'

export const migration: Migration = {
  version: 3,
  name: 'memory_capture_provenance',
  up: /* sql */ `
      -- 主动写入的来源标记：区分 agent 通过 MCP 主动记的、用户手写的、历史导入的。
      -- 审核队列要据此排序 —— 导入的存量默认可信度更低。
      ALTER TABLE memories ADD COLUMN capture_mode TEXT NOT NULL DEFAULT 'manual';
      CREATE INDEX idx_memories_capture ON memories(capture_mode);

      -- 记忆被检索命中的次数与最近命中时间，用于「哪些记忆真正在被用」的价值排序。
      -- access_count 统计的是读取，这里单独统计检索召回，两者含义不同。
      ALTER TABLE memories ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE memories ADD COLUMN last_recalled_at INTEGER;
    `,
}
