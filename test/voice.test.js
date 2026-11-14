"use strict";

// 语音对话重构（阶段 3）：意图识别、按句切分、流式回合、口令、追问上限、降级与语音接口。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../src/server");
const { classifyUtterance } = require("../src/voice/intent");
const { createSentenceSplitter, splitSentences, isQuestion } = require("../src/voice/sentences");
const { ruleRecap } = require("../src/agent");

async function withApp(options, fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "qimeng-voice-"));
  const server = createServer({ dataDir, demoMode: true, llmApiKey: "", llmBaseUrl: "", env: {}, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ base, dataDir });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function api(base, method, pathname, { token, body } = {}) {
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

// 读取 SSE 流，返回按顺序排列的事件。
async function turn(base, id, token, body) {
  const response = await fetch(`${base}/api/sessions/${id}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Edit-Token": token } : {}) },
    body: JSON.stringify(body),
  });
  const type = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (!/event-stream/.test(type)) return { status: response.status, type, json: JSON.parse(raw), events: [] };
  const events = raw.split("\n\n").filter(Boolean).map((block) => {
    const event = /^event: (.+)$/m.exec(block)[1];
    const data = JSON.parse(/^data: (.+)$/m.exec(block)[1]);
    return { event, data };
  });
  const pick = (name) => events.filter((item) => item.event === name).map((item) => item.data);
  return { status: response.status, type, events, pick, done: pick("done")[0], sentences: pick("sentence") };
}

async function newSession(base, mode = "interview") {
  const created = await api(base, "POST", "/api/sessions", { body: { mode } });
  return { id: created.json.id, token: created.json.editToken };
}

const questionMarks = (text) => (String(text).match(/[？?]/g) || []).length;

// 模拟流式大模型：把 chunks 逐段以 SSE 吐出。
function llmMock(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      seen.push(body);
      handler(body, res);
    });
  });
  return { server, seen };
}

function sseReply(res, parts) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const part of parts) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

test("意图识别：口令、修改与回答分得清，长句里的口令词不误判", () => {
  const kind = (text, ctx) => {
    const intent = classifyUtterance(text, ctx);
    return intent.kind === "command" ? intent.command : intent.kind;
  };
  assert.equal(kind("跳过"), "skip");
  assert.equal(kind("这个先跳过吧。"), "skip");
  assert.equal(kind("下一个问题"), "skip");
  assert.equal(kind("返回上一个"), "back");
  assert.equal(kind("上一题"), "back");
  assert.equal(kind("我说错了"), "redo");
  assert.equal(kind("不对，我刚才说错了，重说"), "redo");
  assert.equal(kind("重新说一遍"), "redo");
  assert.equal(kind("再说一遍"), "repeat");
  assert.equal(kind("没听清"), "repeat");
  assert.equal(kind("等一下"), "stop");
  assert.equal(kind("生成网站"), "generate");
  assert.equal(kind("帮我生成一下吧"), "generate");
  // 没有网站时「发布」不是口令
  assert.equal(kind("发布"), "answer");
  assert.equal(kind("发布", { hasProfile: true }), "publish");
  // 正常回答里出现口令词不能被吃掉
  assert.equal(kind("我以前跳过很多行业，最后回到老家做民宿"), "answer");
  assert.equal(kind("我说错了也没关系，客人都很包容，这是我最喜欢这里的原因"), "answer");
  assert.equal(kind("我叫阿岚，在惠州双月湾开民宿"), "answer");
  // 生成后：换风格、明显的修改、聊完后的自由发言都是修改
  assert.deepEqual(classifyUtterance("换成光影风格", { hasProfile: true }), { kind: "edit", instruction: "风格换成光影" });
  assert.equal(kind("把价格改成 399 元起", { hasProfile: true }), "edit");
  assert.equal(kind("简介写得活泼一点", { hasProfile: true, complete: true }), "edit");
  // 采访还没结束、又不像修改的话，仍然当回答
  assert.equal(kind("我在找摄影师合作", { hasProfile: true, complete: false }), "answer");
  // 点选了区块：只改这一块
  const scoped = classifyUtterance("价格写清楚一点", { hasProfile: true, section: "services", sectionLabel: "我能提供" });
  assert.equal(scoped.kind, "edit");
  assert.equal(scoped.section, "services");
  assert.match(scoped.instruction, /只修改「我能提供」/);
  assert.match(scoped.instruction, /价格写清楚一点$/);
});

test("按句切分：流式分段也能在句末切开，引号归属正确", () => {
  assert.deepEqual(splitSentences("记下了：阿岚在双月湾做民宿。你能提供什么服务？"), ["记下了：阿岚在双月湾做民宿。", "你能提供什么服务？"]);
  const out = [];
  const splitter = createSentenceSplitter((sentence) => out.push(sentence));
  for (const part of ["记下", "了：你叫小王", "。那", "你说「照这样说就行」", "，可以吗？", "」多余"]) splitter.push(part);
  assert.deepEqual(out, ["记下了：你叫小王。", "那你说「照这样说就行」，可以吗？」"]);
  splitter.flush();
  assert.deepEqual(out.at(-1), "多余");
  assert.equal(isQuestion("可以吗？」"), true);
  assert.equal(isQuestion("记下了。"), false);
  assert.equal(ruleRecap("嗯那个我叫阿岚，在惠州双月湾开民宿。"), "记下了：我叫阿岚，在惠州双月湾开民宿。");
  assert.ok(Array.from(ruleRecap("很长".repeat(40))).length <= 36);
});

test("流式回合（离线）：按 intent → meta → sentence → done 推送，一轮只有一个问题，并留下一句话摘要", async () => {
  await withApp({}, async ({ base, dataDir }) => {
    const { id, token } = await newSession(base);
    const result = await turn(base, id, token, { text: "我叫阿岚，在惠州双月湾开了一家民宿", via: "voice" });
    assert.equal(result.status, 200);
    assert.match(result.type, /text\/event-stream/);
    const order = result.events.map((item) => item.event);
    assert.equal(order[0], "intent");
    assert.equal(order[1], "meta");
    assert.equal(order.at(-1), "done");
    assert.ok(order.indexOf("sentence") > order.indexOf("meta"));
    assert.deepEqual(result.pick("intent")[0], { kind: "answer" });
    assert.equal(result.pick("meta")[0].topic, "who");
    assert.equal(result.pick("meta")[0].nextTopic, "offer");
    assert.equal(result.pick("meta")[0].isFollowup, false);
    assert.deepEqual(result.sentences.map((item) => item.kind), ["recap", "question"]);
    assert.match(result.sentences[0].text, /^记下了：/);
    assert.equal(questionMarks(result.sentences.map((item) => item.text).join("")), 1);
    assert.equal(result.done.coverage.who, true);
    assert.equal(result.done.recaps.who, "我叫阿岚，在惠州双月湾开了一家民宿");
    assert.equal(result.done.messages.at(-2).via, "voice");
    assert.equal(result.done.messages.at(-1).content, result.sentences.map((item) => item.text).join(""));
    assert.equal(result.done.source, "offline");
    assert.equal(result.done.fallback, false);
    assert.ok(result.done.draft.filled.includes("hero"), "流式回合同样会长出草稿");
    const events = JSON.parse(fs.readFileSync(path.join(dataDir, "events.json"), "utf8"));
    assert.ok(events.some((event) => event.type === "interview_turn" && event.stream === true && event.via === "voice"));
    assert.ok(events.some((event) => event.type === "voice_turn"));
  });
});

test("流式回合：最多追问两轮，第三次放行；聊完六个话题后不再提问", async () => {
  await withApp({}, async ({ base }) => {
    const { id, token } = await newSession(base);
    const first = await turn(base, id, token, { text: "做摄影的" });
    assert.equal(first.pick("meta")[0].followRound, 1);
    assert.equal(first.done.coverage.who, false);
    assert.deepEqual(first.sentences.map((item) => item.kind), ["question"], "追问时不复述");
    const second = await turn(base, id, token, { text: "不知道" });
    assert.equal(second.pick("meta")[0].followRound, 2);
    assert.notEqual(second.sentences.at(-1).text, first.sentences.at(-1).text);
    const third = await turn(base, id, token, { text: "随便" });
    assert.equal(third.pick("meta")[0].isFollowup, false);
    assert.equal(third.done.coverage.who, true);
    assert.equal(third.done.followups.who, 2);
    for (const answer of ["民宿摄影，299 元起，适合民宿老板", "2023 年给十家民宿拍过空间照", "小时候家里开小店，没有一张像样的照片，所以想让小店也有好看的照片", "微信 photo-wang，想找民宿主理人", "简约"]) {
      const next = await turn(base, id, token, { text: answer });
      assert.ok(questionMarks(next.done.messages.at(-1).content) <= 1);
    }
    const state = await api(base, "GET", `/api/sessions/${id}`, { token });
    assert.deepEqual(Object.values(state.json.coverage), [true, true, true, true, true, true]);
    assert.equal(questionMarks(state.json.messages.at(-1).content), 0);
    assert.match(state.json.messages.at(-1).content, /生成网站/);
  });
});

test("流式回合（大模型）：请求带流式与关思考开关，按句推送，只保留第一个问句", async () => {
  const mock = llmMock((body, res) => {
    sseReply(res, ["记下了：阿岚在", "双月湾开民宿。", "你能提供", "哪些服务？", "价格大概多少？", "还有呢？"]);
  });
  await new Promise((resolve) => mock.server.listen(0, "127.0.0.1", resolve));
  try {
    await withApp({ demoMode: false, llmApiKey: "test-key", llmBaseUrl: `http://127.0.0.1:${mock.server.address().port}/v1`, llmModel: "deepseek-v4.1-flash-1017" }, async ({ base }) => {
      const { id, token } = await newSession(base);
      const result = await turn(base, id, token, { text: "我叫阿岚，在惠州双月湾开了一家民宿", via: "voice" });
      assert.deepEqual(result.sentences.map((item) => item.text), ["记下了：阿岚在双月湾开民宿。", "你能提供哪些服务？"]);
      assert.deepEqual(result.sentences.map((item) => item.kind), ["recap", "question"]);
      assert.equal(result.done.source, "llm");
      assert.equal(result.done.fallback, false);
      assert.equal(result.done.recaps.who, "阿岚在双月湾开民宿", "摘要优先用大模型的复述");
      assert.equal(questionMarks(result.done.messages.at(-1).content), 1);
    });
  } finally {
    await new Promise((resolve) => mock.server.close(resolve));
  }
  assert.equal(mock.seen.length, 1, "一轮采访只调用一次大模型");
  const body = mock.seen[0];
  assert.equal(body.stream, true);
  assert.equal(body.model, "deepseek-v4.1-flash-1017");
  assert.equal(body.thinking.type, "disabled");
  assert.equal(body.chat_template_kwargs.enable_thinking, false);
  assert.match(body.messages[0].content, /只能有一个问号/);
  assert.match(body.messages[1].content, /我叫阿岚/);
});

