/**
 * v4 图谱布局坐标。
 *
 * 力导向每次都从随机初始位置重排，代价有两个：
 *
 *   1. 每次进入图谱都要等。一千多个节点跑几百次迭代，几秒起步；
 *      切走再切回来又是一遍，而数据根本没变。
 *   2. 空间记忆被反复抹掉。同一份数据每次排出来的位置都不一样，
 *      上次记住的「那个簇在右上角」下次就不成立 —— 这比慢更伤，
 *      因为它让人根本无法在图上建立方位感。
 *
 * 坐标存下来之后，再次进入直接复用，只有新增的节点需要安置。
 *
 * 单独一张表而不是往 memories 上加两列：坐标是**视图状态**，不是记忆的属性。
 * 清空这张表应该只意味着「布局重来」，不该牵动记忆本身。
 */

import type { Migration } from './types.js'

export const migration: Migration = {
  version: 4,
  name: 'graph_layout',
  up: /* sql */ `
      CREATE TABLE graph_layout (
        memory_id  TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
        x          REAL NOT NULL,
        y          REAL NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
}
