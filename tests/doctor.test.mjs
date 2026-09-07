/**
 * doctor 的行为测试。
 *
 * 每个用例在临时目录里造一个「有某个特定问题」的包，然后断言 doctor 报出来。
 * 只断言「有没有报」和「报的是不是这件事」，不断言完整文案——文案会改，
 * 而这些测试的价值在于「这类问题不会被漏掉」。
 */

import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCTOR = join(ROOT, "scripts", "doctor.mjs");
const workspaces = [];

/** 复制一份完整的模板包，再按需改坏它。 */
function stage(mutate) {
  const dir = mkdtempSync(join(tmpdir(), "yinian-doctor-"));
  workspaces.push(dir);
  for (const entry of [
    "yinian-plugin.json",
    "settings.plugin.json",
    "settings.integration.json",
    "src",
    "dist",
  ]) {
    cpSync(join(ROOT, entry), join(dir, entry), { recursive: true });
  }
  mutate?.(dir);
  return dir;
}

function runDoctor(dir) {
  const result = spawnSync(process.execPath, [DOCTOR, "--root", dir], {
    encoding: "utf8",
  });
  return {
    code: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

function patchManifest(dir, mutate) {
  const path = join(dir, "yinian-plugin.json");
  const manifest = JSON.parse(readText(path));
  mutate(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function readText(path) {
  return spawnSync("cat", [path], { encoding: "utf8" }).stdout;
}

after(() => {
  for (const dir of workspaces) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("doctor", () => {
  it("完整的模板包全绿", () => {
    const { code, output } = runDoctor(stage());
    assert.equal(code, 0, output);
    assert.match(output, /doctor 全绿|doctor 通过/);
  });

  it("查出缺失的 manifest 必填字段", () => {
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        delete manifest.version;
        delete manifest.author;
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /缺少必填字段 version/);
    assert.match(output, /缺少必填字段 author/);
  });

  it("查出不合规的 id 与版本号", () => {
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        manifest.id = "Yinian_Bad";
        manifest.version = "v1";
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /id「Yinian_Bad」/);
    assert.match(output, /version「v1」不是合法 semver/);
  });

  it("拒绝未知的 runtime.kind", () => {
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        manifest.runtime.kind = "sandbox";
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /runtime\.kind/);
  });

  it("查出入口文件不存在", () => {
    const dir = stage((dir) => {
      rmSync(join(dir, "dist"), { recursive: true, force: true });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /不存在.*npm run build/s);
  });

  it("查出声明了扩展点却没注册对应方法", () => {
    const dir = stage((dir) => {
      const path = join(dir, "src", "main.mts");
      const source = readText(path).replace('"sync.pull": sync.pull,', "");
      writeFileSync(path, source);
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /没有注册 sync\.pull/);
  });

  it("查出 action 指向了没实现的方法", () => {
    const dir = stage((dir) => {
      const path = join(dir, "settings.plugin.json");
      const schema = JSON.parse(readText(path));
      const action = schema.fields.find((field) => field.type === "action");
      action.rpc = "template.notImplemented";
      writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /template\.notImplemented.*没有注册/s);
  });

  it("拒绝占用宿主保留前缀的自定义方法", () => {
    const dir = stage((dir) => {
      const path = join(dir, "settings.plugin.json");
      const schema = JSON.parse(readText(path));
      const action = schema.fields.find((field) => field.type === "action");
      action.rpc = "sync.somethingCustom";
      writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /保留前缀 sync\./);
  });

  it("查出 visibleWhen 指向不存在的同级字段", () => {
    const dir = stage((dir) => {
      const path = join(dir, "settings.integration.json");
      const schema = JSON.parse(readText(path));
      schema.fields.push({
        key: "ghost",
        type: "boolean",
        label: "幽灵字段",
        visibleWhen: { field: "nobodyHasThisKey", equals: true },
      });
      writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /nobodyHasThisKey/);
  });

  it("查出未声明权限却发网络请求", () => {
    const dir = stage((dir) => {
      mkdirSync(join(dir, "src", "extra"), { recursive: true });
      writeFileSync(
        join(dir, "src", "extra", "client.mts"),
        "export const ping = () => fetch('https://example.com');\n",
      );
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /permissions\.net 是空的/);
  });

  it("查出未声明权限却起子进程", () => {
    const dir = stage((dir) => {
      mkdirSync(join(dir, "src", "extra"), { recursive: true });
      writeFileSync(
        join(dir, "src", "extra", "shell.mts"),
        "import { spawn } from 'node:child_process';\nexport const run = () => spawn('ls', []);\n",
      );
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /permissions\.spawn 是空的/);
  });

  // 正则的 .exec() 不是起子进程。早先的检测写成 `\b(?:exec|spawn)\s*\(`，
  // 任何用 `/re/.exec(s)` 解析字符串的插件都会被误判成「执行外部命令」，
  // 只能靠去掉正则或者假装申请 spawn 权限来绕，两个都不对
  it("正则的 exec 不算执行外部命令", () => {
    const dir = stage((dir) => {
      mkdirSync(join(dir, "src", "extra"), { recursive: true });
      writeFileSync(
        join(dir, "src", "extra", "parse.mts"),
        [
          "const PATTERN = /^(\\d{4}-\\d{2}-\\d{2})/;",
          "export function day(value: string) {",
          "  return PATTERN.exec(value)?.[1] ?? null;",
          "}",
          "export function code(value: string) {",
          "  return /error=([A-Za-z]+)/.exec(value)?.[1] ?? '';",
          "}",
          "",
        ].join("\n"),
      );
    });
    const { code, output } = runDoctor(dir);
    assert.doesNotMatch(output, /permissions\.spawn 是空的/, output);
    assert.equal(code, 0, output);
  });

  it("查出未知的 hook topic 与 sync 能力", () => {
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        manifest.contributes.hooks = ["task.exploded"];
        manifest.contributes.sync.capabilities.actions = ["list", "teleport"];
        manifest.contributes.sync.capabilities.fields = ["title", "vibes"];
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /task\.exploded/);
    assert.match(output, /teleport/);
    assert.match(output, /vibes/);
  });

  it("查出未知的 sync resource", () => {
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        manifest.contributes.sync.resources = ["task", "meeting"];
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /meeting/);
  });

  it("纯 event 插件的多余动作与 task 字段只给警告", () => {
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        // event 是 pull-only：宿主不会调 push，fields 是 task 字段的门控
        manifest.contributes.sync.resources = ["event"];
        manifest.contributes.sync.capabilities.actions = ["list", "complete"];
        manifest.contributes.sync.capabilities.fields = ["title"];
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 0, `多声明不该挡住发布，只提醒：${output}`);
    assert.match(output, /pull-only/);
    assert.match(output, /纯 event 插件留空即可/);
  });

  it("声明 sync 但漏了 syncStrategy 要报错", () => {
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        delete manifest.contributes.syncStrategy;
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /必须声明 syncStrategy/);
  });

  it("间隔低于宿主下限只给警告", () => {
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        manifest.contributes.syncStrategy.minIntervalSeconds = 5;
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 0, "这不影响能不能装，只是会被抬到 60");
    assert.match(output, /低于宿主硬下限/);
  });

  it("坏 JSON 直接报出来", () => {
    const dir = stage((dir) => {
      writeFileSync(join(dir, "yinian-plugin.json"), "{ \"id\": }");
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /不是合法 JSON/);
  });

  it("查出未知的 dayMark kind", () => {
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        manifest.contributes.dayMarks.providers[0].kinds = ["zodiac"];
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /未知的 dayMark kind/);
  });

  it("dayMarks 的 providers 不能为空", () => {
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        manifest.contributes.dayMarks.providers = [];
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /需要非空的 providers/);
  });

  it("同一插件内 provider id 重复要报错", () => {
    // 宿主对外用 `<pluginId>/<providerId>`，撞了之后两个 provider 会互相覆盖且不报错
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        const first = manifest.contributes.dayMarks.providers[0];
        manifest.contributes.dayMarks.providers.push({ ...first });
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /重复/);
  });

  it("coversUntil 必须是严格日期键", () => {
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        manifest.contributes.dayMarks.providers[0].coversUntil = "2026-8-1";
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /coversUntil 必须是 YYYY-MM-DD/);
  });

  it("查出未知的 calendarOverlay surface", () => {
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        manifest.contributes.calendarOverlay.providers[0].surfaces = [
          "weekBadge",
        ];
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /未知的 calendarOverlay surface/);
  });

  it("calendarOverlay 的 surfaces 不能为空", () => {
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        manifest.contributes.calendarOverlay.providers[0].surfaces = [];
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /需要非空的 surfaces/);
  });

  it("calendarOverlay 的 provider id 重复要报错", () => {
    // 这里比 dayMarks 更要紧：provider id 是**启用开关**的身份，而那个开关是
    // 授权闸门——认错人等于把 A 的授权给了 B
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        const first = manifest.contributes.calendarOverlay.providers[0];
        manifest.contributes.calendarOverlay.providers.push({ ...first });
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /重复/);
  });

  it("calendarOverlay 声明了却没注册 list 要报错", () => {
    const dir = stage((dir) => {
      const entry = join(dir, "src", "main.mts");
      writeFileSync(
        entry,
        readText(entry).replace(
          '"calendarOverlay.list": calendarOverlay.list,',
          "",
        ),
      );
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /没有注册 calendarOverlay\.list/);
  });

  it("manifest 自称 enabled 只是警告，不阻塞", () => {
    // 启用态一律由宿主按偏好盖写。声明了只会让作者以为装上就生效
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        manifest.contributes.calendarOverlay.providers[0].enabled = true;
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 0);
    assert.match(output, /不要声明 enabled/);
  });

  it("缺 description 只是警告", () => {
    // 它是用户决定要不要授权的唯一依据，但缺了不该拦住构建
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        delete manifest.contributes.calendarOverlay.providers[0].description;
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 0);
    assert.match(output, /建议给 description/);
  });

  it("声明 dayMarks 但没注册 dayMarks.list 要报错", () => {
    const dir = stage((dir) => {
      const path = join(dir, "src", "main.mts");
      const source = readText(path).replace(
        /"dayMarks\.list": dayMarks\.list,/,
        "",
      );
      writeFileSync(path, source);
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /dayMarks\.list/);
  });

  it("什么扩展点都不贡献要报错", () => {
    const dir = stage((dir) => {
      patchManifest(dir, (manifest) => {
        manifest.contributes = {
          settingsPanel: ["settings.plugin.json", "settings.integration.json"],
        };
      });
    });
    const { code, output } = runDoctor(dir);
    assert.equal(code, 1);
    assert.match(output, /至少要有一个扩展点/);
  });
});