test("流式回合（大模型）：没问出问题就补上题库问句；输出 JSON 也不会把花括号读出来", async () => {
  let mode = "no-question";
  const mock = llmMock((body, res) => {
    if (mode === "no-question") return sseReply(res, ["记下了：你做民宿摄影。", "听起来很不错。"]);
    return sseReply(res, ["{\"reply\":\"哪一段经历", "最想放在网站上？\",\"topic\":\"work\"}"]);
  });
  await new Promise((resolve) => mock.server.listen(0, "127.0.0.1", resolve));
  try {
    await withApp({ demoMode: false, llmApiKey: "test-key", llmBaseUrl: `http://127.0.0.1:${mock.server.address().port}/v1` }, async ({ base }) => {
      const { id, token } = await newSession(base);
      const first = await turn(base, id, token, { text: "我叫小王，在杭州做民宿摄影师" });
      assert.equal(first.sentences.at(-1).kind, "question");
      assert.equal(questionMarks(first.sentences.map((item) => item.text).join("")), 1);
      assert.equal(first.done.source, "llm");
      assert.equal(first.done.fallback, true);
      mode = "json";
      const second = await turn(base, id, token, { text: "民宿空间摄影，1200 元起，适合民宿老板" });
      assert.deepEqual(second.sentences.map((item) => item.text), ["哪一段经历最想放在网站上？"]);
      assert.equal(/[{}"]/.test(second.done.messages.at(-1).content), false);
    });
  } finally {
    await new Promise((resolve) => mock.server.close(resolve));
  }
});

test("流式回合：大模型报错时整轮降级到离线规则，流程不中断", async () => {
  const mock = llmMock((body, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "upstream" }));
  });
  await new Promise((resolve) => mock.server.listen(0, "127.0.0.1", resolve));
  try {
    await withApp({ demoMode: false, llmApiKey: "test-key", llmBaseUrl: `http://127.0.0.1:${mock.server.address().port}/v1` }, async ({ base, dataDir }) => {
      const { id, token } = await newSession(base);
      const result = await turn(base, id, token, { text: "我叫阿岚，在惠州双月湾开了一家民宿" });
      assert.equal(result.done.source, "offline");
      assert.equal(result.done.fallback, true);
      assert.deepEqual(result.sentences.map((item) => item.kind), ["recap", "question"]);
      assert.equal(result.done.coverage.who, true);
      const events = JSON.parse(fs.readFileSync(path.join(dataDir, "events.json"), "utf8"));
      assert.ok(events.some((event) => event.type === "llm_fallback" && event.agent === "interview"));
    });
  } finally {
    await new Promise((resolve) => mock.server.close(resolve));
  }
});

