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
 */

import { logger } from "../sdk/index.mjs";
import type { NotifyRequest, NotifyResult } from "../sdk/index.mjs";

export async function send(request: NotifyRequest): Promise<NotifyResult> {
  const { notification, traceId } = request;

  // 换成你的推送：邮件、Bark、webhook、企业 IM…
  logger.info(`通知[${notification.kind}] ${notification.title}`, {
    traceId,
    code: "TEMPLATE_NOTIFY",
    detail: {
      body: notification.body,
      entity: notification.entity,
      // 没声明 supportsActions 时这里永远是空的
      actions: notification.actions?.map((action) => action.id) ?? [],
    },
  });

  return { delivered: true };
}
