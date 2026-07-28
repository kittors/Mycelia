import { Segmented, SettingRow } from '../../shared/ui/index.js'
import { type ThemeMode, useApp } from '../../store/app-store.js'
import { PaneSection } from '../components.js'
import { useLiveConfig } from '../useLiveConfig.js'

export function AppearancePane() {
  const { config, patch } = useLiveConfig()
  const setTheme = useApp((s) => s.setTheme)

  if (!config) return <div className="px-5 py-5 text-[12px] text-faint">加载中…</div>

  return (
    <div className="px-5 py-5 max-w-[560px]">
      <PaneSection title="主题">
        <div className="border border-border rounded-[10px] px-3">
          <SettingRow label="配色" hint="跟随系统时会随系统深浅自动切换">
            <Segmented<ThemeMode>
              value={config.theme}
              onChange={(theme) => {
                patch({ theme })
                // 立即预览，不必等保存 —— 主题是所见即所得的设置
                setTheme(theme)
              }}
              options={[
                { value: 'system', label: '跟随系统' },
                { value: 'light', label: '浅色' },
                { value: 'dark', label: '深色' },
              ]}
            />
          </SettingRow>
        </div>
      </PaneSection>
    </div>
  )
}
