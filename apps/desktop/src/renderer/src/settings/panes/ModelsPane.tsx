import { useState } from 'react'
import { cn } from '../../shared/lib/cn.js'
import { Button, Field, Icon, Input, Select, SettingRow, Toggle } from '../../shared/ui/index.js'
import { PaneIntro, PaneSection } from '../components.js'
import { PROTOCOLS } from '../protocols.js'
import { useLiveConfig } from '../useLiveConfig.js'

export function ModelsPane() {
  const { config, patchSection } = useLiveConfig()
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  if (!config) return <div className="px-5 py-5 text-[12px] text-faint">加载中…</div>

  const llm = config.llm
  const protocol = PROTOCOLS.find((item) => item.value === llm.provider)

  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      // 先落盘再测，否则测的是上一次保存的配置
      await window.mycelia.setConfig(config)
      setResult(await window.mycelia.testLlm())
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="px-5 py-5 max-w-[560px]">
      <PaneIntro>
        文本模型用于三件事：判断 agent 写入的内容值不值得留存、给文档片段补定位说明、
        生成工作纪要。接口协议要和端点匹配 —— 同一个模型常同时提供多种入口，选错只会 404。
      </PaneIntro>

      <PaneSection title="文本模型">
        <div className="flex flex-col gap-3">
          <Field label="接口协议" hint={protocol?.path ? `请求会打到 ${protocol.path}` : undefined}>
            <Select
              value={llm.provider}
              onChange={(provider) => patchSection('llm', { provider })}
              options={PROTOCOLS.map((item) => ({
                value: item.value,
                label: item.label,
                hint: item.path || undefined,
              }))}
            />
          </Field>

          {llm.provider !== 'none' && (
            <>
              <Field label="接口地址" hint="填到版本号为止，不含具体路径">
                <Input
                  value={llm.baseUrl}
                  spellCheck={false}
                  onChange={(event) => patchSection('llm', { baseUrl: event.target.value })}
                  placeholder="https://api.example.com/v1"
                />
              </Field>

              <Field label="API Key" hint={`留空则读环境变量 ${llm.apiKeyEnv}`}>
                <Input
                  type="password"
                  value={llm.apiKey ?? ''}
                  spellCheck={false}
                  onChange={(event) => patchSection('llm', { apiKey: event.target.value })}
                  placeholder="sk-…"
                />
              </Field>

              {/* 两列说明文字行数可能不同，底部对齐才能让输入框齐平 */}
              <div className="grid grid-cols-2 gap-3 items-end">
                <Field label="模型">
                  <Input
                    value={llm.model}
                    spellCheck={false}
                    onChange={(event) => patchSection('llm', { model: event.target.value })}
                  />
                </Field>
                <Field label="轻量模型" hint="给文档片段补说明用，留空复用主模型">
                  <Input
                    value={llm.fastModel ?? ''}
                    spellCheck={false}
                    placeholder="可选"
                    onChange={(event) =>
                      patchSection('llm', { fastModel: event.target.value || undefined })
                    }
                  />
                </Field>
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" onClick={test} disabled={testing}>
                  {testing ? '测试中…' : '测试连接'}
                </Button>
                {result && (
                  <span
                    className={cn(
                      'text-[11.5px] leading-snug',
                      result.ok ? 'text-success' : 'text-danger',
                    )}
                  >
                    {result.message}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </PaneSection>

      <PaneSection title="识图模型" className="mt-6">
        <SettingRow label="启用识图" hint="图片进不了向量空间，靠模型转成描述后才能被搜到">
          <Toggle
            label="启用识图"
            checked={config.vision.enabled}
            onChange={(enabled) => patchSection('vision', { enabled })}
          />
        </SettingRow>

        {config.vision.enabled && (
          <>
            <Field label="模型" hint="留空端点则复用上面主模型的地址与密钥">
              <Input
                value={config.vision.model}
                onChange={(event) => patchSection('vision', { model: event.target.value })}
                placeholder="gpt-4o-mini"
              />
            </Field>

            <Field label="端点" hint="可选。多数供应商的视觉模型走同一个入口">
              <Input
                value={config.vision.baseUrl ?? ''}
                onChange={(event) => patchSection('vision', { baseUrl: event.target.value })}
                placeholder="留空则用主模型的端点"
              />
            </Field>

            <Field
              label="描述详细度"
              hint="截图和图表选详细 —— 界面文字、坐标轴、图例都会被转述出来，这样才搜得到"
            >
              <Select
                value={config.vision.detail}
                onChange={(detail) => patchSection('vision', { detail })}
                options={[
                  { value: 'brief' as const, label: '简要', hint: '一句话' },
                  { value: 'detailed' as const, label: '详细', hint: '含图内文字' },
                ]}
              />
            </Field>
          </>
        )}
        <p className="text-[11px] text-faint leading-relaxed">
          不配也能用：图片照样存、照样显示，只是检索不到里面的内容。
        </p>
      </PaneSection>

      <PaneSection title="嵌入模型" className="mt-6">
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-surface border border-border rounded-[8px]">
          <Icon name="database" size={15} className="text-faint shrink-0" />
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-[12.5px] truncate">{config.embedding.model}</span>
            <span className="text-[11px] text-faint">
              {config.embedding.provider} · {config.embedding.dimensions} 维 · 本地运行
            </span>
          </div>
        </div>
        <p className="text-[11px] text-faint leading-relaxed">
          它决定语义检索的质量，离线可用。换模型后已有向量需要重新生成才会生效。
        </p>
      </PaneSection>
    </div>
  )
}
