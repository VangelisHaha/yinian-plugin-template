/**
 * 浮窗小组件示例：`widget.render`。
 *
 * 桌面端的「小组件」载体是**浮窗**，形态是一列卡片：你的卡片和一念内置的那几张
 * （今日时间轴 / 今日待办 / 接下来 / 明天 / 完成进度）并排，由用户在设置页里逐个打开
 * 并排序。契约见一念仓库 `docs/11-plugin-architecture.md` §8.5 与
 * `docs/17-desktop-widget-design.md` §5。
 *
 * ## 这个调用在 UI 路径上，而且不许联网
 *
 * 超时 **8 秒**，失败不重试、不计入断路器。**不要在这里发网络请求**——浮窗按一下热键
 * 就要出来，一次 DNS 抖动不该让它空着。把刷新放到自己的后台节奏里、写进 `dataDir`，
 * `render` 只读缓存。`refreshSeconds` 声明的是「宿主多久来问一次」，不是「你多久去拉
 * 一次」，两者是独立的。
 *
 * ## 它默认关闭，第一次被调到就是授权信号
 *
 * 与 `calendarOverlay` 同档，而位置更靠前：浮窗是**常驻置顶窗口**，可能出现在会议投屏、
 * 结对编程、录屏里。「装了一个飞书插件」不等于「同意把我的会议标题画在屏幕最上层」。
 *
 * 所以：**在收到第一次 `widget.render` 之前，不要去拉用户的个人数据。**
 *
 * ## 形状归宿主，内容归你
 *
 * 四种布局是封闭集合，没有 `custom`、不能给 HTML、不能给颜色。你能给的是语义档位
 * （`tone`）与三种形状（`mark`）。这不是限制得多，而是——十个插件各画一套样式的结果是
 * 浮窗看起来像一个插件集市，而它本该是一个人的今天。
 *
 * ## 失败与「没有内容」是两回事
 *
 * 抛异常 / 超时 → 宿主显示「暂时取不到」并**保留卡片**；正常返回但没数据 → 显示你给的
 * `empty` 文案。所以**没数据时要正常返回并给 `empty`，不要抛**：「今天没有会议了」是个
 * 好消息，不该长得像错误。
 */

import { logger } from "../sdk/index.mjs";
import type {
  WidgetRenderRequest,
  WidgetRenderResult,
  WidgetRow,
} from "../sdk/index.mjs";

/** 认不出的语言按默认走，**不要报错**（同 `calendarOverlay`）。 */
function isEnglish(locale: string): boolean {
  return locale.toLowerCase().startsWith("en");
}

/** `HH:mm`。宿主要的是**已格式化好的字符串**，不是时间戳。 */
function clock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export async function render(
  request: WidgetRenderRequest,
): Promise<WidgetRenderResult> {
  const now = new Date(request.now);
  if (Number.isNaN(now.getTime())) {
    // 返回空而不是抛异常：抛了用户会看到「暂时取不到」，而问题在参数上，
    // 那句话会把他引去查网络
    logger.warn("widget.render 收到非法时刻", {
      code: "TEMPLATE_WIDGET_NOW",
      detail: { now: request.now },
    });
    return {};
  }

  const en = isEnglish(request.locale);

  /*
   * 换成你的实现：读 `dataDir` 里由后台刷新写好的缓存，挑出今天剩下的条目。
   *
   * 这里给一个纯计算的最小示例——「今天剩下的整点」，只为把链路跑通。真实数据必须先
   * 落缓存再读，理由见文件头。
   */
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const rows: WidgetRow[] = [];
  for (let hour = now.getHours() + 1; hour <= 23; hour += 1) {
    if (rows.length >= request.maxRows) break;
    const startMinute = hour * 60;
    rows.push({
      key: `slot-${hour}`,
      time: clock(startMinute),
      primary: en ? `Demo slot ${hour}:00` : `示例时段 ${hour} 点`,
      secondary: en ? "Template plugin" : "来自插件模板",
      // 行尾走等宽，适合时长与数量
      trailing: `${startMinute - nowMinutes}m`,
      // 最近那一条值得被看见；其余是普通信息。**不能指定颜色**，只能给档位
      tone: rows.length === 0 ? "strong" : "neutral",
      mark: "dot",
      // 只有 https 会被放行（http 也会被拒）。协议对不上时宿主只摘掉 action、
      // 保留这一行
      action: { kind: "open", url: "https://github.com/VangelisHaha" },
      // 声明的 layout 是 timeline 时宿主才会用这两个字段排序；list 下会被清掉
      startMinute,
      endMinute: startMinute + 30,
    });
  }

  return {
    rows,
    footer: en
      ? `updated ${clock(nowMinutes)}`
      : `${clock(nowMinutes)} 更新`,
    // 没数据时**正常返回并给这句话**，不要抛异常——那是两种不同的状态
    empty: en ? "Nothing left today." : "今天没有剩下的时段了。",
  };
}