test("口令：跳过、返回、我说错了、再说一遍，语音和按钮两条路都能用", async () => {
  await withApp({}, async ({ base }) => {
    const { id, token } = await newSession(base);
    await turn(base, id, token, { text: "我叫王小明，在杭州做独立设计师" });
    // 跳过「能提供什么」
    const skipped = await turn(base, id, token, { text: "这个先跳过吧", via: "voice" });
    assert.deepEqual(skipped.pick("intent")[0], { kind: "command", command: "skip" });
    assert.equal(skipped.done.coverage.offer, true);
    assert.equal(skipped.done.skipped.offer, true);
    assert.match(skipped.sentences[0].text, /先跳过/);
    assert.equal(skipped.sentences.at(-1).kind, "question");
    assert.equal(skipped.done.messages.filter((message) => message.role === "user").length, 1, "口令本身不算回答");
    // 返回上一个话题：回到被跳过的「能提供什么」
    const back = await turn(base, id, token, { text: "返回上一个" });
    assert.equal(back.done.coverage.offer, false);
    assert.equal(back.done.skipped.offer, undefined);
    assert.match(back.sentences[0].text, /回到「能提供什么」/);
    // 回答之后说错了：撤回这句，重新问同一个话题
    const answered = await turn(base, id, token, { text: "品牌 logo 设计，3000 元起，适合刚起步的小店" });
    assert.equal(answered.done.coverage.offer, true);
    assert.ok(answered.done.draft.filled.includes("services"));
    const redo = await turn(base, id, token, { text: "我说错了" });
    assert.equal(redo.done.coverage.offer, false);
    assert.equal(redo.done.recaps.offer, undefined);
    assert.equal(redo.done.messages.filter((message) => message.retracted).length, 1);
    assert.equal(redo.done.draft.filled.includes("services"), false, "撤回的回答不再进入草稿");
    assert.match(redo.sentences[0].text, /不算/);
    // 再说一遍：只重复上一句，不改任何状态
    const before = redo.done.messages.length;
    const repeat = await turn(base, id, token, { text: "再说一遍" });
    assert.equal(repeat.sentences.map((item) => item.text).join(""), redo.done.messages.at(-1).content);
    assert.equal(repeat.done.messages.length, before);
    // 按钮入口
    const button = await api(base, "POST", `/api/sessions/${id}/commands`, { token, body: { command: "skip" } });
    assert.equal(button.status, 200);
    assert.equal(button.json.coverage.offer, true);
    assert.equal(button.json.sentences.at(-1).kind, "question");
    const bad = await api(base, "POST", `/api/sessions/${id}/commands`, { token, body: { command: "rm -rf" } });
    assert.equal(bad.status, 400);
    // 第一个话题时返回：不出错，继续问
    const fresh = await newSession(base);
    const first = await api(base, "POST", `/api/sessions/${fresh.id}/commands`, { token: fresh.token, body: { command: "back" } });
    assert.match(first.json.sentences[0].text, /第一个话题/);
    const nothing = await api(base, "POST", `/api/sessions/${fresh.id}/commands`, { token: fresh.token, body: { command: "redo" } });
    assert.match(nothing.json.sentences[0].text, /还没有可以更正/);
  });
});

