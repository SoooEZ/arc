# 后端存储与计算探索记录 — 2026-09-25

以下保留实施前的探索记录；用户随后授权处理并要求前后端同步，实施结果追加在文末。

## 探索时的状态与范围

- 基线：`346a638801be5edec4984250fc166da6687553c8`。
- 用户问题：后端存储和计算设计是否存在瓶颈或问题。
- 状态：探索已记录，等待进一步讨论和问题选择；以下改进方向尚未成为实施决定。
- 本轮检查保持只读，没有修改实现、数据库或依赖。本文件仅保存探索结论。
- 证据包括调用链和现有回归测试审查，以及两个无数据库、无网络的临时 Java 内存实验。没有进行并发压测、容量测试或端到端延迟测量。

总体判断：现有 JSONB 版本快照与 DAG 执行设计可以继续使用。已确认的扩展成本主要来自全量读取、重复准备工作、trace 序列化和外部 IO。此次未确认新的算术、分支汇合或版本一致性缺陷；这不代表已证明不存在其他问题。

## 当前设计基线

- 前端保存完整图定义，包括 inputs、nodes、edges 和编辑信息；图通过节点 ID 与边关联。保存和执行协议见 [API](../api.md) 与 [图契约](../architecture.md)。
- `rules.draft` 保存当前草稿 JSONB，`rule_versions.definition` 保存不可变发布快照。发布版本以 `(rule_id, version)` 定位，不需要扫描全部历史。见 [表结构](../../backend/src/main/resources/db/migration/V1__rules.sql)。
- 保存/发布按规则行加锁，检查 revision，并在事务内更新；发布插入快照和更新当前版本指针属于同一事务。见 [RuleService](../../backend/src/main/java/dev/arc/rule/RuleService.java) 的 `update`、`publish`。
- 执行先校验图，再按拓扑顺序处理活动节点。分支控制哪些边生效，汇合节点合并活动上游的 scope；一个到达的 Output 返回单值，多个返回按节点 ID 组织的对象。
- `MemoizingRuleResolver` 已按请求缓存固定规则版本。每次计算的 scope、trace、引用调用状态和数据源读取预算独立；嵌套调用共享相应执行预算。
- 单图限制为 100 个节点、200 条边、50 个输入；另有引用深度、执行步数、源读取次数、表达式和值大小限制。这些限制不等于整体执行时限或累计响应字节限制。

## 已确认的扩展成本

### E1 — 列表和历史接口加载完整文档，未分页

**证据：** [JdbcRuleRepository](../../backend/src/main/java/dev/arc/persistence/JdbcRuleRepository.java) 的 `list`（基线第 36 行）、`versions`（第 91 行）加载并解析所有匹配记录的完整图。[JdbcSourceRepository](../../backend/src/main/java/dev/arc/persistence/JdbcSourceRepository.java) 的列表和历史接口也返回完整配置，没有分页或数量上限。

实际调用者包括 [useRuleLibrary](../../frontend/src/app/useRuleLibrary.ts)、[VersionHistory](../../frontend/src/features/editor/VersionHistory.tsx)、[ReferenceFields](../../frontend/src/features/editor/inspector/ReferenceFields.tsx) 和 [SourceBindingEditor](../../frontend/src/features/sources/SourceBindingEditor.tsx)。版本历史栏只展示版本号和时间，也会加载完整图。

**触发与影响：** 规则数量、历史版本或 lookup 配置增大时，查询、JSON 解码、传输和浏览器占用随所有返回文档总量增长。单次写入请求的 1 MiB 限制不能限制聚合读取量。

**候选方向：** 分页摘要查询，详情按 ID/版本获取。兼容现有响应契约，不直接删除既有字段。

### E2 — 执行已发布规则仍读取当前完整草稿

**证据：** [RuleExecutionService.execute](../../backend/src/main/java/dev/arc/rule/RuleExecutionService.java)（第 45–51 行）无条件调用 `rules.get(id)`，然后再解析目标发布版本；repository 的 Rule mapper 会解码完整 draft。

**触发与影响：** 显式指定版本也会支付当前草稿查询和解码成本。小发布版本搭配大草稿时尤其明显；根规则路径会读取草稿与发布定义两份数据。

**候选方向：** 显式版本直接读取固定快照；缺省版本通过轻量指针查询或 join 获取。保留规则不存在、版本不存在、尚未发布时的 HTTP 语义。

### E3 — 一次计算重复验证、建图和解析表达式

