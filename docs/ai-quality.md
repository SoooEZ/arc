# ARC 的 AI 编码规范与 Skills

这套配置把项目长期约束和按任务使用的工作方法分开。`AGENTS.md` 记录技术栈、兼容性约束与验证入口；Skills 提供实现、重构和审查时的具体决策方法。它们帮助 AI 保持一致，实际正确性仍由行为测试、构建、自动检查和人工审查共同验证。

## 已整理的配置

| 文件 | 作用 |
| --- | --- |
| [根目录 AGENTS.md](../AGENTS.md) | 项目契约、可读性原则、技能入口、检查范围和代码审查规则 |
| [backend/AGENTS.md](../backend/AGENTS.md) | Java 职责边界、事务、版本、精度、数据源扩展规范 |
| [frontend/AGENTS.md](../frontend/AGENTS.md) | React 状态归属、异步结果、组件组合、图形与代码同步规范 |
| [Review 问题与预防规则](review-lessons.md) | 历次真实问题的触发条件、后续编码规则和回归测试入口 |
| [.agents/skills/arc-java/SKILL.md](../.agents/skills/arc-java/SKILL.md) | 后端实现：定位业务责任、选择已有扩展接口、检查行为契约 |
| [.agents/skills/arc-react/SKILL.md](../.agents/skills/arc-react/SKILL.md) | 前端实现：明确状态与生命周期、处理异步竞争、验证实际交互 |
| [.agents/skills/arc-maintainability/SKILL.md](../.agents/skills/arc-maintainability/SKILL.md) | 重构：识别维护成本、选择最小有用边界、保留行为并说明收益 |
| [.agents/skills/arc-review/SKILL.md](../.agents/skills/arc-review/SKILL.md) | 审查：追踪调用链、给出可复现问题、区分 bug 与可选维护建议 |

规范正文使用英文，便于与现有代码和模块名称对应；可以继续用中文提出需求和接收结果。

## 怎样使用

这些 Skills 放在仓库级 `.agents/skills/`，可随代码一起共享。Codex 按任务描述选择相关技能，也支持用 `$技能名` 明确调用。例如：

```text
使用 $arc-java 添加一个新的数据源类型，沿用现有版本和错误处理约定。

使用 $arc-react 修改参数映射表单，保留未保存草稿并处理过期请求。

使用 $arc-maintainability 重构这个模块，提高可读性和可维护性，保持行为不变。

使用 $arc-review 审查当前 diff，先找真实回归，再给有依据的维护建议。
```

“顺便重构一下”不代表要自动加载全部 Skills。普通 Java 功能用 `arc-java`，结构性调整再结合 `arc-maintainability`；单纯审查用 `arc-review`，不会因此自动修改文件或发布外部评论。

根据 [OpenAI 的 Skills 文档](https://learn.chatgpt.com/docs/build-skills)，仓库级技能可被自动发现；如果当前会话没有显示新技能，可以重启 Codex 后再检查，也可以直接提供对应 `SKILL.md` 路径。[AGENTS.md 文档](https://learn.chatgpt.com/docs/agent-configuration/agents-md) 说明了按工作目录逐级读取的机制。因此根规范明确要求：即使从仓库根目录启动，修改前后端时也应阅读对应子目录规范。

## 它们如何改善代码

| 目标 | 具体要求 | ARC 中的应用 |
| --- | --- | --- |
| 可读性 | 让业务值、决策步骤和副作用清楚；复杂表达式优先拆成有意义的中间值 | 避免在 JSX、嵌套三元表达式或 Stream 链中隐藏规则 |
| 可维护性 | 围绕责任与变化原因拆分；明确权威状态 | 代码/图形共用 document reducer；SQL 留在 persistence |
| 可扩展性 | 优先使用已存在的契约，验证新实现的可替换性 | 数据源通过 `SourceAdapter` 注册，执行器只依赖所需能力 |
| 正确使用模式 | 说明要解决的实际问题与受益调用方 | 有真实提供者差异时使用 Strategy；保持内聚的计算算法完整 |
| 重构可信度 | 先识别外部行为，再验证结果、错误与副作用 | 验证精度、null/default、发布事务、并行分支合并和错误定位 |
| 审查有效性 | 给出位置、触发条件、影响和修复方向 | 将丢失草稿、版本漂移等 bug 与可选命名建议区分 |

SOLID 在这里是一组可检查的设计条件。没有要求每个类都配一个接口、每个节点都建一套继承体系，或为了满足行数阈值拆散内聚算法。也不要求为了套模板更换 MUI、JDBC 或现有错误格式。

## 与自动检查的关系

当前已接入 CI 的检查包括：模块 import 边界、Java 格式和测试、前端格式/类型/单元测试/构建、真实 PostgreSQL 的 HTTP 检查，以及浏览器工作流。运行命令见 [维护指南](maintaining.md#verification) 和 [README](../README.md#development-and-verification)。

现有架构脚本检查声明的 import，不等同于完整依赖分析。上次讨论的 ArchUnit、React Hooks ESLint 是可进一步接入的工具，本次整理没有把它们标记成已安装。Skills 会引用现有真实命令，不提供不存在的 `npm run lint`，也不会把构建成功当成已验证异步行为。

仅修改规范时，检查技能元数据、引用和示例即可；修改运行代码时，按变化范围执行对应测试。会写入数据的集成测试使用独立的 Compose 项目，避免把测试规则写进日常工作数据库。

## 维护这套规则

历次 review 的问题已汇总到 [review-lessons.md](review-lessons.md)，并接入根目录及前后端 `AGENTS.md`。后续实现、重构和审查应先读取受影响部分及其回归测试：例如改异步保存时检查响应归属和新草稿保护，改字符串时检查每层解析器的转义，改计算时检查边界值、错误位置和已发布规则兼容性。文档记录如何避免已知错误，测试负责检测具体回归，两者都不能保证永远不再出现问题。

来源与裁剪说明见 [AI 规则来源](ai-sources.md)。上游使用固定提交链接，升级时应查看具体差异并确认适用性，不自动用远程最新版覆盖本地规则。

遇到实际失败时，补充一条能改变决策的具体约束或测试。定期删除重复、失效和只表达口号的内容。代码路径、接口契约或验证命令改变时，同步更新引用它们的规范；技能会影响后续编码，因此应和代码一样接受 review。
