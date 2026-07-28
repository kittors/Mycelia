import { Input, SettingRow, Toggle } from '../../shared/ui/index.js'
import { PaneIntro, PaneSection } from '../components.js'
import { useLiveConfig } from '../useLiveConfig.js'

/**
 * 文档索引参数。
 *
 * 这些值影响的是 RAG 的召回质量，改动后要对目录做一次全量重建才生效 ——
 * 已经切好的块不会因为参数变了就自动重切。
 */
export function KnowledgePane() {
  const { config, patchSection } = useLiveConfig()

  if (!config) return <div className="px-5 py-5 text-[12px] text-faint">加载中…</div>
  const knowledge = config.knowledge

  return (
    <div className="px-5 py-5 max-w-[560px]">
      <PaneIntro>
        分块沿标题、代码块、表格这些结构边界切，字数只是容量提示而不是切割位置 ——
        一个完整但偏长的代码块，永远比两个各缺一半的有用。
      </PaneIntro>

      <PaneSection title="分块">
        <div className="divide-y divide-border border border-border rounded-[10px] px-3">
          <SettingRow label="目标块长度" hint="字符数。太小会切碎语义，太大会稀释向量">
            <Input
              type="number"
              min={200}
              max={4000}
              step={100}
              className="w-[88px]"
              value={knowledge.chunkSize}
              onChange={(event) =>
                patchSection('knowledge', { chunkSize: Number(event.target.value) || 900 })
              }
            />
          </SettingRow>

          <SettingRow label="块间重叠" hint="避免答案正好被切在边界上">
            <Input
              type="number"
              min={0}
              max={800}
              step={50}
              className="w-[88px]"
              value={knowledge.chunkOverlap}
              onChange={(event) =>
                patchSection('knowledge', { chunkOverlap: Number(event.target.value) || 0 })
              }
            />
          </SettingRow>

          <SettingRow label="单文件大小上限" hint="KB。超过的跳过，避免啃进日志与导出数据">
            <Input
              type="number"
              min={16}
              max={10240}
              className="w-[88px]"
              value={knowledge.maxFileSizeKb}
              onChange={(event) =>
                patchSection('knowledge', { maxFileSizeKb: Number(event.target.value) || 512 })
              }
            />
          </SettingRow>
        </div>
      </PaneSection>

      <PaneSection title="检索" className="mt-6">
        <div className="divide-y divide-border border border-border rounded-[10px] px-3">
          <SettingRow label="文档权重" hint="文档结果与记忆结果混排时的相对权重">
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              className="w-[88px]"
              value={knowledge.weight}
              onChange={(event) =>
                patchSection('knowledge', { weight: Number(event.target.value) || 0.5 })
              }
            />
          </SettingRow>

          <SettingRow label="向量权重" hint="语义召回在混合检索里的占比">
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              className="w-[88px]"
              value={config.retrieval.vectorWeight}
              onChange={(event) =>
                patchSection('retrieval', { vectorWeight: Number(event.target.value) || 0.6 })
              }
            />
          </SettingRow>

          <SettingRow label="关键词权重" hint="专有名词、命令、报错信息靠它兜住">
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              className="w-[88px]"
              value={config.retrieval.keywordWeight}
              onChange={(event) =>
                patchSection('retrieval', { keywordWeight: Number(event.target.value) || 0.4 })
              }
            />
          </SettingRow>
        </div>
      </PaneSection>

      <PaneSection title="图片" className="mt-6">
        <SettingRow
          label="索引目录里的图片"
          hint="靠识图模型把图转成文字才能被搜到。每张图一次调用，大目录会有明显的时间与费用开销"
        >
          <Toggle
            label="索引目录里的图片"
            checked={knowledge.indexImages}
            onChange={(indexImages) => patchSection('knowledge', { indexImages })}
          />
        </SettingRow>

        {knowledge.indexImages && (
          <>
            <SettingRow label="单图上限" hint="超过就跳过。超大图对识图质量没有增益">
              <Input
                type="number"
                value={knowledge.maxImageSizeKb}
                onChange={(event) =>
                  patchSection('knowledge', { maxImageSizeKb: Number(event.target.value) || 8192 })
                }
                className="w-[110px] text-right"
              />
            </SettingRow>
            <p className="text-[11px] text-faint leading-relaxed">
              需要先在「模型 → 识图模型」里启用。没启用时图片只登记文件名，
              按文件名搜得到，内容搜不到。内容没变的图重新索引时会跳过，不会重复付费。
            </p>
          </>
        )}
      </PaneSection>
    </div>
  )
}