**证据：** [RuleExecutionService.evaluate](../../backend/src/main/java/dev/arc/rule/RuleExecutionService.java) 第 65 行先调用 `definitions.validate`，随后 [GraphExecution.run](../../backend/src/main/java/dev/arc/engine/execution/GraphExecution.java) 第 42 行再调用 `validator.plan`。运行时 [Expressions.evaluate](../../backend/src/main/java/dev/arc/engine/expression/Expressions.java) 会重新编译表达式。

**验证：** 下述内存实验计数显示，每次根图执行调用 `Validator.plan` 两次。已有 `Validator.plan` 确实复用了该次校验内部产生的拓扑；重复发生在应用层校验与执行器调用之间，两者应区分。

**触发与影响：** 重复执行相同图或引用规则时，重复支付规划、静态表达式检查及运行前解析成本。尚未测量这些成本在真实请求总延迟中的占比。

**候选方向：** 优先复用请求内已验证计划与不可变编译表达式。任何后续缓存都必须保留新鲜的执行 scope、表达式预算和图执行状态；全局缓存不是本轮决定。

### E4 — 同一固定数据源配置被重复读取

**证据：** [SourceBindingValidator](../../backend/src/main/java/dev/arc/source/SourceBindingValidator.java) 第 31 行按绑定读取配置；[SourceExecutionService.read](../../backend/src/main/java/dev/arc/source/SourceExecutionService.java) 第 38 行实际取值时再次读取。相同 `(sourceId, version)` 没有请求内配置复用。

**验证：** 两个输入引用同一源版本的内存实验记录了 4 次配置仓库调用和 2 次 provider 读取。这里的仓库是计数替身，不是一次真实数据库性能测量。

**触发与影响：** 多个绑定使用同一源，尤其是包含大量 entries 的 lookup 配置时，会重复查库和解码配置。运行时 50 次源读取预算不能消除前置静态校验中的配置读取。

**候选方向：** 在静态校验与执行之间按固定版本复用不可变配置。外部实时返回值、不同参数的 lookup 结果与配置缓存语义不同，不能顺带缓存。

### E5 — 完整 trace 放大序列化响应

**证据：** [GraphExecution](../../backend/src/main/java/dev/arc/engine/execution/GraphExecution.java) 第 69–78 行把每步完整结果放入 trace；[RuleExecutionService](../../backend/src/main/java/dev/arc/rule/RuleExecutionService.java) 第 67–68 行始终返回 trace。执行有步数限制，没有累计 trace 字节预算。

**验证：** 合法 100 节点线性图传递同一数组时，约 34 KB 的请求产生约 1.05 MB 的序列化响应，具体实验见下表。

**触发与影响：** 数组或对象经过多个节点时，即使最终结果较小，JSON 响应仍重复写出中间值，增加序列化、传输和客户端解析成本。这里证明的是序列化体积，不表示 Java 内存中每个 trace 条目都深拷贝了一份对象。

**候选方向：** 兼容现有调用的 trace 选项与累计体积预算。关闭或截断 trace 时，必须独立保留执行步数限制，不能让当前依赖 trace 长度的预算失效。

### E6 — 外部 IO 串行，缺少整次规则执行时限

**证据：** [Parameters](../../backend/src/main/java/dev/arc/engine/execution/Parameters.java) 第 34 行串行解析输入，第 63–65 行执行源读取。[HttpSource](../../backend/src/main/java/dev/arc/source/http/HttpSource.java) 第 67–89 行每次创建并关闭 HTTP 客户端与连接池。[HttpSourceAdapter](../../backend/src/main/java/dev/arc/source/http/HttpSourceAdapter.java) 允许单次超时 100–10,000 ms。

**触发与影响：** 多个慢源会累积等待时间，连接也无法跨调用复用。已有单次 HTTP 总 deadline、最多 50 次源读取等保护，但没有覆盖整个规则执行的 deadline。次数乘超时只是可能的等待量级推算，本轮没有实际测量该耗时。

**候选方向：** 请求级总时限和受控客户端/连接复用。保留输入依赖顺序、覆盖值、fallback、DNS 目标限制、禁止重试/跳转以及响应大小限制；直接并发所有读取尚未经过语义评估。

## 临时实验记录与限制

| 实验 | 输入和路径 | 观测 |
| --- | --- | --- |
| 规划计数与 trace 大小 | 内存调用 preview；100 节点：INPUT + 98 个传递 `payload` 的 FORMULA + OUTPUT；payload 为 100 个各 100 字符的字符串 | 根图规划 2 次；trace 100 步；序列化完整请求 33,854 B；单独结果 10,301 B；完整响应 1,052,183 B，约为请求 31 倍、结果 102 倍 |
| 相同源配置读取计数 | 两个输入绑定同一 `(sourceId, version)`；计数 repository/provider 替身 | 配置仓库调用 4 次；provider 读取 2 次；根图规划 2 次 |

