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
    for (const theme of ["warm", "simple", "ink", "cinema", "editorial"]) assert.match(home, new RegExp(`href="/u/alan\\?theme=${theme}"`));
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
