/**
 * 配置校验与自定义方法示例。
 *
 * ## 两层闸门
 *
 * 宿主先按 schema 校验形状（必填、类型、范围），过了之后才调 `config.validate`
 * 让你做**语义**校验：凭据对不对、路径存不存在、账号有没有权限。
 *
 * 所以这里不用重复检查「必填字段有没有填」——形状已经过了。
 *
 * ## 校验失败要带 field
 *
 * `{ field, message }` 会被精确定位到设置面板的那一格。只给整体 message 的话，
 * 用户只能看到一句「配置无效」，不知道该改哪里。
 */

import { logger } from "../sdk/index.mjs";
import type {
  ActionResult,
  ConfigValidateRequest,
  ConfigValidateResult,
  OptionsResult,
} from "../sdk/index.mjs";

export async function validate(
  request: ConfigValidateRequest,
): Promise<ConfigValidateResult> {
  const errors: ConfigValidateResult["errors"] = [];
  const config = request.config;

  // 语义校验的例子：token 形状对了，但要真的去问一下外部认不认
  const token = config["apiToken"];
  if (typeof token === "string" && token.length > 0 && !token.startsWith("demo-")) {
    errors.push({
      field: "apiToken",
      message: "这个 token 外部系统不认，请重新获取",
    });
  }

  const endpoint = config["endpoint"];
  if (typeof endpoint === "string" && endpoint.startsWith("http://")) {
    errors.push({
      field: "endpoint",
      message: "凭据会随请求发出，必须用 https",
    });
  }

  if (errors.length > 0) {
    // 不要在日志里打 config：secret 字段是明文注入的
    logger.warn(`配置校验未通过：${errors.length} 处`, { code: "CONFIG_INVALID" });
    return { ok: false, errors };
  }
  return { ok: true };
}

/**
 * `action` 按钮示例：测试连接。
 *
 * **不要在 action 里长轮询**：它只有 15 秒超时，而且启用前的临时进程会被宿主
 * 回收，后台任务活不下来。需要等的事情放到 `config.validate`（30 秒）里。
 */
export async function testConnection(): Promise<ActionResult> {
  return {
    message: "连接正常（模板里是假的，换成你的真实请求）",
  };
}

/**
 * OAuth device flow 的「开始授权」示例。
 *
 * 插件画不了界面，把授权链接递给用户的唯一方式就是 `openUrl`——宿主会用系统
 * 浏览器打开它。真实实现要把 device_code 存进 `dataDir`，然后在
 * `config.validate` 里轮询换 token。
 */
export async function startAuthorization(): Promise<ActionResult> {
  return {
    message: "请在浏览器里完成授权，用户码 DEMO-1234",
    openUrl: "https://example.com/device?user_code=DEMO-1234",
  };
}

/** `optionsFrom: "rpc:template.listProjects"` 的目标。 */
export async function listProjects(): Promise<OptionsResult> {
  return {
    options: [
      { value: "inbox", label: "收件箱" },
      { value: "work", label: "工作" },
    ],
  };
}
