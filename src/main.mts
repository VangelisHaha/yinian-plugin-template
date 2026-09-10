import { handlers as tools } from "./handlers/tools.mjs";
/**
 * 插件入口。
 *
 * manifest 的 `runtime.entry` 指向编译产物 `dist/main.mjs`。
 *
 * 这个文件只做一件事：把方法名映射到 handler。别在这里写业务逻辑，
 * 也别在模块顶层做网络请求——模块加载发生在 `plugin.init` 之前，那时你还没有配置。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { start } from "./sdk/index.mjs";
import * as calendarOverlay from "./handlers/calendarOverlay.mjs";
import * as config from "./handlers/config.mjs";
import * as dayMarks from "./handlers/dayMarks.mjs";
import * as hooks from "./handlers/hooks.mjs";
import * as notify from "./handlers/notify.mjs";
import * as sync from "./handlers/sync.mjs";
import * as widget from "./handlers/widget.mjs";

/** 版本只维护在 manifest 一处，避免和 package.json 漂移。 */
function readManifestVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/main.mjs → 包根目录
  const manifestPath = join(here, "..", "yinian-plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    version?: string;
  };
  return manifest.version ?? "0.0.0";
}

start({
  version: readManifestVersion(),

  onInit: (context) => {
    // 钩子的去重集合要从上一轮的 state 里恢复，否则重启后会重复处理
    hooks.restoreSeen(context.state);
  },

  handlers: {
    ...tools,
    // 同步
    "sync.pull": sync.pull,
    "sync.push": sync.push,

    // 生命周期钩子
    "hook.dispatch": hooks.dispatch,

    // 通知渠道
    "notify.send": notify.send,

    // 日期标记（农历 / 节气 / 节日 / 法定节假日）
    "dayMarks.list": dayMarks.list,

    // 日历叠加层（考勤这类**个人数据**的角标与汇总）。
    // 与 dayMarks 不同：默认关闭，用户在日历侧栏显式打开后宿主才会调它
    "calendarOverlay.list": calendarOverlay.list,

    // 浮窗小组件（桌面端浮窗上的一张卡片）。同样默认关闭：浮窗是常驻置顶窗口，
    // 「装了插件」不等于「同意把我的数据画在屏幕最上层」
    "widget.render": widget.render,

    // 配置
    "config.validate": config.validate,
    // config.schema 不用实现：包里有 settings.*.json 静态文件时宿主直接读文件。
    // 需要动态 schema（选项要从外部拉）时才实现它。

    // 自定义方法。名字必须匹配 ^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$
    // 且不能用 plugin. / config. / sync. / notify. / hook. / host. 前缀
    "template.testConnection": config.testConnection,
    "template.startAuthorization": config.startAuthorization,
    "template.listProjects": config.listProjects,
  },
});
