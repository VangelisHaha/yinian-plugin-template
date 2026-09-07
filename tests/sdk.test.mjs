/**
 * SDK 与端到端契约测试。
 *
 * 端到端那条直接跑 mock host：它已经在校验帧格式、幂等、超时与通知，
 * 这里只需要断言它整体通过，不必把同样的断言抄一遍。
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  isValidCustomMethod,
  MAX_STATE_BYTES,
  PROTOCOL_VERSION,
  TIMEOUTS,
} from "../dist/sdk/index.mjs";
import { setState } from "../dist/sdk/runtime.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("协议常量", () => {
  it("SDK 实现的是协议 v1", () => {
    assert.equal(PROTOCOL_VERSION, 1);
  });

  it("超时表与契约 §4.5 一致", () => {
    assert.equal(TIMEOUTS["plugin.init"], 30_000);
    assert.equal(TIMEOUTS["sync.pull"], 120_000);
    assert.equal(TIMEOUTS["hook.dispatch"], 30_000);
    // dayMarks.list 在 UI 路径上（翻一页月视图就等着它），远小于其他调用
    assert.equal(TIMEOUTS["dayMarks.list"], 8_000);
    assert.ok(
      TIMEOUTS["dayMarks.list"] < TIMEOUTS["notify.send"],
      "日期标记必须比其他扩展点更快超时，否则翻月会卡住",
    );
    // calendarOverlay.list 同档：也在 UI 路径上
    assert.equal(TIMEOUTS["calendarOverlay.list"], 8_000);
    // shutdown 只有 5 秒，超了会被 SIGKILL
    assert.equal(TIMEOUTS["plugin.shutdown"], 5_000);
  });
});

describe("自定义方法命名", () => {
  it("接受合法的点分小驼峰", () => {
    assert.ok(isValidCustomMethod("feishu.testConnection"));
    assert.ok(isValidCustomMethod("template.listProjects"));
    assert.ok(isValidCustomMethod("a.b.c"));
  });

  it("拒绝宿主保留前缀", () => {
    for (const method of [
      "plugin.init",
      "config.validate",
      "sync.pull",
      "notify.send",
      "hook.dispatch",
      "host.log",
      "dayMarks.list",
      "calendarOverlay.list",
    ]) {
      assert.equal(
        isValidCustomMethod(method),
        false,
        `${method} 应当被拒绝`,
      );
    }
  });

  it("拒绝不合规的形状", () => {
    for (const method of [
      "NoDot",
      "Upper.Case",
      "trailing.",
      ".leading",
      "has-dash.method",
      "has_underscore.method",
    ]) {
      assert.equal(isValidCustomMethod(method), false, `${method} 应当被拒绝`);
    }
  });
});

describe("host.setState", () => {
  it("超过 64KB 时抛出可读错误而不是静默失败", () => {
    // 静默失败最糟：插件会以为状态存住了，重启后发现全丢了
    const tooBig = { blob: "x".repeat(MAX_STATE_BYTES + 1) };
    assert.throws(
      () => setState({ state: tooBig }),
      /超过上限/,
    );
  });

  it("正常大小的状态会写出一帧 host.setState", () => {
    const written = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      written.push(String(chunk));
      return true;
    };
    try {
      setState({ cursor: "cursor-1", state: { seen: ["a"] } });
    } finally {
      process.stdout.write = original;
    }

    assert.equal(written.length, 1);
    assert.ok(written[0].endsWith("\n"), "必须一行一帧");
    const frame = JSON.parse(written[0]);
    assert.equal(frame.jsonrpc, "2.0");
    assert.equal(frame.method, "host.setState");
    assert.equal(frame.id, undefined, "通知不能带 id");
    assert.equal(frame.params.cursor, "cursor-1");
  });
});

describe("端到端", () => {
  it("mock host 能跑完整个生命周期", () => {
    const result = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "mock-host.mjs")],
      { encoding: "utf8", cwd: ROOT },
    );
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, output);

    for (const method of [
      "plugin.init",
      "config.validate",
      "sync.pull",
      "sync.push",
      "hook.dispatch",
      "notify.send",
      "plugin.shutdown",
    ]) {
      assert.match(output, new RegExp(`✓ ${method.replace(".", "\\.")}`));
    }
    assert.doesNotMatch(output, /契约违规/);
  });
});
