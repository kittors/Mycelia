<div align="center">

<img src="apps/desktop/build/icon.png" width="96" alt="Mycelia" />

# Mycelia

**换工具、换模型，记忆不归零。**

给 AI coding agent 的长期记忆层 —— 本地优先，跨工具共享。

[![License](https://img.shields.io/badge/license-MIT-000?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-000?style=flat-square)](#安装)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-000?style=flat-square)](https://modelcontextprotocol.io)

</div>

---

## 它解决什么

你花了一小时向 Claude Code 解释清楚项目的部署流程、踩过的坑、为什么选了这个方案。

明天换到 Codex，一切从头再来。

这不是某个工具的缺陷，是整个生态的结构性问题：**上下文属于会话，而不是属于你**。会话结束，理解就蒸发了。换模型、换工具、开新窗口，都是一次归零。

Mycelia 把这层记忆从会话里拿出来，放进你自己的机器：

- **agent 自己判断什么值得记** —— 通过 MCP 接入后，agent 在对话中把结论性的东西写回来。不是录音机，不是什么都往里塞
- **按需检索，而不是灌满上下文** —— 需要时才取相关的几条，token 花在刀刃上
- **跨工具共享** —— Claude Code 记下的，Codex 下次就能读到

```
┌─────────────┐  ┌─────────┐  ┌──────────┐  ┌────┐
│ Claude Code │  │  Codex  │  │ opencode │  │ pi │
└──────┬──────┘  └────┬────┘  └────┬─────┘  └─┬──┘
       └──────────────┴────────────┴──────────┘
                        │  MCP
                 ┌──────▼──────┐
                 │   Mycelia   │  ← 你的机器，你的数据
                 └─────────────┘
```

## 三层知识库

不同形态的知识需要不同的组织方式，硬塞进一种结构必然有一头受委屈。

| | 存什么 | 怎么找 |
|---|---|---|
| **记忆库** | 结论、决策、偏好、踩坑记录 | 全文检索 + 向量语义 + 重要度排序 |
| **文档库** | 成篇的材料，挂载目录或手写 | RAG：结构化分块 → 向量召回 → 原文扩展 |
| **知识图谱** | 记忆之间的关联 | 社区发现，看结构而非看列表 |

## 特性

**记忆不该被污染**

写入前有四道闸：价值判断（这条脱离上下文还成立吗）、重复检测（向量粗筛 + 模型确认）、时效判断、敏感度分级。低置信度的进待确认队列，你说了算。

**长文不该被切碎**

按文档结构切分而非固定长度，代码块、表格、列表作为原子单元不拆开；每块附带层级路径与文档摘要一起向量化（内容本身保持干净）；命中后向上扩展到完整段落再交给 agent。

**知识图谱是能读懂的**

力导向 + LinLog 能量模型让社区自然分离，而不是糊成一团毛球。防重叠保证间距均匀，拖拽时相连节点跟随移动，坐标持久化——同一份数据每次打开位置一致，方位感才建立得起来。

**凭据不该明文躺着**

AES-256-GCM 加密，密钥经系统钥匙串封装。写入时自动识别 API key、私钥、连接串并强制加密。

**离线可用**

嵌入模型跑在本地（`multilingual-e5-small`，384 维）。不配任何云端 API 也能完整使用——LLM 只影响长文入库的上下文增强这类锦上添花的环节。

## 安装

需要 Node.js 20+ 和 pnpm。

```bash
git clone https://github.com/kittors/Mycelia.git
cd Mycelia
pnpm install
pnpm build
pnpm desktop:dev
```

打包桌面应用：

```bash
pnpm --filter @mycelia/desktop package:mac    # 或 package:win / package:linux
```

## 接入 agent

打开应用 → 设置 → Agent 接入，会自动检测本机已安装的 agent 并一键写入配置。

也可以手动接：

```jsonc
// Claude Code: ~/.claude/settings.json
{
  "mcpServers": {
    "mycelia": {
      "command": "npx",
      "args": ["-y", "@mycelia/mcp-server"]
    }
  }
}
```

agent 侧会拿到这些工具：

| 工具 | 用途 |
|---|---|
| `remember` | 写入一条长期记忆 |
| `recall` | 按语义检索相关记忆 |
| `search_docs` | 在文档库里检索原文片段 |
| `forget` | 标记失效 |

## 可选：配置文本模型

不配也能用。配了之后，长文入库时会做上下文增强、去重时会有模型二次确认。

```bash
export MYCELIA_LLM_BASE_URL="https://api.openai.com/v1"   # 兼容 OpenAI 协议的任意端点
export MYCELIA_LLM_API_KEY="sk-..."
export MYCELIA_LLM_MODEL="gpt-4o-mini"
```

也可以在应用的设置页里配，支持 Anthropic Messages、OpenAI Chat、OpenAI Responses、Ollama 四种协议。

## 技术栈

```
apps/desktop      Electron + React 19 + Tailwind v4
services/mcp      MCP stdio server
packages/core     提取管线、检索、图谱、RAG
packages/store    SQLite (WAL / FTS5 trigram) + 向量索引
packages/embed    transformers.js 本地嵌入
packages/crypto   AES-256-GCM 保险箱
```

数据全部在本地：`~/Library/Application Support/Mycelia`（macOS）。没有账号，没有同步，没有遥测。

## 开发

```bash
pnpm build          # 全量构建
pnpm test           # 跑测试
pnpm lint           # Biome 检查
pnpm desktop:dev    # 桌面端热更新
```

约定：单文件不超过 300 行；注释解释**为什么**而不是复述代码。

## License

MIT © [kittors](https://github.com/kittors)
