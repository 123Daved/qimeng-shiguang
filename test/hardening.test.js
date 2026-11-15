"use strict";

// 加固：安全响应头与 CSP、限流、版块修改的服务端范围约束。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../src/server");
const { createRateLimiter, clientOf } = require("../src/ratelimit");
const { classifyUtterance } = require("../src/voice/intent");

async function withApp(options, fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "qimeng-hard-"));
  const server = createServer({ dataDir, demoMode: true, llmApiKey: "", llmBaseUrl: "", env: {}, trustProxy: false, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ base, dataDir });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function api(base, method, pathname, { token, body, headers } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { "X-Edit-Token": token } : {}), ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json, text, headers: response.headers };
}

test("所有响应带安全头；个人网站没有内联可执行脚本，启动数据改为 JSON 数据块", async () => {
  await withApp({}, async ({ base }) => {
    for (const pathname of ["/", "/workbench.html", "/u/alan", "/api/config", "/u/alan/profile.json", "/nope"]) {
      const res = await api(base, "GET", pathname);
      const csp = res.headers.get("content-security-policy") || "";
      assert.match(csp, /script-src 'self'(;|$)/, `${pathname} 的 CSP 不允许内联脚本`);
      assert.match(csp, /frame-ancestors 'self'/);
      assert.match(csp, /object-src 'none'/);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("x-frame-options"), "SAMEORIGIN");
      assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
      assert.match(res.headers.get("permissions-policy") || "", /microphone=\(self\)/);
    }
    const page = (await api(base, "GET", "/u/alan")).text;
    const scripts = [...page.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
    for (const [, attrs, body] of scripts) {
      // 允许：外链脚本（src）和不会被执行的数据块（JSON / JSON-LD）
      const ok = /\bsrc=/.test(attrs) || /type="application\/(ld\+)?json"/.test(attrs);
      assert.ok(ok, `发现内联可执行脚本：<script${attrs}>${body.slice(0, 40)}`);
    }
    assert.match(page, /<script type="application\/json" id="qd-site">/);
    assert.ok(page.indexOf('src="/boot.js"') > page.indexOf('id="qd-site"'), "boot.js 要在数据块之后加载");
    assert.ok(page.indexOf('src="/boot.js"') < page.indexOf('src="/site.js"'), "boot.js 要在 site.js 之前加载");
    const boot = JSON.parse(/<script type="application\/json" id="qd-site">([\s\S]*?)<\/script>/.exec(page)[1]);
    assert.ok(boot.slug);
    assert.equal((await api(base, "GET", "/boot.js")).status, 200);
    // 普通 http 不发 HSTS
    assert.equal((await api(base, "GET", "/")).headers.get("strict-transport-security"), null);
  });
});

test("档案里的脚本注入在 JSON 数据块里同样被转义，不能提前结束数据块", async () => {
  await withApp({}, async ({ base }) => {
    const created = await api(base, "POST", "/api/sessions", { body: { mode: "interview" } });
    const { id, editToken } = created.json;
    await api(base, "POST", `/api/sessions/${id}/imports`, { token: editToken, body: { text: "我是小李</script><script>alert(1)</script>，在惠州做测试。\n我能提供：\n- 测试服务：只用于安全测试，10 元起，适合测试。\n客人常问：</script><img src=x onerror=alert(2)>？答：不会。" } });
    await api(base, "POST", `/api/sessions/${id}/profile`, { token: editToken });
    const published = await api(base, "POST", `/api/sessions/${id}/publish`, { token: editToken });
    const page = (await api(base, "GET", published.json.url)).text;
    const block = /<script type="application\/json" id="qd-site">([\s\S]*?)<\/script>/.exec(page)[1];
    assert.equal(block.includes("</script"), false);
    assert.equal(page.includes("<script>alert(1)</script>"), false);
    assert.equal(page.includes("<img src=x onerror"), false);
    JSON.parse(block);
  });
});

test("限流：超过额度返回 429 和 Retry-After，按类别分开计数，并记下事件", async () => {
  await withApp({ rateLimit: { session: { capacity: 2, perMinute: 1 }, ask: { capacity: 1, perMinute: 1 } } }, async ({ base, dataDir }) => {
    assert.equal((await api(base, "POST", "/api/sessions", { body: {} })).status, 201);
    assert.equal((await api(base, "POST", "/api/sessions", { body: {} })).status, 201);
    const blocked = await api(base, "POST", "/api/sessions", { body: {} });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.code, "rate_limited");
    assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
    assert.match(blocked.json.error, /秒后再试/);
    // 别的类别不受影响；只读请求不限流
    assert.equal((await api(base, "POST", `/api/sites/${encodeURIComponent("阿岚")}/ask`, { body: { question: "住宿多少钱？" } })).status, 200);
    assert.equal((await api(base, "POST", `/api/sites/${encodeURIComponent("阿岚")}/ask`, { body: { question: "住宿多少钱？" } })).status, 429);
    for (let i = 0; i < 5; i += 1) assert.equal((await api(base, "GET", "/api/config")).status, 200);
    const events = JSON.parse(fs.readFileSync(path.join(dataDir, "events.json"), "utf8"));
    assert.ok(events.some((event) => event.type === "rate_limited" && event.kind === "session"));
  });
});

