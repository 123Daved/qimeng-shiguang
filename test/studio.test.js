"use strict";

// 语音工作室、实时草稿预览与新主题的服务端测试。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../src/server");
const { renderSite } = require("../src/render");
const { draftFromTurns, guessName } = require("../src/draft");
const { inferTheme, normalizeProfile } = require("../src/profile");

async function withApp(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "qimeng-studio-"));
  const server = createServer({ dataDir, demoMode: true, llmApiKey: "", llmBaseUrl: "", modelNotice: "测试模型公示" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ base, dataDir });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function call(base, method, pathname, { token, body } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { "X-Edit-Token": token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json, text, type: response.headers.get("content-type") || "" };
}

// 模拟语音识别出来的口语：没有「我能提供：」这类小标题，带口头语。
const SPOKEN = [
  "嗯我叫王小明在杭州做独立设计师主要做品牌",
  "我可以做品牌logo设计，3000元起，适合刚起步的小店。还有包装设计2000块一款",
  "2023年给西湖边一家咖啡馆做了整套视觉，后来他们开了三家分店",
  "小时候我爸开文具店，我总在包装纸上画画，觉得好看的东西能让人多停一秒",
  "加我微信 xm-design，我想找做餐饮的主理人和摄影师",
  "光影",
];

test("语音回答记为 voice，草稿随回答逐段长出来", async () => {
  await withApp(async ({ base, dataDir }) => {
    const created = await call(base, "POST", "/api/sessions", { body: { mode: "interview" } });
    const { id, editToken: token } = created.json;
    assert.deepEqual(created.json.session.draft.filled, []);

    const first = await call(base, "POST", `/api/sessions/${id}/messages`, { token, body: { text: SPOKEN[0], via: "voice" } });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.via, "voice");
    assert.equal(first.json.messages.at(-2).via, "voice");
    assert.ok(first.json.draft.filled.includes("hero"));
    assert.equal(first.json.draft.name, "王小明");
    assert.equal(first.json.draft.filled.includes("services"), false);

    const second = await call(base, "POST", `/api/sessions/${id}/messages`, { token, body: { text: SPOKEN[1], via: "voice" } });
    assert.ok(second.json.draft.filled.includes("services"));
    const draft = await call(base, "GET", `/api/sessions/${id}/draft`, { token });
    assert.equal(draft.status, 200);
    assert.equal(draft.json.generated, false);
    assert.equal(draft.json.profile.name, "王小明");
    assert.equal(draft.json.profile.city, "杭州");
    assert.equal(draft.json.profile.title, "独立设计师");
    assert.ok(draft.json.profile.services.some((item) => item.name === "品牌logo设计" && /3000/.test(item.price)));
    assert.ok(draft.json.profile.services.some((item) => item.name === "包装设计" && /2000元/.test(item.price)));
    assert.equal(draft.json.profile.about.includes("嗯"), false, "口头语应被去掉");

    const typed = await call(base, "POST", `/api/sessions/${id}/messages`, { token, body: { text: SPOKEN[2] } });
    assert.equal(typed.json.via, "text");

    const events = JSON.parse(fs.readFileSync(path.join(dataDir, "events.json"), "utf8"));
    assert.equal(events.filter((event) => event.type === "voice_turn").length, 2);
    assert.ok(events.some((event) => event.type === "interview_turn" && event.via === "text"));

    const denied = await call(base, "GET", `/api/sessions/${id}/draft`, { token: "wrong" });
    assert.equal(denied.status, 401);
  });
});

test("草稿预览在生成前可用，并标出新长出的版块", async () => {
  await withApp(async ({ base }) => {
    const created = await call(base, "POST", "/api/sessions", { body: { mode: "interview" } });
    const { id, editToken: token } = created.json;
    const notYet = await call(base, "GET", `/preview/${id}?key=${token}`);
    assert.equal(notYet.status, 404, "不带 draft=1 时保持原来的行为");
    const empty = await call(base, "GET", `/preview/${id}?key=${token}&draft=1`);
    assert.equal(empty.status, 200);
    assert.match(empty.text, /is-draft/);
    assert.match(empty.text, /你的名字/);
    assert.match(empty.text, /待补充/);
    assert.match(empty.text, /noindex/);

    await call(base, "POST", `/api/sessions/${id}/messages`, { token, body: { text: SPOKEN[0], via: "voice" } });
    await call(base, "POST", `/api/sessions/${id}/messages`, { token, body: { text: SPOKEN[1], via: "voice" } });
    const built = await call(base, "GET", `/preview/${id}?key=${token}&draft=1&hl=services,${encodeURIComponent("<x>")}`);
    assert.equal(built.status, 200);
    assert.match(built.text, /王小明/);
    assert.match(built.text, /品牌logo设计/);
    assert.match(built.text, /class="block block-services is-built"/);
    assert.equal(built.text.includes("<x>"), false);

    const stranger = await call(base, "GET", `/preview/${id}?key=nope&draft=1`);
    assert.equal(stranger.status, 401);
  });
});

