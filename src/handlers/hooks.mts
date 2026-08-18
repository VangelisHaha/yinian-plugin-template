/**
 * 生命周期钩子示例：`hook.dispatch`。
 *
 * ## 幂等是硬要求
 *
 * 投递保证是**至少一次**。同一条事件会在这些情况下重来：宿主重启、上一次投递
 * 超时（其实可能已经处理成功了）、断路器恢复后重投。
 *
 * 所以必须按 `outboxId` 去重，并且**把去重集合存进 `host.setState`**——只放内存
 * 的话进程一重启就全忘了，用户会看到重复的外部动作（重复发消息、重复建卡片）。
 */

import { context, logger, setState } from "../sdk/index.mjs";
import type { HookEvent, HookResult } from "../sdk/index.mjs";

/** 去重集合保留多少条。够覆盖一轮重试就行，无限增长会撑爆 64KB 的 state 上限。 */
const SEEN_LIMIT = 200;

let seen: string[] = [];

/** 从 `plugin.init` 下发的 state 里恢复去重集合。 */
export function restoreSeen(state: Record<string, unknown>): void {
  const restored = state["seenOutboxIds"];
  seen = Array.isArray(restored)
    ? restored.filter((item): item is string => typeof item === "string")
    : [];
}

export async function dispatch(event: HookEvent): Promise<HookResult> {
  if (seen.includes(event.outboxId)) {
    // 返回 ok 而不是报错：这条确实已经处理过了，报错会让宿主白白重试
    logger.debug(`重复投递已忽略 ${event.outboxId}`, { traceId: event.traceId });
    return { ok: true, detail: "duplicate" };
  }

  logger.info(`收到 ${event.topic} → ${event.entity.type}/${event.entity.id}`, {
    traceId: event.traceId,
    code: "TEMPLATE_HOOK",
  });

  // 这里换成你的副作用：发消息、写日报、推第三方…
  const snapshot = event.payload.snapshot ?? {};
  logger.debug(`标题：${String(snapshot["title"] ?? "(无)")}`);

  remember(event.outboxId);
  return { ok: true };
}

function remember(outboxId: string): void {
  seen.push(outboxId);
  if (seen.length > SEEN_LIMIT) {
    seen = seen.slice(-SEEN_LIMIT);
  }
  const integrationId = context().integrationId;
  setState({
    ...(integrationId ? { integrationId } : {}),
    state: { seenOutboxIds: seen },
  });
}
