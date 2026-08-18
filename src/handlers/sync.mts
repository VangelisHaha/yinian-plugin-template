/**
 * 同步扩展点示例：`sync.pull` 与 `sync.push`。
 *
 * 这里用一份内存假数据代替真实外部系统。把 `fetchRemote` / `applyRemote` 换成
 * 你的 HTTP 调用就是一个可用的同步插件。
 *
 * ## 三条容易踩的规则
 *
 * 1. **插件不写库**。返回数据就够了，冲突判定、去重、落库全在一念核心。
 *    你也拿不到本地任务——`sync.pull` 的参数里没有本地状态，这是故意的。
 * 2. **分页要靠游标**，别一次返回全部。`hasMore: true` 时宿主会带着你给的
 *    `cursor` 再调一次，最多 20 轮。
 * 3. **`completedAt` 不知道就别传**，见 `types.mts` 上的说明。
 */

import { logger, progress, setState } from "../sdk/index.mjs";
import type {
  ExternalItem,
  PullRequest,
  PullResult,
  PushRequest,
  PushResult,
} from "../sdk/index.mjs";

/** 一页最多返回多少条。真实插件按外部 API 的分页大小定。 */
const PAGE_SIZE = 50;

/** 假的外部数据源。换成你的 API 调用。 */
const REMOTE: ExternalItem[] = [
  {
    externalId: "demo-1",
    title: "示例任务：读一遍插件契约",
    notes: "docs/11-plugin-architecture.md",
    status: "todo",
    priority: "high",
    dueAt: "2026-08-25T10:00:00Z",
    remoteUpdatedAt: "2026-08-18T02:00:00Z",
    // 未识别的字段放这里，一念会原样存下来
    remoteData: { source: "template", assignee: "someone" },
  },
  {
    externalId: "demo-2",
    title: "示例任务：跑一次 npm run verify",
    status: "done",
    // 知道真实完成时间才传；不知道就整个字段省掉
    completedAt: "2026-08-17T08:30:00Z",
    remoteUpdatedAt: "2026-08-17T08:30:00Z",
  },
];

export async function pull(request: PullRequest): Promise<PullResult> {
  logger.info(`拉取 ${request.resource}`, { traceId: request.traceId });

  const offset = decodeCursor(request.cursor);
  const page = REMOTE.slice(offset, offset + PAGE_SIZE);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < REMOTE.length;

  progress({
    traceId: request.traceId,
    phase: "pull",
    current: nextOffset,
    total: REMOTE.length,
  });

  // 游标存进宿主：进程重启后还能接着拉。别只放内存
  if (!hasMore) {
    setState({
      ...(request.integrationId ? { integrationId: request.integrationId } : {}),
      cursor: encodeCursor(nextOffset),
    });
  }

  return {
    items: page,
    ...(hasMore ? { cursor: encodeCursor(nextOffset) } : {}),
    hasMore,
    // 外部删掉的 id 报给宿主。一念不会删本地任务，只标记等人处理
    deletedExternalIds: [],
  };
}

export async function push(request: PushRequest): Promise<PushResult> {
  logger.info(`回写 ${request.action} → ${request.externalId ?? "(新建)"}`, {
    traceId: request.traceId,
  });

  const target = REMOTE.find((item) => item.externalId === request.externalId);
  if (!target) {
    // 外部已经没有这条了。报错会让宿主一直重试，直接说「跳过」更准确
    return { applied: false };
  }

  switch (request.action) {
    case "complete":
      // 外部本来就是完成态 → applied: false。宿主不会重试，也不开 ack 窗口
      if (target.status === "done") return { applied: false };
      target.status = "done";
      target.completedAt = request.item.completedAt ?? new Date().toISOString();
      break;

    case "reopen":
      if (target.status !== "done" && target.status !== "canceled") {
        return { applied: false };
      }
      target.status = "todo";
      delete target.completedAt;
      break;

    case "cancel":
      if (target.status === "canceled") return { applied: false };
      target.status = "canceled";
      break;

    case "update":
      // 只改 changedFields 里的字段，别整条覆盖——外部可能有一念不认识的字段。
      //
      // 注意「设为空」与「不改」是两件事：一念把清空表达为 undefined，
      // 而多数外部 API 需要显式传 null 才算清空。这里用删除键代表清空，
      // 换成真实 API 时请照它的约定来。
      for (const field of request.changedFields ?? []) {
        switch (field) {
          case "title":
            target.title = request.item.title;
            break;
          case "notes":
            assign(target, "notes", request.item.notes);
            break;
          case "due_at":
            assign(target, "dueAt", request.item.dueAt);
            break;
          case "priority":
            assign(target, "priority", request.item.priority);
            break;
          default:
            // 声明过的字段才会收到，这里兜住未来新增的取值
            logger.debug(`忽略不支持的字段 ${field}`);
        }
      }
      break;

    case "delete":
      // manifest 里没声明 delete 的话宿主会先降级成 cancel，不会走到这里
      target.status = "canceled";
      break;

    default:
      throw new Error(`不支持的动作: ${request.action}`);
  }

  const remoteUpdatedAt = new Date().toISOString();
  target.remoteUpdatedAt = remoteUpdatedAt;

  return {
    applied: true,
    externalId: target.externalId,
    remoteUpdatedAt,
  };
}

function encodeCursor(offset: number): string {
  return String(offset);
}

/**
 * 有值就写，没值就删键。
 *
 * 直接 `target.x = undefined` 会在 JSON 里留下一个 `"x": undefined`（序列化后消失，
 * 但类型上是两回事），而 `exactOptionalPropertyTypes` 会正确地拦住这种写法。
 */
function assign<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value === undefined) {
    delete target[key];
    return;
  }
  target[key] = value;
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  // 游标解析不出来就从头拉：卡在原地比多拉一轮更糟
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
