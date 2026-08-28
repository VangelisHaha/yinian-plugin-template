/**
 * 通知渠道示例：`notify.send`。
 *
 * ## 通知不会重试
 *
 * 与钩子不同，通知**投一次就算完**：半小时后重投一条「任务即将到期」是噪声，
 * 不是补救。所以这里失败就失败，返回 `delivered: false` 并说明原因即可，
 * 不要自己在插件里排重试队列。
 *
 * ## actions 要看渠道声明
 *
 * 只有 manifest 里 `notificationChannel.supportsActions = true` 的渠道才会收到
 * `actions`。声明了却不渲染，用户会看到一条没有按钮的通知；没声明却渲染，
 * 你根本收不到 actions 字段。
 *
 * ## 版面大的渠道用 `detail`
 *
 * `title` / `body` 是为系统通知栏那两行字准备的。如果你的渠道能发卡片（飞书、企微），
 * 用 `notification.detail`：里面有事项本体标题、段名、优先级、逾期标记、deep link，
 * 以及一串**已经格式化好的** `fields`。
 *
 * 两条纪律：
 *
 * - **不要再解析 `fields` 的值。** 那是宿主按本机时区算好的最终文案，
 *   自己解析 UTC 串等于把全天右开区间、跨天段这些边界重新实现一遍，写歪了用户
 *   会收到一个错的时间且毫无提示。要做视觉强调（优先级标红）用 `priority` / `overdue`。
 * - **`detail` 可能不存在。** `kind: "custom"` 没有宿主实体，比如设置页的测试通知。
 */

import { logger } from "../sdk/index.mjs";
import type { NotifyRequest, NotifyResult } from "../sdk/index.mjs";

export async function send(request: NotifyRequest): Promise<NotifyResult> {
  const { notification, traceId } = request;
  const fields = notification.detail?.fields ?? [];

  // 换成你的推送：邮件、Bark、webhook、企业 IM…
  logger.info(`通知[${notification.kind}] ${notification.title}`, {
    traceId,
    code: "TEMPLATE_NOTIFY",
    detail: {
      body: notification.body,
      entity: notification.entity,
      // 没声明 supportsActions 时这里永远是空的
      actions: notification.actions?.map((action) => action.id) ?? [],
      // 能发卡片的渠道就按这些行排版；纯文本渠道拼成几行也比只发 body 好
      lines: fields.map((field) => `${field.label}：${field.value}`),
      deepLink: notification.detail?.deepLink,
    },
  });

  return { delivered: true };
}
