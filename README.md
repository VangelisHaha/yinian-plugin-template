# yinian-plugin-template

[一念（Yinian）](https://github.com/VangelisHaha/nikou-agenda)插件的官方模板。七个扩展点各一个能跑通的示例，外加一个不装一念也能开发的模拟宿主。

```bash
npm install
npm run verify   # typecheck + doctor + 测试（含 mock host 端到端）
```

`npm run verify` 全绿说明这个包装进一念不会被拒。

## 从模板到你的插件

1. 改 `yinian-plugin.json`：`id`（会成为安装目录名，`^[a-z0-9][a-z0-9-]{1,62}$`）、`name`、`author`、`description`、`homepage`。
2. 只留你真正实现的扩展点。`contributes` 里声明了什么，宿主就只调什么——声明多了会被 `doctor` 拦下来。
3. 按需要改 `permissions`。**声明什么，安装界面就把什么摊给用户看**；一期没有沙箱，所以少声明不会被拦住，但那等于骗用户。`doctor` 会扫源码里的 `fetch` / `spawn` 帮你对一遍。
4. 改 `src/handlers/` 下的示例，把假数据换成真实 API。
5. 改 `settings.plugin.json` / `settings.integration.json`。凭据这类跟账号绑定的放**实例级**，一份代码共享的放插件级。
6. `npm run verify`，然后 `npm run mock -- --verbose` 看一遍完整的帧交互。

## 目录

```
yinian-plugin.json          # manifest，必须在包根目录
settings.plugin.json        # 插件级设置面板（可选）
settings.integration.json   # 实例级设置面板（可选）
src/
├── main.mts                # 入口：方法名 → handler 的映射，别在这写业务
├── sdk/                    # 薄 SDK，不用改
│   ├── protocol.mts        # 协议层类型 + 超时表 + 方法名规则
│   ├── types.mts           # 扩展点 DTO（字段名就是线格式）
│   └── runtime.mts         # RPC 循环、host.log / progress / setState
└── handlers/               # 你要改的部分
    ├── sync.mts            # sync.pull / sync.push
    ├── hooks.mts           # hook.dispatch（含幂等示例）
    ├── notify.mts          # notify.send
    ├── dayMarks.mts        # dayMarks.list
    └── config.mts          # config.validate + action + optionsFrom
scripts/
├── doctor.mjs              # 契约自检
└── mock-host.mjs           # 模拟宿主，走完整生命周期
dist/main.mjs               # 构建产物，manifest 的 entry 指向它
```

源码用 `.mts` 是有原因的：`tsc` 会把它编译成 `.mjs`，于是插件包**不需要带 `package.json`**——只要 manifest 加 `dist/` 就能跑。

## SDK 替你处理掉的四件事

| 问题 | SDK 的做法 |
|---|---|
| `console.log` 污染协议流 | 启动时把 `console.*` 重定向到 stderr。你照常用它调试，宿主会把 stderr 收进插件日志 |
| 响应里的换行把帧拆两半 | 统一 `JSON.stringify` 单行输出 |
| handler 抛异常导致进程崩 | 转成 JSON-RPC error 响应，进程继续活着 |
| async handler 交叠执行 | 按收到顺序排队，同一时刻只跑一个 |

**唯一的硬规则：stdout 只准写协议帧。** 违反会被记 `PLUGIN_CONTRACT_VIOLATION`。

## 七个扩展点

### 同步（`sync.pull` / `sync.push`）

- **插件不写库。** 返回数据就够了，冲突判定、去重、落库全在一念核心。你也拿不到本地任务状态，这是故意的。
- 分页靠游标：`hasMore: true` 时宿主带着你给的 `cursor` 再调一次，最多 20 轮。
- `completedAt` **不知道就别传**。传当前时间会让历史任务全堆在同一秒。
- `remoteUpdatedAt` 尽量给，宿主的字段级冲突判定靠它。
- `sync.push` 返回 `applied: false` 表示「外部本来就是目标状态」，宿主视为成功且不重试。
- 你在 `capabilities.actions` 里没声明的动作宿主不会下发；`delete` 不支持时它会自动降级成 `cancel` 或 `complete`。

### 生命周期钩子（`hook.dispatch`）

投递保证是**至少一次**。同一条事件会因为宿主重启、上次投递超时、断路器恢复而重来，所以**必须按 `outboxId` 幂等**，并且把去重集合存进 `host.setState` —— 只放内存的话进程一重启就全忘了，用户会看到重复的外部动作。

重复投递时返回 `{ ok: true }`，不要报错——报错只会让宿主白白重试。

### 通知渠道（`notify.send`）

**通知不重试。** 半小时后重投一条「任务即将到期」是噪声不是补救，所以失败就返回 `delivered: false` 加原因，不要自己排重试队列。

只有 manifest 里 `supportsActions: true` 的渠道才会收到 `actions`。

### 日期标记（`dayMarks.list`）

农历、二十四节气、传统与公历节日、法定假日与调休上班。它**不进一念的数据库、永不参与同步**——给定日期就能算出来或查出来。

- **这个调用在 UI 路径上**，超时只有 **8 秒**（其他扩展点是 30–120 秒）：用户翻一页月视图就等着它。**不要在这里发网络请求**，要联网刷数据就在自己的后台节奏里刷、写进 `dataDir`，`list` 只读本地缓存。
- **失败不重试、不计入断路器。** 标记是装饰性显示，丢一条只是这一屏少个农历，重试只会让翻月卡住。所以宁可返回 `{ marks: [] }`，也不要卡住或抛异常。
- `date` 必须是**严格** `YYYY-MM-DD`。`2026-8-1` 会被拒——它当 Map key 时和 `2026-08-01` 对不上，界面表现为「有几天没有农历」而且不报错。
- `label` 要短（**2–3 字**）。那一格宽度只有 100 出头像素，还要和日期数字、休班角标、负载数字挤在同一行，长了会被省略号截掉。长文案放 `detail`。
- `kind: "holiday"` **必须给 `rest`**（`off` / `work`）。周末也可能是调休上班日，这正是它必须被显示出来的原因。
- **同一天可以给多条**（清明既是节气又是节日又是假期）。宿主按 `节气 → 节日 → 法定假日 → 农历` 排序、界面只取第一条开关打开的，你不需要自己判优先级。
- **`coversUntil` 的两种语义**：留空表示「算得出来」（农历、节气任意年份都有）；有值表示「数据只到那天」（放假安排是按年公布的），超出的日子宿主会提示「安排尚未公布」。把「查不到」当成「那天不放假」会让用户照着一张错的日历排期。
- 同一天同一 kind 有多个来源时，**插件总是覆盖系统插件**——所以你的插件可以替掉一念随包分发的那份节假日数据。

### 日历叠加层（`calendarOverlay.list`）

把**外部系统里属于这个用户的信息**贴到日历上：格子右上角的角标（考勤的「班」「加」「假」）、视图右上角的汇总条、日历侧栏底部那张「负载」卡里的几行统计。同样**不进一念的数据库、永不参与同步、也不开放给 Agent 读**。

它和日期标记很像，但**分野是「这条信息属于谁」**，别把两者搞混：

| | `dayMarks` | `calendarOverlay` |
|---|---|---|
| 数据归属 | 谁算都一样（农历、节气、法定假） | **属于这个用户**（我的打卡、我的请假） |
| 需要账号 | 不需要 | 需要外部凭据 |
| 装上即生效 | 是 | **否，用户要在日历侧栏逐个打开** |

- **默认关闭，关着的时候宿主根本不会调这个方法。** 所以**在收到第一次 `calendarOverlay.list` 之前，不要去拉用户的个人数据**——那一刻之前你无从判断他同意了没有。理由：拉一次要拿着他的凭据访问外部系统，「拉」本身就是需要授权的行为，做完再决定显不显示已经晚了。
- **不要在 manifest 里写 `enabled`。** 启用态一律由宿主按用户偏好盖写，自称无效。
- `description` 要写清**会显示什么、数据从哪来**：这个 provider 默认关着，用户在侧栏看到的就是「名字 + 这一句」，他要据此把外部账号的个人数据交出来。
- 超时 **8 秒**、失败不重试、不计入断路器，**不要在这里发网络请求**——理由同 `dayMarks.list`。
- **两个区间通常不相等**：`from`/`to` 是看得见的全部格子（月视图 42 天，含上下月边缘），角标按它给；`summaryFrom`/`summaryTo` 是汇总口径（月视图当月首尾）。拿 42 天算「本月出勤」会多算六七天，**而界面上完全看不出错**。
- **文案 100% 归你，包括翻译**，所以宿主把界面语言下发给你（`locale`）——它不认识「出勤」这个词，也就无从翻译。认不出这个值时按自己的默认语言输出，不要报错。
- **颜色与字体归宿主**：`tone` 是语义档位（`neutral` / `strong` / `mute` / `alert`）而不是色值。`alert` 只能用在汇总与侧栏（角标在格子里，强调色会和「今天」「高优先级」抢注意力），而且**必须给 `detail`**——只把数字标红不说为什么，用户不知道该做什么。
- `value` 是**已格式化的字符串**，宿主不做算术：它不知道 `16.5` 该显示成 `16.5d` 还是 `16.5 天`。也因此**「这一项是零」要用 `tone: "mute"` 说**，`"0d"` / `"—"` 宿主都只当普通文本。
- `mark` 是**封闭的一小组形状**（`none` / `bar` / `dot`），不是图标位，且只在 `sidebarStat` 上生效。一念的形状是语义载体（虚线块专指排期块、圆勾圈专指任务），塞一个进来用户会去日历上找它对应什么。
- 上限：一天最多 2 个角标（同一 provider 同一天只取第一条）、汇总 6 项、侧栏 4 项，角标文字 4 字符截断。
- **同一个指标不要在汇总和侧栏都给**：那是同一句话说两遍，两处数字万一不一致，用户只会觉得其中一个是错的。

### 设置面板（`config.validate` + `action`）

宿主先按 schema 校验形状（必填、类型、范围），过了才调 `config.validate` 让你做**语义**校验（凭据对不对、账号有没有权限）。所以别重复检查必填。

校验失败要带 `field`，它会被精确定位到面板上的那一格；只给整体 message 的话用户只看到一句「配置无效」。

`action` 的返回值：

```ts
{ message?: string; openUrl?: string; patch?: Record<string, unknown> }
```

`openUrl` 由宿主用系统浏览器打开，只接受 http/https。**这是 OAuth 类插件把授权链接递给用户的唯一方式**——插件画不了界面。

**不要在 action 里长轮询**：它只有 15 秒超时，而且启用前的临时进程会被回收，后台任务活不下来。要等就等在 `config.validate`（30 秒）里。

## 超时

| 方法 | 超时 |
|---|---|
| `plugin.init` / `config.validate` | 30s |
| `config.schema` / 自定义方法 | 15s |
| `sync.pull` / `sync.push` | 120s |
| `hook.dispatch` / `notify.send` | 30s |
| `dayMarks.list` | **8s**，且失败不重试（在 UI 路径上） |
| `plugin.shutdown` | 5s，超了 SIGKILL |

超时即失败，宿主会杀掉当前调用（`sync.*` 会连带重启进程，避免半截状态）。失败按 `1s → 2s → 4s → 8s → 16s` 退避重试，上限 5 次；连续 5 次失败打开断路器，冷却 5 分钟。

**同一插件的调用是串行的**，不要假设 `sync.pull` 和 `hook.dispatch` 会并发进来。

## 常见错误码

按 `code` 分支判断，**不要匹配 message 文案**——文案会随 i18n 变。

| 码 | 什么意思 | 通常怎么办 |
|---|---|---|
| `MANIFEST_INVALID` | manifest 字段不合法 | 跑 `npm run doctor` |
| `MANIFEST_INCOMPATIBLE` | 要求的宿主版本比用户装的新 | 降 `minHostVersion` 或让用户升级 |
| `PLUGIN_RUNTIME_MISSING` | 本机 `node` 不满足 `runtime.node` | 放宽版本要求 |
| `PLUGIN_SPAWN_FAILED` | 进程起不来 | 检查 entry 路径与文件权限 |
| `PLUGIN_RPC_TIMEOUT` | 某次调用超时 | 看上面的超时表，拆小或改成分页 |
| `PLUGIN_RPC_CRASH` | 调用期间进程退出 | 崩溃前最后 20 行 stderr 会附在诊断里 |
| `PLUGIN_CONTRACT_VIOLATION` | 返回值缺字段、往 stdout 写了非协议行、主动发 request | 最常见是忘删的 `console.log`（SDK 已帮你重定向） |
| `PLUGIN_PERMISSION_DENIED` | 调了未声明 scope 的回环 API | 在 `permissions.api` 里补声明 |
| `PLUGIN_CONFIG_INVALID` | `config.validate` 没通过 | 这是你自己返回的 |
| `PLUGIN_BREAKER_OPEN` | 断路器熔断中 | 等冷却，或在诊断面板手动重置 |
| `PLUGIN_TAMPERED` | 安装后文件被改过 | 重装 |

同步诊断码不是错误，是关联状态：`SYNC_CONFLICT`（等人工决定）、`SYNC_REMOTE_DELETED`（外部消失，本地保留）、`SYNC_POSSIBLE_DUPLICATE`、`SYNC_PUSH_UNSUPPORTED`（能力不足且无法降级）。

## 调试

```bash
npm run mock -- --verbose   # 打印每一帧收发
```

装进一念之后：设置 → 插件 → 开发者模式 → 从目录加载，然后用插件卡片上的「查看日志」看带 `traceId` 的结构化日志。`traceId` 能把一次操作贯穿宿主与插件两侧。

## 发布

1. `npm run verify` 全绿。
2. 打一个 zip，**解压后顶层就是包结构**（不要多包一层目录），至少包含 `yinian-plugin.json`、`dist/`、用到的 `settings.*.json`、`README.md`。
3. 建 GitHub Release，**tag 必须与 manifest 的 `version` 完全一致**，把 zip 作为资产上传。
4. 想进插件市场就往 [yinian-plugins](https://github.com/VangelisHaha/yinian-plugins) 提一条索引记录。

## 契约

完整契约在一念仓库的 [`docs/11-plugin-architecture.md`](https://github.com/VangelisHaha/nikou-agenda/blob/main/docs/11-plugin-architecture.md)，**那是 source of truth**。本模板的 SDK 对应 `PROTOCOL_VERSION = 1`，与文档不一致时以文档为准。

## AI 工具：自定义插件接入指南

`agentTools` 是通用扩展点。一念只根据声明发现和调用工具，不需要在宿主登记插件名称。
协议借鉴 MCP 的工具描述与结果，复用一念 JSON-RPC，不是完整 MCP Server。
工具只供一念 AI 对话面板使用；表单 Tab、外部 Agent HTTP API 和 CLI 不会调用。

### 从 Demo 到自己的工具

1. 在 manifest 加 `contributes.agentTools: { "scope": "plugin" }`；需要同步实例配置或绑定
   本地 Task/Event 时使用 `integration`。仅提供工具时可以移除其他扩展点，最低宿主版本为 0.13.0。
2. 参考 `src/handlers/tools.mts`，定义 `ToolDefinition`，填名称、中文说明、读写类型和参数
   Schema；字段填 `title`，确认卡会按它显示中文名称。定义中的 `execute` 实现自己的 API。
3. 用 `toolHandlers(definitions)` 注册到 `start({ handlers: { ...tools } })`。目录和调用共用
   一份定义，SDK 自动处理 `tools.list`、名称查找、参数校验与结果大小校验。
4. 从 request.config 取宿主合并的配置，从 request.integrationId 取目标实例；凭据不放进
   arguments、工具说明、日志和返回值。不要自己读取一念数据库。
5. 执行 `npm run verify`，再执行 `npm run mock -- --verbose` 查看帧交互。安装打好的 zip 后，
   启用插件和所需实例，在一念 AI 面板输入需求进行验收。Agent 设置可以单独关闭插件的 AI 使用。

### 三类工具

| 类型 | Demo | 宿主行为 |
|---|---|---|
| 只读 | `list_schedule` | 直接调用，真实结果回喂给模型 |
| 仅外部写入 | `create_note` | 展示参数，用户确认后执行；不创建本地实体 |
| 本地创建并同步 | `create_task` / `create_event` | 确认后先保存本地事项，再执行插件并关联远端身份 |

示例全用假数据，外部备忘与创建回执保存在插件自己的 dataDir，不需要真实账号。
实现邮件排期时，可先提供 `search_mail_schedule` 只读工具；需要创建日程时再提供声明
`binding: "event"` 的写工具，复用 `eventItemSchema` 和标准 `ExternalEvent` / `ExternalCalendar` 返回值。
一念核心不需要为邮件插件再加分支。

### 参数与结果

- 使用 `ToolSchema` 的明确子集：object/array/string/number/integer/boolean/null、properties、
  required、additionalProperties、items、enum、数值与长度上下限、title/description。
  根为 object，最多 8 层，不支持 $ref/组合；不支持的关键字直接拒绝。
- `textResult(给人看的说明, 结构化数据)` 生成标准返回值。业务失败返回 `isError: true`，
  不要用空数组伪装失败。网络结果不明应抛错，让宿主显示“远端结果待核对”。
- 目录最多 32 个工具；工具结果最大 64 KiB。大列表提供 limit/offset 或游标；返回来源与
  查询时间。不要返回整个远端账号或全量原始响应。
- 目录调用超时 15 秒，工具调用 120 秒，一轮最多 8 次。每个 execute 必须有网络超时，
  超时不能吞掉。工具结果只是数据，不能要求模型忽略用户指令。
- binding 工具的 `arguments.item` 为本地创建内容，远端目标放在外层参数；Event 的本地
  calendarId 由宿主选择。成功返回标准 binding，保留远端稳定 ID，不能用标题当身份。

### 写入、幂等与恢复

用户的确认由一念持有，写调用携带 operationId；SDK 拒绝缺少该字段的写调用。
`withToolReceipt` 持久化成功回执，重启后相同操作直接返回回执，换参数则拒绝。
**它不能单独保证网络调用幂等**：如果远端成功但响应丢失，execute 必须用服务端幂等键、
稳定资源地址或先查询再恢复。只有满足这点才声明 `idempotent: true`。
不保证幂等的写入遇到不确定结果时，宿主会停止直接重试，要求核对远端。

本地写入成功、远端失败时本地事项保留；再次尝试只执行远端步骤。已经取得回执时只恢复
关联，不再创建远端数据。配置、工具声明或待同步事项变化后，旧草案不能继续提交。

运行 Demo 不需要真实凭据：API Token 留空，服务地址保持默认，实例选择模拟项目即可。
工具的模拟数据只写插件 dataDir；请勿把真实账号密钥填入 Demo。
