/**
 * 日历叠加层示例：`calendarOverlay.list`。
 *
 * 把**外部系统里属于这个用户的信息**贴到一念的日历上：格子右上角的角标、
 * 视图右上角的汇总条、日历侧栏底部那张「负载」卡里的几行统计。
 *
 * ## 这个调用在 UI 路径上，而且不许联网
 *
 * 超时 **8 秒**，失败不重试、不计入断路器。**不要在这里发网络请求**——把刷新放到
 * 自己的后台节奏里、写进 `dataDir`，`list` 只读本地缓存。考勤这类数据几分钟级的
 * 新鲜度完全够用，而一次网络抖动不该让用户翻不动月视图。
 *
 * ## 它默认关闭，第一次被调到就是授权信号
 *
 * 与 `dayMarks` 刻意相反：日期标记装上即生效，叠加层**必须由用户在日历侧栏逐个
 * 显式打开，关着的时候宿主根本不会调这个方法**。理由是「拉一次」本身就是需要授权
 * 的行为——它要拿着用户的凭据去访问外部系统，做完再决定显不显示已经晚了。
 *
 * 所以：**在收到第一次 `calendarOverlay.list` 之前，不要去拉用户的个人数据。**
 * 那一刻之前你无从判断他同意了没有。
 *
 * ## 两个区间通常不相等
 *
 * `from`/`to` 是看得见的全部格子（月视图 42 天，含上下月边缘），角标按它给；
 * `summaryFrom`/`summaryTo` 是汇总口径（月视图当月首尾）。拿 42 天算「本月出勤」
 * 会多算六七天，**而界面上完全看不出错**。
 *
 * ## 文案归你，颜色归宿主
 *
 * 宿主不认识「出勤」这个词，也就无从翻译它，所以 `locale` 会下发给你。反过来
 * `tone` 是语义档位而不是色值——插件带 hex 进来的结果一定是两个插件的颜色互相
 * 打架、深色主题下对比不足。
 */

import { logger } from "../sdk/index.mjs";
import type {
  CalendarOverlayListRequest,
  CalendarOverlayListResult,
  DayBadge,
} from "../sdk/index.mjs";

/** 严格日期键，理由同 `dayMarks.mts`：宽松格式当 Map key 时对不上。 */
function parseDateKey(value: string): Date | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 认不出的语言按默认走，**不要报错**（契约 §8.4）。 */
function isEnglish(locale: string): boolean {
  return locale.toLowerCase().startsWith("en");
}

export async function list(
  request: CalendarOverlayListRequest,
): Promise<CalendarOverlayListResult> {
  const from = parseDateKey(request.from);
  const to = parseDateKey(request.to);
  const summaryFrom = parseDateKey(request.summaryFrom);
  const summaryTo = parseDateKey(request.summaryTo);

  if (!from || !to || !summaryFrom || !summaryTo || to < from) {
    // 返回空而不是抛异常：这个调用不重试，抛了用户只看到一个红色插件卡片
    logger.warn("calendarOverlay.list 收到非法区间", {
      code: "TEMPLATE_OVERLAY_RANGE",
      detail: { from: request.from, to: request.to },
    });
    return {};
  }

  const en = isEnglish(request.locale);

  // 换成你的实现：读 dataDir 里由后台刷新写好的缓存。
  // 这里给一个「每周六打个角标」的最小示例，只为把链路跑通——注意它是纯计算的，
  // 真实的考勤 / 工时数据必须先落缓存再读。
  const badges: DayBadge[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    if (cursor.getUTCDay() === 6) {
      badges.push({
        date: toDateKey(cursor),
        label: en ? "OT" : "加",
        tone: "strong",
        // 角标只有一两个字，真正的信息在 detail 里
        detail: en ? "Weekend overtime (demo)" : "周末加班（示例数据）",
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  // 汇总口径用 summaryFrom/summaryTo 那一段，不是上面那 42 天
  const summaryDays =
    Math.round((summaryTo.getTime() - summaryFrom.getTime()) / 86_400_000) + 1;

  return {
    badges,
    // 右上角那条很窄，只放最该被一眼看到的一项
    summary: [
      {
        key: "span",
        label: en ? "Range" : "口径",
        value: en ? `${summaryDays}d` : `${summaryDays} 天`,
      },
    ],
    // 侧栏那张卡空间宽松，适合一组同类指标铺开。
    // `value` 是已格式化的字符串，宿主不做算术；「零」要用 tone: "mute" 说
    sidebarStats: [
      {
        key: "badges",
        label: en ? "Marked" : "标记",
        value: en ? `${badges.length}d` : `${badges.length} 天`,
        mark: "bar",
        tone: badges.length === 0 ? "mute" : "neutral",
      },
    ],
  };
}
