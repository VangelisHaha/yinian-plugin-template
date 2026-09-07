# AGENTS.md — yinian-plugin-template

[一念（Yinian）](https://github.com/VangelisHaha/nikou-agenda)插件的**官方模板**。它有两个身份：一份能跑的示例插件，和一份给插件作者看的文档。改动时两个身份都要顾。

## 必须遵守

- 中文回复，中文编写文档与注释。
- 改完必须 `npm run verify`（typecheck + doctor + 测试）全绿。
- **零运行时依赖。** `dependencies` 永远是空的，只允许 `devDependencies`（typescript、@types/node）。插件跑在用户机器上，每多一个依赖就多一份供应链风险，而模板的依赖会被所有基于它的插件继承。
- 测试只用 `node:test`，不引测试框架。
- 源码保持 `.mts` 扩展名。改成 `.ts` 会让 tsc 输出 `.js`，那样插件包就必须带 `package.json` 声明 `type: module`，凭空多一个文件和一个出错点。

## 契约的 source of truth 不在这里

| 内容 | 权威位置 |
|---|---|
| manifest、RPC、权限、设置面板、错误码 | 一念仓库 `docs/11-plugin-architecture.md` |
| 市场索引字段 | `yinian-plugins` 仓库 `schema.json` |

`src/sdk/` 只是契约的一个 TypeScript 实现。**契约变了要先改文档，再同步这里**，反过来不行。SDK 当前对应 `PROTOCOL_VERSION = 1`。

同步范围包括：`protocol.mts` 的超时表与方法名规则、`types.mts` 的 DTO 字段、`doctor.mjs` 里那几张枚举白名单（hook topic、sync action / field、调度模式、字段类型、**dayMark kind**）、`mock-host.mjs` 的超时表**与生命周期段落**。这几处任何一处漏改，doctor 就会给出与宿主不一致的判断——那比不检查更糟。

`mock-host.mjs` 不只是超时表要同步：新增扩展点时要给它加一段真实调用并校验返回值形状，否则插件作者本地跑 `npm run mock` 看不到那条链路，只能装进一念才发现问题。

## SDK 的设计约束

`runtime.mts` 替插件作者兜掉四类错误，改它之前先想清楚会不会破坏其中之一：

1. **stdout 只写协议帧**：启动时重定向 `console.*` 到 stderr。这一条不能去掉——插件作者第一次 `console.log` 调试就会撞上 `PLUGIN_CONTRACT_VIOLATION`，而错误信息指向协议层，很难联想到是自己的调试语句。
2. **一行一帧**：统一 `JSON.stringify`。
3. **异常不崩进程**：转成 JSON-RPC error。
4. **handler 串行**：宿主对同一插件本来就是串行调用，但 handler 是 async，不排队会让两个 handler 交叠、共享状态错乱。

## doctor 的定位

它回答的是「这个包装进一念会不会被拒」，不是「代码写得好不好」。所以：

- 只检查契约层面的东西，不做风格检查；
- 警告不影响退出码（间隔低于下限、声明了用不到的权限这类）；
- 错误必须是「真的会让宿主拒绝或让功能静默失效」的问题。

新增检查时同步在 `tests/doctor.test.mjs` 里加一个「造一个有这个问题的包」的用例。只加检查不加测试，下次重构就会把它悄悄改坏。

权限扫描是**启发式**的（正则找 `fetch` / `spawn`），扫不出间接调用。别把它宣传成完备检查。

## mock host 的定位

它模拟真实宿主的行为，让插件作者不装一念也能开发。它必须同时做真实宿主会做的校验：拒绝非 JSON 行、拒绝插件主动发 request、按契约超时表掐时间。少做一样，就会出现「mock 通过但装进一念失败」——那会让人不再信任它。

## AI 工具扩展（0.13.0 契约）

`src/handlers/tools.mts` 通过 SDK `toolHandlers` 注册，定义同时作为发现与执行的唯一来源。
公共 SDK 从官方模板同步；参数 Schema 使用宿主支持的子集。读工具不得写入，写工具必须依赖
宿主注入的稳定 operationId；声明 idempotent 必须真正处理超时后核对，不能只靠内存去重。
绑定工具只返回标准外部数据，关联与本地数据库写入由宿主完成，不新增通用动作绕过确认。
