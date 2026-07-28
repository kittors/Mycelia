import { createLogger, modelCacheDir, ProviderError } from '@mycelia/shared'
import { BaseEmbedder, prepareText } from './types.js'

const log = createLogger('embed:local')

/**
 * transformers.js 的最小接口。
 * 刻意不 import 它的真实类型 —— 那会让「没装这个包」变成编译错误，
 * 而可选依赖的全部意义就是允许它不存在。
 */
interface TransformersModule {
  env: { cacheDir: string; allowRemoteModels: boolean }
  pipeline(
    task: string,
    model: string,
    opts?: Record<string, unknown>,
  ): Promise<
    (
      texts: string[],
      opts: Record<string, unknown>,
    ) => Promise<{ data: Float32Array; dims: number[] }>
  >
}

/** 动态 specifier 绕过静态解析，包不存在时只在运行时抛错 */
async function importTransformers(): Promise<TransformersModule> {
  const name = '@huggingface/transformers'
  return (await import(/* @vite-ignore */ name)) as unknown as TransformersModule
}

/**
 * 本地 ONNX 嵌入模型（transformers.js）。
 *
 * @huggingface/transformers 是**可选依赖** —— 它连带 onnxruntime-node 有 200MB+，
 * 强制安装会让 `pnpm install` 变成灾难，也会拖累 Electron 安装包体积。
 * 用户想要真语义检索时，在设置页点一下「启用本地模型」再装。
 *
 * 默认模型 multilingual-e5-small：384 维、118MB、中英文都不错，
 * 是「效果 / 体积」这条曲线上最划算的一点。
 */
export class LocalEmbedder extends BaseEmbedder {
  readonly kind = 'local' as const
  readonly id: string
  readonly dimensions: number
  private readonly modelName: string
  private pipeline: unknown = null
  private loading: Promise<unknown> | null = null

  constructor(modelName = 'Xenova/multilingual-e5-small', dimensions = 384) {
    super()
    this.modelName = modelName
    this.dimensions = dimensions
    this.id = `local:${modelName}`
  }

  /** 依赖是否已安装 —— 设置页据此显示「已就绪 / 需要安装」 */
  static async isAvailable(): Promise<boolean> {
    try {
      await importTransformers()
      return true
    } catch {
      return false
    }
  }

  private async ensureLoaded(): Promise<
    (
      texts: string[],
      opts: Record<string, unknown>,
    ) => Promise<{ data: Float32Array; dims: number[] }>
  > {
    if (this.pipeline) return this.pipeline as never
    if (!this.loading) {
      this.loading = this.loadPipeline()
    }
    this.pipeline = await this.loading
    return this.pipeline as never
  }

  private async loadPipeline(): Promise<unknown> {
    let mod: TransformersModule
    try {
      mod = await importTransformers()
    } catch {
      throw new ProviderError(
        'local-embedding',
        '未安装本地嵌入模型依赖。请运行：pnpm add -w @huggingface/transformers，或在设置里改用 API / 内置哈希嵌入',
      )
    }

    // 模型缓存放进应用数据目录，避免污染用户主目录
    mod.env.cacheDir = modelCacheDir()
    mod.env.allowRemoteModels = true

    log.info(`正在加载本地嵌入模型 ${this.modelName}（首次会下载约 120MB）`)
    const t0 = Date.now()
    const pipe = await mod.pipeline('feature-extraction', this.modelName, { dtype: 'q8' })
    log.info(`模型加载完成，耗时 ${Date.now() - t0}ms`)
    return pipe
  }

  async embed(texts: readonly string[]): Promise<Float32Array[]> {
    const pipe = await this.ensureLoaded()
    const out: Float32Array[] = []

    // e5 系列要求给检索文本加 "query: " / "passage: " 前缀，这里统一用 passage
    const prepared = texts.map((t) =>
      this.modelName.includes('e5') ? `passage: ${prepareText(t)}` : prepareText(t),
    )

    // 逐条推理：批量在 onnxruntime-node 上收益有限，还会放大峰值内存
    for (const text of prepared) {
      const result = await pipe([text], { pooling: 'mean', normalize: true })
      const dim = result.dims.at(-1) ?? this.dimensions
      out.push(Float32Array.from(result.data.slice(0, dim)))
    }
    return out
  }

  async dispose(): Promise<void> {
    const pipe = this.pipeline as { dispose?: () => Promise<void> } | null
    await pipe?.dispose?.()
    this.pipeline = null
    this.loading = null
  }
}
