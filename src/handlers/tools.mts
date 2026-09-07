/** 自定义插件从这里开始：把模拟数据替换成自己的 API，宿主不需要改代码。 */
import {
  context,
  toolHandlers,
  textResult,
  taskItemSchema,
  eventItemSchema,
  withToolReceipt,
  type ToolDefinition,
  type ToolCall,
  type ToolResult,
} from "../sdk/index.mjs";
async function createTask(r: ToolCall): Promise<ToolResult> {
  return withToolReceipt(context().dataDir, r, async () => {
    const item = r.arguments.item as Record<string, unknown>;
    return {
      ...textResult("模拟任务已创建"),
      binding: {
        resource: "task",
        item: {
          externalId: `demo-${r.operationId}`,
          title: String(item.title),
          status: "todo",
          ...(item.notes ? { notes: String(item.notes) } : {}),
          ...(item.dueAt ? { dueAt: String(item.dueAt) } : {}),
        },
      },
    };
  });
}
async function createEvent(r: ToolCall): Promise<ToolResult> {
  return withToolReceipt(context().dataDir, r, async () => {
    const item = r.arguments.item as Record<string, unknown>;
    return {
      ...textResult("模拟日程已创建"),
      binding: {
        resource: "event",
        calendar: { externalId: "demo-calendar", name: "Demo 日历" },
        event: {
          ...item,
          externalId: `demo-${r.operationId}`,
          calendarExternalId: "demo-calendar",
          title: String(item.title),
          allDay: Boolean(item.allDay),
        },
      },
    };
  });
}
export const demoTools: ToolDefinition[] = [
  {
    name: "list_schedule",
    title: "查询模拟排期",
    description: "查询 Demo 排期，支持关键词；不修改一念数据。",
    effect: "read",
    inputSchema: {
      type: "object",
      properties: { keyword: { type: "string", title: "关键词" } },
      additionalProperties: false,
    },
    execute: ({ arguments: args }) => {
      const rows = [
        { title: "示例评审", date: "2026-09-08", source: "Demo 假数据" },
      ].filter((r) => r.title.includes(String(args.keyword ?? "")));
      return textResult(
        rows.map((r) => `${r.date} ${r.title}（${r.source}）`).join("\n") ||
          "没有匹配排期",
        { rows },
      );
    },
  },
  {
    name: "create_note",
    title: "创建模拟外部备忘",
    description: "在 Demo 插件中创建备忘，不绑定本地任务。",
    effect: "write",
    idempotent: true,
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", minLength: 1, title: "备忘内容" } },
      required: ["text"],
      additionalProperties: false,
    },
    execute: (r) =>
      withToolReceipt(context().dataDir, r, async () =>
        textResult("模拟备忘已保存", {
          id: r.operationId,
          text: r.arguments.text,
        }),
      ),
  },
  {
    name: "create_task",
    title: "创建并同步模拟任务",
    description: "在一念创建任务并关联 Demo 外部任务。",
    effect: "write",
    idempotent: true,
    binding: "task",
    inputSchema: {
      type: "object",
      properties: { item: taskItemSchema },
      required: ["item"],
      additionalProperties: false,
    },
    execute: createTask,
  },
  {
    name: "create_event",
    title: "创建并同步模拟日程",
    description: "在一念创建日程并转入 Demo 外部只读日历。",
    effect: "write",
    idempotent: true,
    binding: "event",
    inputSchema: {
      type: "object",
      properties: { item: eventItemSchema },
      required: ["item"],
      additionalProperties: false,
    },
    execute: createEvent,
  },
];
export const handlers = toolHandlers(demoTools);