test("生成、发布、修改由前端接着执行：流式回合只下发动作，不改会话", async () => {
  await withApp({}, async ({ base }) => {
    const { id, token } = await newSession(base, "demo");
    const generate = await turn(base, id, token, { text: "生成网站", via: "voice" });
    assert.deepEqual(generate.pick("action")[0], { action: "generate" });
    assert.equal(generate.sentences.length, 0);
    assert.equal(generate.done.profile, null);
    await api(base, "POST", `/api/sessions/${id}/profile`, { token });
    const count = (await api(base, "GET", `/api/sessions/${id}`, { token })).json.messages.length;
    const theme = await turn(base, id, token, { text: "换成简约风格" });
    assert.deepEqual(theme.pick("action")[0], { action: "edit", instruction: "风格换成简约", section: "" });
    const scoped = await turn(base, id, token, { text: "价格写清楚一点", section: "services" });
    assert.equal(scoped.pick("action")[0].section, "services");
    assert.match(scoped.pick("action")[0].instruction, /只修改「我能提供」/);
    const evil = await turn(base, id, token, { text: "价格写清楚一点", section: "<script>" });
    assert.equal(evil.pick("action")[0].section, "", "不认识的区块名会被忽略");
    const publish = await turn(base, id, token, { text: "发布" });
    assert.deepEqual(publish.pick("action")[0], { action: "publish" });
    assert.equal((await api(base, "GET", `/api/sessions/${id}`, { token })).json.messages.length, count);
    // 区块修改真正执行后，只有被点名的版块相关字段变化
    const applied = await api(base, "POST", `/api/sessions/${id}/edits`, { token, body: { instruction: theme.pick("action")[0].instruction } });
    assert.equal(applied.json.profile.theme, "simple");
  });
});