test("纯语音口语在离线模式也能生成像样的网站，并支持光影主题", async () => {
  await withApp(async ({ base }) => {
    const created = await call(base, "POST", "/api/sessions", { body: { mode: "interview" } });
    const { id, editToken: token } = created.json;
    let last;
    for (const text of SPOKEN) {
      last = await call(base, "POST", `/api/sessions/${id}/messages`, { token, body: { text, via: "voice" } });
      assert.equal(last.status, 200, last.text);
    }
    assert.equal(last.json.coverage.style, true, "说出主题名字就算回答了风格，不再追问");
    const generated = await call(base, "POST", `/api/sessions/${id}/profile`, { token });
    assert.equal(generated.status, 200, generated.text);
    const profile = generated.json.profile;
    assert.equal(profile.name, "王小明");
    assert.equal(profile.theme, "cinema");
    assert.ok(profile.services.length >= 2);
    assert.ok(profile.highlights.length >= 1);
    assert.match(profile.story, /文具店/);
    assert.equal(profile.contacts.wechat, "xm-design");

    const edited = await call(base, "POST", `/api/sessions/${id}/edits`, { token, body: { instruction: "风格换成杂志" } });
    assert.equal(edited.json.profile.theme, "editorial");
    assert.ok(edited.json.changed.includes("theme"));
    assert.equal(edited.json.profile.services.length, profile.services.length);

    const published = await call(base, "POST", `/api/sessions/${id}/publish`, { token, body: {} });
    const html = await (await fetch(`${base}${published.json.url}`)).text();
    assert.match(html, /theme-editorial/);
    assert.match(html, /application\/ld\+json/);
    const llms = await (await fetch(`${base}${published.json.url}/llms.txt`)).text();
    assert.match(llms, /品牌logo设计/);
  });
});

test("新主题渲染特效钩子，主题预览参数不改档案", async () => {
  for (const theme of ["cinema", "editorial"]) {
    const html = renderSite({
      profile: { name: "林可", title: "摄影师", about: "我是林可。", story: "一个故事。", highlights: [{ title: "作品一", description: "说明" }], services: [{ name: "民宿摄影", price: "299 元起" }], theme },
      slug: "林可",
    });
    assert.match(html, new RegExp(`theme-${theme}`));
    assert.match(html, /href="\/site\.css"/);
    assert.match(html, /src="\/fx\.js"/);
    assert.match(html, /src="\/voice\.js"/);
    assert.match(html, /data-scramble/);
    assert.match(html, /data-words/);
    assert.match(html, /data-timeline/);
    assert.match(html, /data-tilt/);
    assert.match(html, /id="services"/);
    assert.match(html, /我能提供/);
    assert.match(html, /我也要一个 →/);
  }
  assert.equal(inferTheme("想要电影感一点"), "cinema");
  assert.equal(inferTheme("杂志风"), "editorial");
  assert.equal(inferTheme("温暖"), "warm");
  assert.equal(normalizeProfile({ name: "a", theme: "cinema" }).theme, "cinema");
  assert.equal(guessName("我叫王小明今年三十二岁"), "王小明");

  await withApp(async ({ base }) => {
    const previewed = await (await fetch(`${base}/u/alan?theme=cinema`)).text();
    assert.match(previewed, /theme-cinema/);
    assert.match(previewed, /data-qd-theme="dark"/);
    const bogus = await (await fetch(`${base}/u/alan?theme=${encodeURIComponent("\"><script>")}`)).text();
    assert.match(bogus, /theme-editorial/);
    assert.equal(bogus.includes("\"><script>"), false);
    const profile = await (await fetch(`${base}/u/alan/profile.json`)).json();
    assert.equal(profile.theme, "editorial");
    for (const [file, type] of [["/voice.js", "javascript"], ["/fx.js", "javascript"], ["/site.css", "css"], ["/studio.css", "css"], ["/extend.css", "css"]]) {
      const response = await call(base, "GET", file);
      assert.equal(response.status, 200, file);
      assert.match(response.type, new RegExp(type));
    }
    const workbench = await (await fetch(`${base}/workbench.html`)).text();
    assert.match(workbench, /id="mic"/);
    assert.match(workbench, /src="\/voice\.js"/);
  });
});

test("草稿规则：没有标点的语音转写也能拆出名字、城市和身份", () => {
  const { profile, filled } = draftFromTurns({
    messages: [
      { role: "user", topic: "who", content: "大家叫我阿木 在成都做咖啡师" },
      { role: "user", topic: "seek", content: "电话 13900001111 欢迎想学手冲的朋友" },
    ],
  });
  assert.equal(profile.name, "阿木");
  assert.equal(profile.city, "成都");
  assert.equal(profile.title, "咖啡师");
  assert.equal(profile.contacts.phone, "13900001111");
  assert.ok(filled.includes("contacts"));
  assert.equal(filled.includes("services"), false);
});