test("限流：默认不信任 X-Forwarded-For，伪造请求头绕不过去", async () => {
  await withApp({ rateLimit: { session: { capacity: 1, perMinute: 1 } } }, async ({ base }) => {
    assert.equal((await api(base, "POST", "/api/sessions", { body: {}, headers: { "X-Forwarded-For": "1.1.1.1" } })).status, 201);
    assert.equal((await api(base, "POST", "/api/sessions", { body: {}, headers: { "X-Forwarded-For": "2.2.2.2" } })).status, 429);
  });
  await withApp({ trustProxy: true, rateLimit: { session: { capacity: 1, perMinute: 1 } } }, async ({ base }) => {
    assert.equal((await api(base, "POST", "/api/sessions", { body: {}, headers: { "X-Forwarded-For": "1.1.1.1" } })).status, 201);
    assert.equal((await api(base, "POST", "/api/sessions", { body: {}, headers: { "X-Forwarded-For": "2.2.2.2, 10.0.0.1" } })).status, 201, "部署在代理后时按真实客户端计数");
    const https = await api(base, "GET", "/", { headers: { "X-Forwarded-Proto": "https" } });
    assert.match(https.headers.get("strict-transport-security") || "", /max-age=/);
  });
});

test("令牌桶按时间回填；客户端识别只在信任代理时读请求头", () => {
  let time = 0;
  const limiter = createRateLimiter({ x: { capacity: 2, perMinute: 6 } }, () => time);
  assert.equal(limiter.take("x", "a").ok, true);
  assert.equal(limiter.take("x", "a").ok, true);
  const denied = limiter.take("x", "a");
  assert.equal(denied.ok, false);
  assert.equal(denied.retryAfter, 10);
  assert.equal(limiter.take("x", "b").ok, true, "不同客户端分开计数");
  time += 10000;
  assert.equal(limiter.take("x", "a").ok, true, "10 秒后回填 1 个");
  assert.equal(limiter.take("unknown-kind", "a").ok, true);
  const req = { headers: { "x-forwarded-for": "9.9.9.9, 1.1.1.1" }, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal(clientOf(req, false), "127.0.0.1");
  assert.equal(clientOf(req, true), "9.9.9.9");
});

test("点选版块修改：服务端只保留该版块字段的改动，其他字段一律还原", async () => {
  // 模拟一个「不听话」的编辑模型：除了服务，还偷偷改了简介、名字和主题。
  const mock = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const system = body.messages[0].content;
      let content = "{\"reply\":\"还有什么想补充的？\",\"topic\":\"offer\",\"is_followup\":false}";
      if (system.includes("整理师")) {
        content = JSON.stringify({ name: "阿岚", title: "民宿主理人", city: "惠州", about: "原来的简介。", services: [{ name: "海景双人房", description: "看海", price: "380 元起", for_whom: "情侣" }], theme: "warm" });
      } else if (system.includes("编辑")) {
        const current = JSON.parse(body.messages[1].content.split("当前档案：")[1]);
        current.services[0].price = "399 元起";
        current.about = "被偷偷改掉的简介。";
        current.name = "改名了";
        current.theme = "cinema";
        content = JSON.stringify(current);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
    });
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  try {
    await withApp({ demoMode: false, llmApiKey: "test-key", llmBaseUrl: `http://127.0.0.1:${mock.address().port}/v1` }, async ({ base }) => {
      const created = await api(base, "POST", "/api/sessions", { body: { mode: "interview" } });
      const { id, editToken } = created.json;
      await api(base, "POST", `/api/sessions/${id}/messages`, { token: editToken, body: { text: "我是阿岚，在惠州双月湾做民宿主理人，经营靠海的小民宿。" } });
      const generated = await api(base, "POST", `/api/sessions/${id}/profile`, { token: editToken });
      assert.equal(generated.json.profile.about, "原来的简介。");
      const scoped = await api(base, "POST", `/api/sessions/${id}/edits`, { token: editToken, body: { instruction: "只修改「我能提供」这一版块，其他版块保持原样：价格改成 399 元起", section: "services" } });
      assert.equal(scoped.status, 200);
      assert.equal(scoped.json.profile.services[0].price, "399 元起", "被点选的版块照常修改");
      assert.equal(scoped.json.profile.about, "原来的简介。", "其他版块被还原");
      assert.equal(scoped.json.profile.name, "阿岚");
      assert.equal(scoped.json.profile.theme, "warm");
      assert.deepEqual(scoped.json.changed, ["services"]);
      // 不认识的版块名按整站修改处理（与不传 section 相同），不会报错
      const unknown = await api(base, "POST", `/api/sessions/${id}/edits`, { token: editToken, body: { instruction: "价格改成 399 元起", section: "__proto__" } });
      assert.equal(unknown.status, 200);
      assert.equal(unknown.json.profile.name, "改名了");
      const tooLong = await api(base, "POST", `/api/sessions/${id}/edits`, { token: editToken, body: { instruction: "长".repeat(601) } });
      assert.equal(tooLong.status, 400);
    });
  } finally {
    await new Promise((resolve) => mock.close(resolve));
  }
});

test("点选版块后说「换成某风格」：按整站换风格，不被限制在版块里", () => {
  const intent = classifyUtterance("换成光影风格", { hasProfile: true, section: "services", sectionLabel: "我能提供" });
  assert.deepEqual(intent, { kind: "edit", instruction: "风格换成光影" });
});

test("主题名不接受原型属性：预览参数与档案字段都退回合法主题", async () => {
  const { normalizeProfile, inferTheme } = require("../src/profile");
  for (const bad of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    assert.equal(inferTheme(bad), "");
    const profile = normalizeProfile({ name: "测试", theme: bad });
    assert.equal(profile.theme, "warm");
    assert.match(profile.accent, /^#[0-9A-F]{6}$/i);
  }
  await withApp({}, async ({ base }) => {
    for (const bad of ["__proto__", "constructor", "toString"]) {
      const page = (await api(base, "GET", `/u/alan?theme=${bad}`)).text;
      assert.equal(page.includes(`theme-${bad}`), false);
      assert.equal(page.includes("--site-accent:undefined"), false);
    }
  });
});