test("流式回合需要编辑密钥，空内容和超长内容以普通 JSON 报错", async () => {
  await withApp({}, async ({ base }) => {
    const { id, token } = await newSession(base);
    const denied = await turn(base, id, "wrong-token", { text: "你好" });
    assert.equal(denied.status, 401);
    assert.match(denied.type, /application\/json/);
    const empty = await turn(base, id, token, { text: "   " });
    assert.equal(empty.status, 400);
    const long = await turn(base, id, token, { text: "长".repeat(4001) });
    assert.equal(long.status, 400);
    const state = await api(base, "GET", `/api/sessions/${id}`, { token });
    assert.equal(state.json.messages.length, 1, "报错的请求不会留下半截对话");
  });
});

test("服务端语音接口：默认未配置返回 501，接入实现后可用，且都要求会话密钥", async () => {
  await withApp({}, async ({ base }) => {
    const { id, token } = await newSession(base);
    const config = await api(base, "GET", "/api/voice/config");
    assert.equal(config.json.asr.server, false);
    assert.equal(config.json.tts.server, false);
    assert.equal(config.json.followupMax, 2);
    const asr = await fetch(`${base}/api/asr?sid=${id}`, { method: "POST", headers: { "X-Edit-Token": token, "Content-Type": "audio/webm" }, body: Buffer.alloc(400, 1) });
    assert.equal(asr.status, 501);
    assert.equal((await asr.json()).code, "asr_not_configured");
    const tts = await api(base, "POST", `/api/tts?sid=${id}`, { token, body: { text: "你好" } });
    assert.equal(tts.status, 501);
    assert.equal(tts.json.code, "tts_not_configured");
    const anonymous = await fetch(`${base}/api/asr?sid=${id}`, { method: "POST", headers: { "Content-Type": "audio/webm" }, body: Buffer.alloc(400, 1) });
    assert.equal(anonymous.status, 401);
  });
  const heard = [];
  await withApp({
    asrProvider: { async transcribe(buffer, meta) { heard.push({ bytes: buffer.length, mime: meta.mime }); return { text: " 我叫阿岚 " }; } },
    ttsProvider: { async synthesize(text) { if (text === "坏") throw new Error("boom"); return { audio: Buffer.from("fake-audio"), mime: "audio/mpeg" }; } },
  }, async ({ base }) => {
    const { id, token } = await newSession(base);
    assert.equal((await api(base, "GET", "/api/voice/config")).json.asr.server, true);
    const asr = await fetch(`${base}/api/asr?sid=${id}`, { method: "POST", headers: { "X-Edit-Token": token, "Content-Type": "audio/webm;codecs=opus" }, body: Buffer.alloc(500, 1) });
    assert.equal(asr.status, 200);
    assert.deepEqual(await asr.json(), { text: "我叫阿岚" });
    assert.deepEqual(heard, [{ bytes: 500, mime: "audio/webm" }]);
    const tiny = await fetch(`${base}/api/asr?sid=${id}`, { method: "POST", headers: { "X-Edit-Token": token, "Content-Type": "audio/webm" }, body: Buffer.alloc(10, 1) });
    assert.equal(tiny.status, 400);
    const tts = await fetch(`${base}/api/tts?sid=${id}`, { method: "POST", headers: { "X-Edit-Token": token, "Content-Type": "application/json" }, body: JSON.stringify({ text: "你好" }) });
    assert.equal(tts.status, 200);
    assert.equal(tts.headers.get("content-type"), "audio/mpeg");
    assert.equal(Buffer.from(await tts.arrayBuffer()).toString(), "fake-audio");
    const broken = await api(base, "POST", `/api/tts?sid=${id}`, { token, body: { text: "坏" } });
    assert.equal(broken.status, 502);
    const long = await api(base, "POST", `/api/tts?sid=${id}`, { token, body: { text: "长".repeat(301) } });
    assert.equal(long.status, 400);
  });
});
