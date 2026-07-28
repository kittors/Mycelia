/**
 * 主动记忆的写入编排。
 *
 * 把关（capture.ts）只回答「这条该不该进」，这里负责按裁决结果落地：
 * 拒绝就返回理由、重复就更新旧记忆、通过或待定就新建。
 *
 * 和 MemoryService 分开是因为这段逻辑值得单独读懂 ——
 * 它是「不是什么都要进知识库」这条产品原则最终生效的地方。
 */

import type { CaptureMode, MemoryInput, MemoryPatch } from '@mycelia/shared'
import { createLogger, truncate } from '@mycelia/shared'
import type { StoredMemory } from '@mycelia/store'
import type { CaptureCandidate, CaptureDecision, CaptureGate } from './capture.js'

const log = createLogger('core:capture-flow')

export interface CaptureOptions {
  origin?: Partial<MemoryInput['origin']>
  captureMode?: CaptureMode
  actor?: string
  /** 用户明确说了「记住 X」时置真，跳过把关 */
  force?: boolean
}

/** 写入所需的能力。由 MemoryService 提供，这里不直接碰 store */
export interface CaptureDeps {
  gate: CaptureGate
  remember(
    input: Omit<MemoryInput, 'origin'> & { origin?: Partial<MemoryInput['origin']> },
    actor?: string,
  ): Promise<StoredMemory>
  update(id: string, patch: MemoryPatch, actor?: string): Promise<StoredMemory>
}

export interface CaptureOutcome {
  decision: CaptureDecision
  memory: StoredMemory | null
}

export async function runCapture(
  deps: CaptureDeps,
  candidate: CaptureCandidate,
  opts: CaptureOptions = {},
): Promise<CaptureOutcome> {
  const decision = await deps.gate.evaluate(candidate, { force: opts.force })
  const actor = opts.actor ?? 'agent'

  if (decision.verdict === 'reject') {
    log.debug(`拒绝写入「${candidate.title}」：${decision.reason}`)
    return { decision, memory: null }
  }

  // 已有等价记忆：更新它并留下一条 supersedes 边，而不是让知识库里躺两份
  if (decision.verdict === 'merge' && decision.mergeTargetId) {
    const merged = await deps.update(
      decision.mergeTargetId,
      {
        content: candidate.content,
        title: candidate.title,
        summary: truncate(candidate.content, 200),
        tags: candidate.tags,
        importance: candidate.importance,
      },
      `${actor}:merge`,
    )
    return { decision, memory: merged }
  }

  const memory = await deps.remember(
    {
      title: candidate.title,
      content: candidate.content,
      kind: candidate.kind,
      tags: candidate.tags ?? [],
      sensitivity: candidate.sensitivity ?? 'public',
      importance: candidate.importance ?? 0.5,
      confidence: decision.score,
      // 没通过把关的进待审队列，用户在桌面端一眼扫过就能捞回误杀的
      status: decision.verdict === 'review' ? 'pending' : 'active',
      captureMode: opts.captureMode ?? 'agent',
      origin: { ...opts.origin, project: candidate.project ?? opts.origin?.project },
    },
    actor,
  )

  return { decision, memory }
}