实验用已有 `backend/target/classes` 和本机 Maven 缓存依赖，通过 Java source-file 模式运行临时 `ExecutionCostProbe.java`。临时目录由 `TemporaryDirectory` 在结束时删除，源码和输出文件未作为仓库 artifact 保留；以上数字来自当时工具输出。复现场景已记录，但它们不是已提交的回归测试或可直接重跑的 benchmark。本次写日志没有重新运行实验。

以上字节数是内存 JSON 序列化结果，不是实际网络流量，也没有测量压缩、JVM 峰值堆占用、数据库耗时、并发吞吐或 p95/p99 延迟。后续若实施优化，应建立持久、可重复的对应检查。

另一个观测限制：[Engine.execute](../../backend/src/main/java/dev/arc/engine/execution/Engine.java) 第 49–53 行的 `durationMicros` 只覆盖引擎调用，排除了初始根规则/版本读取、前置校验和最终响应 JSON 序列化。不能用它单独代表完整 API 延迟。

## 合理取舍与需要保留的保障

整图保存与完整版本快照方便原子更新、版本固定和恢复；代价是提交完整定义，历史空间随版本累计，同一规则的写入通过同一行锁协调。这属于现有模型的取舍，本轮没有证明需要更换数据库、拆分节点表或引入图数据库。

现有保障包括 revision 冲突检查、事务内发布、不可变版本引用、按请求缓存规则定义、活动分支 scope 合并、decimal 算术和嵌套预算。后续修改应保留以下覆盖：

- [RuleServiceTest](../../backend/src/test/java/dev/arc/rule/RuleServiceTest.java)：revision、命令次序、校验失败时不发布。
- [smoke.py](../../scripts/smoke.py) 与 [studio_smoke.py](../../scripts/studio_smoke.py)：真实数据库/API 的版本固定、草稿隔离、并发保存与 source 版本行为。此次只审查相关断言，未重新执行这些脚本；mock 测试不能证明数据库事务正确性。
- [FanOutTest](../../backend/src/test/java/dev/arc/engine/execution/FanOutTest.java)：分支、汇合、多个 Output 与引用错误位置。
- [ExpressionCompatibilityTest](../../backend/src/test/java/dev/arc/engine/expression/ExpressionCompatibilityTest.java)、[MemoizingRuleResolverTest](../../backend/src/test/java/dev/arc/engine/MemoizingRuleResolverTest.java)：表达式语义、重复/并发/重入求值与固定版本缓存边界。
- [ParametersTest](../../backend/src/test/java/dev/arc/engine/execution/ParametersTest.java)、[SourceExecutionServiceTest](../../backend/src/test/java/dev/arc/source/SourceExecutionServiceTest.java)：缺失/null、覆盖、fallback 与固定版本读取。
- [HttpSourceTest](../../backend/src/test/java/dev/arc/source/http/HttpSourceTest.java)、[HttpDestinationPolicyTest](../../backend/src/test/java/dev/arc/source/http/HttpDestinationPolicyTest.java)：HTTP deadline、编码、跳转与目标地址限制。

## 待讨论

当前候选顺序是列表/历史摘要分页、trace 体积控制，再处理执行准备和配置复用；大量依赖外部 HTTP 的场景需要提高整体 deadline 的优先级。这只是探索建议。

选择实施范围前，仍需结合规则数量、版本增长、图/lookup 大小、调用并发、延迟目标，以及生产调用对 trace 的需求。用户将先讨论问题，再决定解决哪些项；本记录不启动任何修复或架构迁移。

## 后续实施 — 2026-09-25

用户确认开始处理，要求前后端一起调整。本轮保留 PostgreSQL JSONB、完整版本快照及图执行语义，落地 E1–E6：

