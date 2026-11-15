"use strict";

// 阶段 4a：发现页一句话找人，以及三个产品页面的约束（无内联脚本、可访问、品牌变量）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../src/server");

async function withApp(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "qimeng-pages-"));
  const server = createServer({ dataDir, demoMode: true, llmApiKey: "", llmBaseUrl: "", env: {}, trustProxy: false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ base });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const discover = async (base, q) => (await fetch(`${base}/api/discover?q=${encodeURIComponent(q)}`)).json();

test("发现页：一句话也能找人，并说明每位结果为什么匹配", async () => {
  await withApp(async ({ base }) => {
    const sentence = await discover(base, "惠州做民宿的人");
    assert.deepEqual(sentence.terms, ["惠州", "民宿"]);
    assert.equal(sentence.results.length, 1);
    assert.deepEqual(sentence.results[0].matched, [{ term: "惠州", field: "城市" }, { term: "民宿", field: "身份" }]);
    assert.ok(Array.isArray(sentence.results[0].seeking));
    assert.equal(sentence.total, 1);

    const longer = await discover(base, "想找双月湾的民宿主理人");
    assert.equal(longer.results.length, 1);
    assert.ok(longer.terms.includes("民宿主理人"), JSON.stringify(longer.terms));

    // 关键词写法照旧可用
    const words = await discover(base, "惠州 摄影");
    assert.deepEqual(words.terms, ["惠州", "摄影"]);
    assert.equal(words.results.length, 1);

    // 有一个词对不上就不返回，不编造
    const partial = await discover(base, "惠州做火锅的人");
    assert.equal(partial.results.length, 0);
    assert.equal(partial.empty, true);

    const none = await discover(base, "火星殖民者zzz");
    assert.deepEqual(none.terms, ["火星殖民者zzz"]);
    assert.equal(none.results.length, 0);

    const all = await discover(base, "");
    assert.deepEqual(all.terms, []);
    assert.equal(all.results.length, 1);
    assert.deepEqual(all.results[0].matched, []);

    const long = await discover(base, "长".repeat(500));
    assert.ok(long.query.length <= 60, "查询长度有上限");
  });
});

test("三个产品页面：没有内联可执行脚本，有唯一 h1、可见标签与 life 作用域", async () => {
  await withApp(async ({ base }) => {
    for (const pathname of ["/", "/discover.html", "/workbench.html"]) {
      const html = await (await fetch(`${base}${pathname}`)).text();
      for (const [, attrs] of html.matchAll(/<script([^>]*)>/g)) assert.match(attrs, /\bsrc="\/[a-z-]+\.js"/, `${pathname} 有内联脚本：<script${attrs}>`);
      assert.match(html, /<html lang="zh-CN" data-qd-product="life" data-qd-theme="light">/);
      assert.match(html, /<script src="\/ui-init\.js"><\/script>\s*<\/head>/, `${pathname} 要在 head 里同步加载 ui-init.js`);
      assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${pathname} 应该只有一个 h1`);
      for (const [, id] of html.matchAll(/<(?:input|textarea)[^>]*\bid="([^"]+)"/g)) assert.match(html, new RegExp(`<label[^>]*for="${id}"`), `${pathname} 的 #${id} 缺少标签`);
      assert.match(html, /<meta name="description"/);
    }
    const home = await (await fetch(`${base}/`)).text();
    assert.match(home, /开始制作/);
    assert.match(home, /一键体验示例/);
    assert.match(home, /示例数据/, "示例入口必须标注示例数据");
    for (const theme of ["slowhouse", "papermountain", "sticker", "simple", "ink"]) assert.match(home, new RegExp(`href="/u/alan\\?theme=${theme}"`));
    for (const old of ["warm", "cinema", "editorial"]) assert.equal(home.includes(`?theme=${old}`), false, "首页不再链接旧主题名");
    const workbench = await (await fetch(`${base}/workbench.html`)).text();
    assert.match(workbench, /<meta name="robots" content="noindex">/, "编辑页不应被搜索引擎收录");
    for (const id of ["mic", "question", "transcript", "recaps", "progress", "pick-chip", "answer", "generate", "preview", "preview-b", "theme-picks", "publish-form", "import-text"]) {
      assert.match(workbench, new RegExp(`id="${id}"`), `工作台缺少 #${id}`);
    }
    for (const command of ["skip", "back", "redo", "repeat"]) assert.match(workbench, new RegExp(`data-command="${command}"`));
  });
});

