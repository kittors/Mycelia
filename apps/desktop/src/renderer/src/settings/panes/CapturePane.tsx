import { Input, SettingRow, Toggle } from '../../shared/ui/index.js'
import { PaneIntro, PaneSection } from '../components.js'
import { useLiveConfig } from '../useLiveConfig.js'

/**
 * 写入把关。
 *
 * 「不是什么都要进知识库」这条产品原则的调节面板。
 * 放宽会引入噪音稀释检索质量，收紧会漏掉边界内容 —— 默认值偏严。
 */
export function CapturePane() {
  const { config, patchSection } = useLiveConfig()

  if (!config) return <div className="px-5 py-5 text-[12px] text-faint">加载中…</div>
  const capture = config.capture

  return (
    <div className="px-5 py-5 max-w-[560px]">
      <PaneIntro>
        agent 主动写入的内容会先过一道判断：<b className="text-muted">三个月后还有用吗？</b>
        没通过的进待确认队列而不是直接丢弃 —— 把关会误判，用户扫一眼就能把误杀的捞回来。
        用户明确说「记住」时跳过把关。
      </PaneIntro>

      <PaneSection title="准入规则">
        <div className="divide-y divide-border border border-border rounded-[10px] px-3">
          <SettingRow label="模型价值判断" hint="关掉后只跑长度与去重这类硬规则">
            <Toggle
              checked={capture.llmGatekeeper}
              label="模型价值判断"
              onChange={(llmGatekeeper) => patchSection('capture', { llmGatekeeper })}
            />
          </SettingRow>

          <SettingRow label="未通过时进待确认队列" hint="关掉则直接拒绝，不留痕迹">
            <Toggle
              checked={capture.queueRejected}
              label="进待确认队列"
              onChange={(queueRejected) => patchSection('capture', { queueRejected })}
            />
          </SettingRow>

          <SettingRow label="最短内容长度" hint="低于这个字数直接拒绝">
            <Input
              type="number"
              min={0}
              max={500}
              className="w-[88px]"
              value={capture.minContentLength}
              onChange={(event) =>
                patchSection('capture', { minContentLength: Number(event.target.value) || 0 })
              }
            />
          </SettingRow>

          <SettingRow label="单次会话写入上限" hint="防止某次对话刷屏">
            <Input
              type="number"
              min={1}
              max={100}
              className="w-[88px]"
              value={capture.maxPerSession}
              onChange={(event) =>
                patchSection('capture', { maxPerSession: Number(event.target.value) || 1 })
              }
            />
          </SettingRow>

          <SettingRow label="重复判定阈值" hint="向量相似度粗筛线。命中后仍由模型确认是否真重复">
            <Input
              type="number"
              min={0.5}
              max={1}
              step={0.01}
              className="w-[88px]"
              value={capture.supersedeThreshold}
              onChange={(event) =>
                patchSection('capture', {
                  supersedeThreshold: Number(event.target.value) || 0.88,
                })
              }
            />
          </SettingRow>
        </div>
      </PaneSection>
    </div>
  )
}
