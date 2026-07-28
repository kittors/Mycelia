import { useAsync } from '../../shared/hooks/useAsync.js'
import { formatBytes, relativeTime } from '../../shared/lib/format.js'
import { Button, Icon, SkeletonText } from '../../shared/ui/index.js'
import { Drawer } from '../../shared/ui/Overlay.js'

/**
 * 文档原文阅读。
 *
 * 展示的是索引后重新拼接的正文，不是重新读磁盘 —— 这样能保证
 * 用户看到的和 agent 检索到的是同一份内容。要看最新的就去编辑器里开。
 */
export function DocumentReader({
  documentId,
  onClose,
  onEdit,
}: {
  documentId: string
  onClose: () => void
  /** 手记可编辑；挂载目录里的文件以磁盘为准，只读 */
  onEdit?: () => void
}) {
  const { data, loading } = useAsync(() => window.mycelia.readDocument(documentId), [documentId])

  const document = data?.document
  // 手记存在伪路径下，磁盘上没有对应文件
  const isNote = document?.absPath.startsWith('mycelia://') ?? false

  return (
    <Drawer
      width={560}
      title={document?.title || '文档'}
      description={document?.relPath}
      onClose={onClose}
      footer={
        document && (
          <>
            <span className="flex-1 text-[10.5px] text-faint tabular">
              {document.chunkCount} 个片段 · {formatBytes(document.sizeBytes)} · 索引于{' '}
              {relativeTime(document.indexedAt)}
            </span>
            {/*
              手记存在 mycelia:// 这个伪路径下，磁盘上根本没有对应文件 ——
              对它调 openPath 只会静默失败。手记该走编辑，文件才该走「打开」。
            */}
            {isNote ? (
              <Button size="sm" icon={<Icon name="edit" size={13} />} onClick={() => onEdit?.()}>
                编辑
              </Button>
            ) : (
              <Button
                size="sm"
                icon={<Icon name="external" size={13} />}
                onClick={() => void window.mycelia.openPath(document.absPath)}
              >
                打开原文件
              </Button>
            )}
          </>
        )
      }
    >
      <div className="px-5 py-4">
        {loading && (
          <div className="animate-fade-in">
            <SkeletonText lines={14} />
          </div>
        )}

        {!loading && !data && (
          <p className="text-[12.5px] text-faint">这份文档已经不在索引里了。</p>
        )}

        {data && (
          <article
            className="text-[13px] leading-[1.75] whitespace-pre-wrap break-words"
            data-selectable
          >
            {data.text}
          </article>
        )}
      </div>
    </Drawer>
  )
}