test("设计系统：品牌 V2.0 语义色数值不变，产品样式不使用渐变光晕", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
  for (const [name, value] of [["action", "#A9532F"], ["on-action", "#FFFFFF"], ["action-hover", "#924526"], ["action-pressed", "#7C3B22"], ["focus", "#924526"], ["link", "#924526"], ["selection", "#F8EEE7"]]) {
    assert.match(css, new RegExp(`--qd-color-${name}: ${value};`), `--qd-color-${name} 应为 ${value}`);
  }
  for (const file of ["styles.css", "extend.css", "studio.css"]) {
    const text = fs.readFileSync(path.join(__dirname, "..", "public", file), "utf8");
    assert.equal(/radial-gradient|blur\(/.test(text), false, `${file} 不应使用光晕或模糊`);
    assert.equal(/font-size:\s*1[0-3]px/.test(text), false, `${file} 不应出现小于 14px 的字号`);
  }
});

test("网站图片：只接受 https 与本站图片，非法地址整体拒绝，发布后同步，档案里公开", async () => {
  await withApp(async ({ base }) => {
    const call = async (method, pathname, token, body) => {
      const response = await fetch(`${base}${pathname}`, { method, headers: { "Content-Type": "application/json", ...(token ? { "X-Edit-Token": token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, json: await response.json().catch(() => null) };
    };
    const created = await call("POST", "/api/sessions", null, { mode: "demo" });
    const { id, editToken } = created.json;
    const early = await call("POST", `/api/sessions/${id}/media`, editToken, { hero: { url: "https://example.com/a.jpg" } });
    assert.equal(early.status, 400, "生成之前不能设置图片");
    await call("POST", `/api/sessions/${id}/profile`, editToken);
    const published = await call("POST", `/api/sessions/${id}/publish`, editToken, {});
    const url = published.json.url;

    for (const bad of ["javascript:alert(1)", "http://example.com/a.jpg", "data:image/png;base64,AAAA", "/img/../data/sessions.json", "https://example.com/a.jpg\" onerror=\"x", "//evil.com/a.jpg"]) {
      const res = await call("POST", `/api/sessions/${id}/media`, editToken, { hero: { url: bad } });
      assert.equal(res.status, 400, `应拒绝：${bad}`);
      assert.match(res.json.error, /只支持 https/);
    }
    const mixed = await call("POST", `/api/sessions/${id}/media`, editToken, { hero: { url: "https://example.com/ok.jpg" }, gallery: [{ url: "https://example.com/1.jpg" }, { url: "javascript:1" }] });
    assert.equal(mixed.status, 400, "有一张不合格就整体拒绝，不悄悄丢掉");
    const tooMany = await call("POST", `/api/sessions/${id}/media`, editToken, { gallery: Array.from({ length: 7 }, (_, i) => ({ url: `https://example.com/${i}.jpg` })) });
    assert.equal(tooMany.status, 400);
    const denied = await call("POST", `/api/sessions/${id}/media`, "wrong", { hero: { url: "https://example.com/a.jpg" } });
    assert.equal(denied.status, 401);

    const ok = await call("POST", `/api/sessions/${id}/media`, editToken, { hero: { url: "https://example.com/cover.jpg", alt: "<b>门口</b>" }, gallery: [{ url: "https://example.com/1.jpg" }, { url: "/img/story-craft.jpg" }] });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.changed, ["media", "hero"]);
    assert.equal(ok.json.profile.media.hero.url, "https://example.com/cover.jpg");
    assert.equal(ok.json.profile.media.gallery.length, 2);
    const page = await (await fetch(`${base}${url}`)).text();
    assert.match(page, /src="https:\/\/example\.com\/cover\.jpg"/, "已发布网站同步新首图");
    assert.match(page, /referrerpolicy="no-referrer"/);
    assert.equal(page.includes("<b>门口</b>"), false);
    assert.match(page, /&lt;b&gt;门口&lt;\/b&gt;/);
    const profile = await (await fetch(`${base}${url}/profile.json`)).json();
    assert.equal(profile.media.hero.url, "https://example.com/cover.jpg");

    const cleared = await call("POST", `/api/sessions/${id}/media`, editToken, { hero: null, gallery: [] });
    assert.equal(cleared.json.profile.media.hero, null);
    const fallback = await (await fetch(`${base}${url}`)).text();
    assert.equal(fallback.includes("example.com/cover.jpg"), false, "清空后改用风格插画");
  });
});
