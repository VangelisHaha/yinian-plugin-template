/**
 * 日期标记示例：`dayMarks.list`。
 *
 * ## 这个调用在 UI 路径上
 *
 * 用户翻一页月视图就等着它返回，超时只有 **8 秒**（其他调用是 30–120 秒）。
 * 所以**不要在这里发网络请求**——要联网刷数据的话，在自己的后台节奏里刷、
 * 写进 `dataDir`，`list` 只读本地缓存。
 *
 * 失败也不会重试、不计入断路器：标记是装饰性显示，丢一条只是这一屏少个农历，
 * 重试只会让翻月卡住。所以宁可返回空数组，也不要卡住或抛异常。
 *
 * ## 优先级不用你操心
 *
 * 同一天可以给多条（清明既是节气又是节日又是假期）。宿主按
 * `节气 → 节日 → 法定假日 → 农历` 排好序，界面只取第一条开关打开的。
 * 你不需要自己判「这天该显示哪个」。
 *
 * ## 算得出来 vs 数据只到某天
 *
 * 这是最容易做错的地方。农历与节气按天文算法算，任意年份都有，所以
 * `coversUntil` 留空。行政机关按年公布的放假安排**算不出来**，必须声明
 * `coversUntil`——把「查不到」当成「那天不放假」，用户会照着一张错的日历排期。
 */

import { logger } from "../sdk/index.mjs";
import type {
  DayMark,
  DayMarksListRequest,
  DayMarksListResult,
} from "../sdk/index.mjs";

/** 一次查询最多覆盖多少天。宿主侧也有上限，这里只是防御性兜底。 */
const MAX_SPAN_DAYS = 400;

/**
 * 严格日期键解析。
 *
 * 手写而不是 `new Date(value)`：后者会把 `2026-8-1` 也认成合法值，而它当 Map key
 * 时和 `2026-08-01` 对不上。宿主收到非严格格式会记 `PLUGIN_CONTRACT_VIOLATION`。
 */
function parseDateKey(value: string): Date | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  // UTC 构造 + UTC 取值，全程不碰本地时区：日期键是「哪一天」，没有时刻，
  // 用本地时间构造会让 UTC+13 / UTC-11 的机器算出差一天的结果
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null; // 2026-02-30 这类
  }
  return date;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 逐日遍历闭区间 `[from, to]`。 */
function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(from);
  while (cursor <= to && days.length <= MAX_SPAN_DAYS) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export async function list(
  request: DayMarksListRequest,
): Promise<DayMarksListResult> {
  const from = parseDateKey(request.from);
  const to = parseDateKey(request.to);

  if (!from || !to || to < from) {
    // 返回空而不是抛异常：这个调用不重试，抛了用户就只看到一个红色的插件卡片，
    // 而真正的信息（宿主传了什么）在日志里更有用
    logger.warn("dayMarks.list 收到非法区间", {
      code: "TEMPLATE_DAY_MARKS_RANGE",
      detail: { from: request.from, to: request.to },
    });
    return { marks: [] };
  }

  // 换成你的实现：读 dataDir 里的缓存、查内置数据表、或者纯计算。
  // 这里给一个「每月 1 号打个标记」的最小示例，只为把链路跑通。
  const marks: DayMark[] = [];
  for (const day of eachDay(from, to)) {
    if (day.getUTCDate() !== 1) continue;
    marks.push({
      date: toDateKey(day),
      kind: "festival",
      label: "月初",
      detail: `${day.getUTCFullYear()} 年 ${day.getUTCMonth() + 1} 月第一天`,
    });
  }

  return {
    marks,
    // 回传 providers 可以动态更新覆盖范围。这个示例是纯计算、任意年份都有，
    // 所以不给 coversUntil——给了反而会让界面提示「安排尚未公布」
    providers: [
      {
        id: "template-marks",
        name: "模板日期标记",
        kinds: ["festival"],
      },
    ],
  };
}
