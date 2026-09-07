import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  toolHandlers,
  textResult,
  withToolReceipt,
  validateToolSchema,
} from "../dist/sdk/tools.mjs";

test("任意工具名可发现并调用，参数错误和未确认写入拒绝", async () => {
  let calls = 0;
  const tools = toolHandlers([
    {
      name: "custom_lookup",
      title: "自定义查询",
      description: "示例",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: { n: { type: "integer", minimum: 1 } },
        required: ["n"],
        additionalProperties: false,
      },
      execute: (r) => {
        calls++;
        return textResult("事实", { n: r.arguments.n });
      },
    },
  ]);
  assert.equal(tools["tools.list"]({}).tools[0].name, "custom_lookup");
  await assert.rejects(() =>
    tools["tools.call"]({ name: "custom_lookup", arguments: { n: 0 } }),
  );
  assert.equal(calls, 0);
  assert.equal(
    (await tools["tools.call"]({ name: "custom_lookup", arguments: { n: 1 } }))
      .structuredContent.n,
    1,
  );
  assert.throws(() =>
    validateToolSchema({ type: "object", $ref: "https://example.com" }),
  );
  const writer = toolHandlers([
    {
      name: "write",
      title: "写入",
      description: "示例",
      effect: "write",
      inputSchema: { type: "object" },
      execute: () => textResult("成功"),
    },
  ]);
  await assert.rejects(() =>
    writer["tools.call"]({ name: "write", arguments: {} }),
  );
});
test("成功回执跨注册器复用，换参数或路径穿越拒绝", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tools-receipt-test-"));
  let calls = 0;
  const request = {
    name: "write",
    arguments: { title: "任务" },
    operationId: "same-id",
  };
  try {
    const action = async () => {
      calls++;
      return textResult("成功", { id: "remote-one" });
    };
    assert.deepEqual(
      await withToolReceipt(dir, request, action),
      await withToolReceipt(dir, request, action),
    );
    assert.equal(calls, 1);
    await assert.rejects(() =>
      withToolReceipt(
        dir,
        { ...request, arguments: { title: "另一个" } },
        action,
      ),
    );
    await assert.rejects(() =>
      withToolReceipt(dir, { ...request, operationId: "../secret" }, action),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