| 项目 | 实施及前后端契约 | 持续验证 |
| --- | --- | --- |
| E1 摘要分页 | 新增规则、源及版本历史的摘要接口；默认每页 20，上限 100，详情按需加载。规则库、侧栏、复用选择、数据源、历史和 API playground 均迁移。旧全量接口保留兼容，不再由页面调用。 | [摘要 HTTP 契约](../../backend/src/test/java/dev/arc/api/CatalogControllerTest.java)、[目录翻页与竞态](../../frontend/tests/catalog-pagination.spec.ts)、[源详情及历史](../../frontend/tests/source-editor.spec.ts)、两个真实 API smoke 脚本 |
| E2 发布执行读取 | 显式版本直接读取快照；缺省版本先查轻量发布指针，不再读取当前草稿。保留不存在、未发布和版本不存在的错误语义。 | [执行服务](../../backend/src/test/java/dev/arc/rule/RuleExecutionServiceTest.java) |
| E3 编译计划复用 | 请求内共用已验证图计划和编译表达式；服务端已发布版本另有有界进程内 LRU，最多 128 项及 8 MiB 估算权重。定义深度冻结，草稿和运行状态不进入共享缓存。仍保留每请求的固定版本定义读取；不声称消除所有数据库查询。 | [计划缓存隔离及淘汰](../../backend/src/test/java/dev/arc/engine/execution/ExecutionPlansTest.java)、既有表达式及图语义测试 |
| E4 源配置复用 | 静态校验和运行时读取共用请求内 `(sourceId, version)` 配置；每次实际 provider 读取仍执行，不缓存外部实时结果。 | [配置与实时值边界](../../backend/src/test/java/dev/arc/source/SourceExecutionServiceTest.java) |
| E5 Trace 与计时 | `trace` 缺省开启，可关闭；保留完整步骤前缀，序列化 trace 数组上限 256 KiB。独立统计执行步数，返回截断标识、字节数和准备/执行/总耗时。前端提供开关、截断提示、部分高亮说明、浏览器往返计时及一致的 cURL。 | [trace 大小与独立预算](../../backend/src/test/java/dev/arc/engine/execution/ExecutionTraceTest.java)、[界面执行生命周期](../../frontend/tests/execution-lifecycle.spec.ts)、[真实大 trace 响应](../../scripts/smoke.py) |
| E6 外部 IO | 复用受控 HTTP 客户端/连接池，保留请求隔离和网络限制。执行/预览新增共享 `timeoutMs`，默认 30,000，范围 100–30,000 ms；前端可选 1/5/10/30 秒。超时返回 504，不被 DEFAULT 或 IFERROR 吞掉；嵌套规则共用时限。 | [真实 HTTP 连接与超时](../../backend/src/test/java/dev/arc/source/http/HttpSourceTest.java)、[源 fallback](../../backend/src/test/java/dev/arc/engine/execution/ParametersTest.java)、[准备阶段停止后续读库](../../backend/src/test/java/dev/arc/rule/RuleExecutionServiceTest.java) |

分页后的异步交互另有 [发布目录回归](../../frontend/tests/execution-catalog.spec.ts)：新版元数据更新、跨页选择、显式历史 pin、翻页保持已知最新版本、重试保留输入，以及运行错误不误导用户重载元数据。

### 验证结果

- Java 21 Maven `verify`：173 项测试通过，Spotless 通过；Docker API 和前端生产构建成功。
- 独立 Compose 项目 `arc-opt-test`，API `8082`、Web `3082`，使用独立 PostgreSQL volume。`scripts/smoke.py` 46 项、`scripts/studio_smoke.py` 32 项 HTTP 检查通过；覆盖真实存储、并发 revision、版本固定、trace 大小及图/代码往返。
- 前端 24 项单元测试、格式检查和架构边界检查通过。Playwright 全套执行 89 项（包含这 24 项单元测试）；最后一次完整运行 88 项通过，余下一项依赖示例规则位于第一页。改为显式搜索并选择示例后，受影响的 `arc.spec.ts` 3 项全部复跑通过，无未解决的失败。此前新增测试的 MUI 下拉框定位歧义也已修正并复跑通过，保留原有行为断言。
- 实际生产前端的桌面/390px 手机截图已检查；修复新增侧栏搜索和分页未随手机侧栏折叠隐藏的问题，手机页面宽度/滚动宽度均为 390px。OpenAPI YAML、65 个本地 schema 引用及 141 个文档本地链接通过静态检查。

### 保留的限制

这轮没有做生产容量或并发延迟压测，不将结构优化等同于已测出的吞吐提升。缓存的 8 MiB 是淘汰估算权重，不是实际 JVM 堆测量。整体时限在处理边界协作检查，并对 HTTP 执行取消；无法硬中断数据库驱动、DNS 阻塞或 JVM 停顿。前端 Request 时间包含响应下载/JSON 解析，服务端计时不包含最终响应序列化和传输。

旧全量接口为兼容保留；外部调用者需要主动迁移摘要接口才获得读取收益。offset 分页采用稳定排序，但多次请求不是并发修改期间的冻结快照。输入仍按既有依赖顺序解析，未引入外部 IO 并发、工作流引擎或图数据库。
