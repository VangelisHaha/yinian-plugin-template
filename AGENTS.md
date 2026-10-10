# AGENTS.md — yinian-plugin-template

[安时（Nuncta）](https://github.com/VangelisHaha/nikou-agenda)插件官方模板：一份能跑的示例插件，也是写给插件作者的文档。

- 中文回复，中文注释与文档。改完必须 `npm run verify`（typecheck + doctor + 测试）全绿。
- **零运行时依赖**，`dependencies` 永远为空；测试只用 `node:test`；源码保持 `.mts` 扩展名。
- 契约以安时主仓库《插件架构》文档为准，**契约变了先改文档再同步这里**；SDK 当前对应 `PROTOCOL_VERSION = 1`。
- 同步范围：`protocol.mts` 超时表与方法名规则、`types.mts` DTO、`doctor.mjs` 枚举白名单、`mock-host.mjs` 超时表与生命周期；漏一处 doctor 就会与宿主判断不一致。新增扩展点要给 mock host 加一段真实调用并校验返回形状。
- `runtime.mts` 兜底四类错误，不要破坏：stdout 只写协议帧（`console.*` 重定向 stderr）、一行一帧、异常不崩进程、handler 串行。
- `doctor` 只回答「装进安时会不会被拒」，不做风格检查；警告不影响退出码；新增检查必须同时在 `tests/doctor.test.mjs` 加用例。
- mock host 必须同时做真实宿主会做的校验，否则会出现「mock 通过但装进安时失败」。
- AI 工具：`src/handlers/tools.mts` 经 `toolHandlers` 注册，读工具不得写入，写工具依赖宿主注入的稳定 operationId。
