"use strict";

const { runAgent, streamInterview, ruleRecap } = require("../agent");
const { IMPORT_PROMPT, questionFor, TOPIC_LABELS } = require("../agent/prompts");
const { classifyUtterance } = require("../voice/intent");
const { splitSentences } = require("../voice/sentences");
const { isJailbreak, evidenceScore, matchFaq, handoffAnswer, refusalAnswer } = require("../agent/offline");
const {
  blankCoverage,
  coverageFromText,
  mergeCoverage,
  firstMissingTopic,
  normalizeProfile,
  stripPrivateNotes,
  extractProfileFromText,
  applyEdit,
  inferTheme,
  DEMO_IMPORT,
  TOPIC_IDS,
} = require("../profile");
const { isSafeSlug, slugFromName, tokenEquals } = require("../security");
const { EXAMPLE_SLUG, isExampleAlias } = require("../seed");
const { qrSvg } = require("../qr");
const { draftFromTurns } = require("../draft");

// 同一话题最多追问两轮；两轮后仍然笼统就先往下走，不卡住用户。
const FOLLOWUP_MAX = 2;

const SECTION_LABELS = {
  hero: "名字与身份",
  about: "关于我",
  services: "我能提供",
  highlights: "经历与作品",
  story: "我的故事",
  seeking: "我在寻找",
  contacts: "联系方式",
};

const COMPLETE_LINE = "六个话题都聊到了。说「生成网站」，我就按你说过的事实整理成网页。";

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function isVague(text) {
  const value = String(text || "").trim();
  if (value.length < 8) return true;
  if (/^(做摄影的|摄影|民宿|还行|不知道|随便|都可以|一般|没有|嗯+|哦+|好的?|是的?|就这样|就这些)$/.test(value)) return true;
  if (value.length <= 12 && !/[，,。.!！？?\d]/.test(value)) return true;
  return false;
}

function oneQuestion(text, fallback) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  const matched = raw.match(/^.*?[？?]/);
  if (!matched) return fallback;
  return matched[0].trim();
}

function countQuestions(text) {
  return (String(text || "").match(/[？?]/g) || []).length;
}

function createService(store, config) {
  function ownerSession(session) {
    return {
      id: session.id,
      mode: session.mode,
      source: session.source || "",
      demo: !!session.demo,
      coverage: session.coverage,
      followups: session.followups,
      messages: session.messages,
      imports: session.imports.map((item) => ({ kind: item.kind, text: item.rawText, isPublic: false, at: item.at })),
      profile: session.profile,
      slug: session.slug || "",
      published: !!session.published,
      url: session.slug ? `/u/${encodeURIComponent(session.slug)}` : "",
      lastChanged: session.lastChanged || [],
      fallback: !!session.lastFallback,
      sourceAgent: session.lastSource || "",
      draft: draftSummary(session),
      recaps: session.recaps || {},
      skipped: session.skipped || {},
      followupMax: FOLLOWUP_MAX,
    };
  }

  function draftSummary(session) {
    const result = draftOf(session);
    return { filled: result.filled, name: result.profile.name, theme: result.profile.theme };
  }

  function draftOf(session) {
    return draftFromTurns({ messages: liveMessages(session), imported: importText(session) });
  }

  function draft(id, token) {
    const session = requireSession(id, token);
    const result = draftOf(session);
    return { profile: result.profile, filled: result.filled, generated: !!session.profile };
  }

  function requireSession(id, token) {
    const session = store.getSession(id);
    if (!session) throw fail(404, "找不到这个创作会话。");
    if (!tokenEquals(session.editToken, token)) throw fail(401, "没有编辑权限。请使用自己的会话链接。");
    return session;
  }

  function createSession({ mode = "interview", source = "direct", ref = "" } = {}) {
    const id = store.newId(9);
    const editToken = store.newId(18);
    const demo = mode === "demo";
    const session = {
      id,
      editToken,
      mode: demo ? "demo" : mode === "import" ? "import" : "interview",
      source: source || "direct",
      ref: String(ref || "").slice(0, 80),
      demo,
      messages: [],
      imports: [],
      coverage: blankCoverage(),
      followups: {},
      profile: null,
      slug: "",
      published: false,
      lastChanged: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (demo) {
      session.imports.push({ rawText: DEMO_IMPORT, isPublic: false, kind: "示例", at: Date.now() });
      session.coverage = mergeCoverage(session.coverage, coverageFromText(DEMO_IMPORT));
      session.messages.push({
        role: "assistant",
        content: "这是一份示例：双月湾民宿主理人阿岚从其他 AI 导入的「关于我」。原文只在这个会话里可见。六个话题都齐了，可以直接生成网站。",
        topic: "",
        isFollowup: false,
        at: Date.now(),
      });
    } else {
      session.messages.push({
        role: "assistant",
        content: questionFor("who", false),
        topic: "who",
        isFollowup: false,
        at: Date.now(),
      });
    }
    session.updatedAt = Date.now();
    store.saveSession(session);
    store.addEvent({ type: "session_start", mode: session.mode, source: session.source, ref: session.ref, sessionId: id });
    if (demo) store.addEvent({ type: "demo_start", sessionId: id });
    return {
      id,
      editToken,
      workbenchUrl: `/workbench.html?sid=${encodeURIComponent(id)}&key=${encodeURIComponent(editToken)}`,
      session: ownerSession(session),
    };
  }

  async function sendMessage(id, token, text, via) {
    const session = requireSession(id, token);
    const answer = String(text || "").trim();
    const channel = via === "voice" ? "voice" : "text";
    if (!answer) throw fail(400, "请先写下你的回答。");
    if (answer.length > 4000) throw fail(400, "这段回答太长了，请收在 4000 字以内。");
    const { topic, follow, round } = applyAnswer(session, answer, channel);

    let reply;
    let source = "offline";
    let fallback = false;
    if (!follow && !firstMissingTopic(session.coverage)) {
      reply = "六个话题都覆盖到了。点「生成网站」，我会按你说过的事实整理档案。";
    } else {
      const nextTopic = follow ? topic : firstMissingTopic(session.coverage);
      const agent = await runAgent("interview", {
        topic: nextTopic,
        follow: round,
        answer,
        transcript: transcriptOf(session),
        imported: importText(session),
      }, config);
      source = agent.source;
      fallback = !!agent.fallback;
      reply = oneQuestion(agent.reply, questionFor(nextTopic, round));
      if (countQuestions(reply) !== 1) reply = questionFor(nextTopic, round);
    }
    session.messages.push({ role: "assistant", content: reply, topic, isFollowup: follow, at: Date.now() });
    session.lastSource = source;
    session.lastFallback = fallback;
    session.updatedAt = Date.now();
    store.saveSession(session);
    store.addEvent({ type: "interview_turn", sessionId: id, topic, isFollowup: follow, coverage: session.coverage, via: channel });
    if (channel === "voice") store.addEvent({ type: "voice_turn", sessionId: id, topic, length: answer.length });
    if (fallback) store.addEvent({ type: "llm_fallback", agent: "interview", sessionId: id });
    return { ...ownerSession(session), isFollowup: follow, source, fallback, via: channel };
  }

  // 记下一句回答：判断要不要追问（最多 FOLLOWUP_MAX 轮），并更新话题覆盖与一句话摘要。
  function applyAnswer(session, answer, channel) {
    const topic = firstMissingTopic(session.coverage) || "style";
    const vague = isVague(answer) && !(topic === "style" && inferTheme(answer));
    const used = session.followups[topic] || 0;
    const follow = vague && used < FOLLOWUP_MAX;
    session.messages.push({ role: "user", content: answer, topic, via: channel, at: Date.now() });
    session.recaps = session.recaps || {};
    session.skipped = session.skipped || {};
    if (follow) {
      session.followups[topic] = used + 1;
    } else {
      session.coverage[topic] = true;
      delete session.skipped[topic];
      session.recaps[topic] = recapText(ruleRecap(topicAnswers(session, topic)));
    }
    return { topic, follow, round: follow ? used + 1 : 0 };
  }

  function topicAnswers(session, topic) {
    return liveMessages(session).filter((message) => message.role === "user" && message.topic === topic).map((message) => message.content).join("，");
  }

  function emitLines(lines, emit) {
    lines.forEach((item, index) => emit("sentence", { index, text: item.text, kind: item.kind }));
  }

  function finishTurn(session, id, extra) {
    session.updatedAt = Date.now();
    store.saveSession(session);
    return { ...ownerSession(session), ...extra };
  }

  /**
   * 流式的一轮对话（语音工作室用）。通过 emit(event, data) 依次推送：
   *   intent   这句话被理解成什么（回答 / 口令 / 修改）
   *   meta     本轮话题、是否追问、最新进度
   *   sentence 采访官要说的话，一句一条，可以边收边读
   *   action   需要前端接着做的动作（生成 / 发布 / 修改 / 暂停）
   *   done     本轮结束后的完整会话
   */
  async function turn(id, token, input, emit, signal) {
    const session = requireSession(id, token);
    const text = String(input?.text || "").trim();
    const channel = input?.via === "voice" ? "voice" : "text";
    if (!text) throw fail(400, "请先说点什么，或者写下你的回答。");
    if (text.length > 4000) throw fail(400, "这段回答太长了，请收在 4000 字以内。");
    const section = SECTION_LABELS[input?.section] ? input.section : "";
    const intent = classifyUtterance(text, {
      hasProfile: !!session.profile,
      complete: !firstMissingTopic(session.coverage),
      topic: firstMissingTopic(session.coverage),
      section,
      sectionLabel: SECTION_LABELS[section],
    });
    emit("intent", intent);

    if (intent.kind === "edit") {
      emit("action", { action: "edit", instruction: intent.instruction, section: intent.section || "" });
      return { ...ownerSession(session), intent, via: channel };
    }
    if (intent.kind === "command") {
      store.addEvent({ type: "voice_command", sessionId: id, command: intent.command, via: channel });
      if (["generate", "publish", "stop"].includes(intent.command)) {
        emit("action", { action: intent.command });
        return { ...ownerSession(session), intent, via: channel };
      }
      return runCommand(session, id, intent.command, emit, { intent, via: channel });
    }

    const { topic, follow, round } = applyAnswer(session, text, channel);
    const nextTopic = follow ? topic : firstMissingTopic(session.coverage);
    emit("meta", { topic, nextTopic, isFollowup: follow, followRound: round, coverage: session.coverage, recap: session.recaps[topic] || "" });
    let result;
    if (!nextTopic) {
      const recap = ruleRecap(text);
      const lines = [recap && { text: recap, kind: "recap" }, { text: COMPLETE_LINE, kind: "info" }].filter(Boolean);
      emitLines(lines, emit);
      result = { sentences: lines, reply: lines.map((item) => item.text).join(""), recap, source: "offline", fallback: false };
    } else {
      result = await streamInterview({
        topic: nextTopic,
        follow: round,
        answer: text,
        answeredTopic: topic,
        transcript: transcriptOf(session),
        imported: importText(session),
      }, config, {
        signal,
        onSentence: (item, index) => emit("sentence", { index, text: item.text, kind: item.kind }),
      });
    }
    // 大模型给出的复述比规则截断更通顺：有就用它做这个话题的一句话摘要。
    if (!follow && result.source === "llm" && result.recap) session.recaps[topic] = recapText(result.recap);
    session.messages.push({ role: "assistant", content: result.reply, topic, isFollowup: follow, at: Date.now() });
    session.lastSource = result.source;
    session.lastFallback = !!result.fallback;
    store.addEvent({ type: "interview_turn", sessionId: id, topic, isFollowup: follow, followRound: round, coverage: session.coverage, via: channel, stream: true });
    if (channel === "voice") store.addEvent({ type: "voice_turn", sessionId: id, topic, length: text.length });
    if (result.fallback) store.addEvent({ type: "llm_fallback", agent: "interview", sessionId: id });
    return finishTurn(session, id, { intent, isFollowup: follow, followRound: round, source: result.source, fallback: !!result.fallback, via: channel });
  }

  // 口令：跳过 / 返回 / 我说错了 / 再说一遍。全部走规则，不调用大模型，立刻有反应。
  function runCommand(session, id, command, emit, extra) {
    session.recaps = session.recaps || {};
    session.skipped = session.skipped || {};
    const current = firstMissingTopic(session.coverage);
    let lines;
    let topic = current;
    if (command === "repeat") {
      const last = [...session.messages].reverse().find((message) => message.role === "assistant");
      const said = splitSentences(last ? last.content : questionFor(current || "who", 0));
      emitLines(said.map((text) => ({ text, kind: "repeat" })), emit);
      return { ...ownerSession(session), ...extra };
    }
    if (command === "skip") {
      if (!current) {
        lines = [{ text: "已经没有要聊的话题了。", kind: "ack" }, { text: COMPLETE_LINE, kind: "info" }];
      } else {
        session.coverage[current] = true;
        session.skipped[current] = true;
        session.recaps[current] = "";
        const next = firstMissingTopic(session.coverage);
        lines = [{ text: `好，「${TOPIC_LABELS[current]}」先跳过，之后想补随时说。`, kind: "ack" }];
        lines.push(next ? { text: questionFor(next, 0), kind: "question" } : { text: COMPLETE_LINE, kind: "info" });
      }
    } else if (command === "back") {
      const index = current ? TOPIC_IDS.indexOf(current) : TOPIC_IDS.length;
      const previous = TOPIC_IDS.slice(0, index).reverse().find((item) => session.coverage[item]);
      if (!previous) {
        lines = [{ text: "这已经是第一个话题了。", kind: "ack" }, { text: questionFor(current || "who", 0), kind: "question" }];
      } else {
        topic = previous;
        session.coverage[previous] = false;
        session.followups[previous] = 0;
        delete session.skipped[previous];
        delete session.recaps[previous];
        lines = [{ text: `好，回到「${TOPIC_LABELS[previous]}」，想补充或者重说都可以。`, kind: "ack" }, { text: questionFor(previous, 0), kind: "question" }];
      }
    } else if (command === "redo") {
      const last = [...session.messages].reverse().find((message) => message.role === "user" && !message.retracted && !message.command);
      if (!last) {
        lines = [{ text: "还没有可以更正的回答。", kind: "ack" }, { text: questionFor(current || "who", 0), kind: "question" }];
      } else {
        last.retracted = true;
        topic = last.topic || current || "who";
        session.coverage[topic] = false;
        session.followups[topic] = 0;
        delete session.skipped[topic];
        delete session.recaps[topic];
        lines = [{ text: "没关系，刚才那句不算。", kind: "ack" }, { text: questionFor(topic, 0), kind: "question" }];
      }
    } else {
      throw fail(400, "没有这个口令。");
    }
    emitLines(lines, emit);
    session.messages.push({ role: "assistant", content: lines.map((item) => item.text).join(""), topic: topic || "", isFollowup: false, command, at: Date.now() });
    return finishTurn(session, id, extra);
  }

  // 给按钮用的口令入口（不走流式）：返回会话与要说的句子。
  function command(id, token, name) {
    const session = requireSession(id, token);
    if (!["skip", "back", "redo", "repeat"].includes(name)) throw fail(400, "没有这个口令。");
    const sentences = [];
    store.addEvent({ type: "voice_command", sessionId: id, command: name, via: "button" });
    const result = runCommand(session, id, name, (event, data) => { if (event === "sentence") sentences.push(data); }, { command: name });
    return { ...result, sentences };
  }

  async function addImport(id, token, text, kind) {
    const session = requireSession(id, token);
    const raw = String(text || "").trim();
    if (raw.length < 4) throw fail(400, "请把从其他 AI 复制来的文字粘贴进来。");
    if (raw.length > 20000) throw fail(400, "导入内容太长了，请先让对方 AI 写成一段总结。");
    session.imports.push({ rawText: raw, isPublic: false, kind: kind || "ai", at: Date.now() });
    session.mode = session.mode === "demo" ? "demo" : "import";
    session.coverage = mergeCoverage(session.coverage, coverageFromText(raw));
    const missing = firstMissingTopic(session.coverage);
    let source = "offline";
    let fallback = false;
    let reply;
    if (!missing) {
      reply = "资料已经覆盖六个话题，原文不会出现在公开网站上。可以点「生成网站」。";
    } else {
      const agent = await runAgent("interview", {
        topic: missing,
        follow: false,
        answer: "",
        transcript: transcriptOf(session),
        imported: importText(session),
      }, config);
      source = agent.source;
      fallback = !!agent.fallback;
      reply = oneQuestion(agent.reply, `资料先放在这里，原文不公开。还差「${labelOf(missing)}」。${questionFor(missing, false)}`);
      if (countQuestions(reply) !== 1) reply = questionFor(missing, false);
    }
    session.messages.push({ role: "assistant", content: reply, topic: missing, isFollowup: false, at: Date.now() });
    session.lastSource = source;
    session.lastFallback = fallback;
    session.updatedAt = Date.now();
    store.saveSession(session);
    store.addEvent({ type: "import_submit", sessionId: id, kind: kind || "ai", length: raw.length });
    return { ...ownerSession(session), source, fallback };
  }

  async function generateProfile(id, token) {
    const session = requireSession(id, token);
    const agent = await runAgent("organize", {
      transcript: transcriptOf(session),
      imported: importText(session),
      turns: liveMessages(session).filter((message) => message.role === "user"),
    }, config);
    let profile = stripPrivateNotes(normalizeProfile(agent.profile), session.imports);
    if (!profile.name) {
      const extracted = stripPrivateNotes(extractProfileFromText(`${importText(session)}\n${transcriptOf(session)}`), session.imports);
      if (extracted.name) profile = extracted;
    }
    if (!profile.name) throw fail(400, "还不知道怎么称呼你。请先告诉我名字，或在导入资料里写上「我是……」。");
    session.profile = profile;
    session.lastChanged = ["profile"];
    session.lastSource = agent.source;
    session.lastFallback = !!agent.fallback;
    session.updatedAt = Date.now();
    if (session.slug) syncSite(session);
    store.saveSession(session);
    store.addEvent({ type: "profile_generated", sessionId: id, theme: profile.theme, source: agent.source });
    if (agent.fallback) store.addEvent({ type: "llm_fallback", agent: "organize", sessionId: id });
    return { ...ownerSession(session), source: agent.source, fallback: !!agent.fallback, changed: session.lastChanged };
  }

  async function editProfile(id, token, instruction) {
    const session = requireSession(id, token);
    const text = String(instruction || "").trim();
    if (!text) throw fail(400, "请用一句话说明要改什么。");
    if (!session.profile) throw fail(400, "请先生成网站，再做修改。");
    const before = normalizeProfile(session.profile);
    const agent = await runAgent("edit", { profile: before, instruction: text }, config);
    const guarded = applyEdit(before, stripPrivateNotes(normalizeProfile(agent.profile), session.imports), text);
    session.profile = guarded.profile;
    session.lastChanged = guarded.changed;
    session.lastSource = agent.source;
    session.lastFallback = !!agent.fallback;
    session.updatedAt = Date.now();
    if (session.slug) syncSite(session);
    store.saveSession(session);
    store.addEvent({ type: "edit_submit", sessionId: id, intent: guarded.intent, changed: guarded.changed });
    if (agent.fallback) store.addEvent({ type: "llm_fallback", agent: "edit", sessionId: id });
    return { ...ownerSession(session), source: agent.source, fallback: !!agent.fallback, changed: guarded.changed, calls: 1 };
  }

  function allocateSlug(desired, sessionId) {
    const base = slugFromName(desired);
    let slug = base;
    let n = 2;
    while (n < 40) {
      const existing = store.getSite(slug);
      if (!existing || existing.sessionId === sessionId) return slug;
      slug = `${base}-${n}`;
      n += 1;
    }
    throw fail(409, "这个名字的网址太挤了，请换一个网址名。");
  }

  function syncSite(session) {
    const existing = store.getSite(session.slug);
    const site = {
      slug: session.slug,
      sessionId: session.id,
      profile: normalizeProfile(session.profile),
      example: !!session.demo,
      publishedAt: existing?.publishedAt || Date.now(),
      updatedAt: Date.now(),
      visits: existing?.visits || 0,
      avatarAsks: existing?.avatarAsks || 0,
    };
    store.saveSite(site);
    return site;
  }

  async function publish(id, token, desired, baseUrl) {
    const session = requireSession(id, token);
    if (!session.profile) throw fail(400, "请先生成网站，再发布。");
    if (session.slug && store.getSite(session.slug)?.sessionId === session.id && !desired) {
      const site = syncSite(session);
      return publishPayload(session, site, baseUrl);
    }
    const wanted = String(desired || session.profile.name || "").trim();
    if (desired && slugFromName(wanted) === "site" && !/[\p{L}\p{N}]/u.test(wanted)) {
      throw fail(400, "网址名只能使用中文、字母、数字、下划线或连字符。");
    }
    const slug = allocateSlug(wanted, session.id);
    session.slug = slug;
    session.published = true;
    const site = syncSite(session);
    store.saveSession(session);
    store.addEvent({ type: "site_published", sessionId: id, slug, theme: session.profile.theme });
    return publishPayload(session, site, baseUrl);
  }

  function publishPayload(session, site, baseUrl) {
    const url = `/u/${encodeURIComponent(site.slug)}`;
    const origin = String(baseUrl || config.publicBaseUrl || "").replace(/\/$/, "");
    let qr = "";
    try {
      qr = qrSvg(`${origin}${url}`);
    } catch {
      qr = "";
    }
    return {
      ...ownerSession(session),
      slug: site.slug,
      url,
      qr,
      profileUrl: `${url}/profile.json`,
      llmsUrl: `${url}/llms.txt`,
    };
  }

  async function ask(slug, question) {
    if (!isSafeSlug(slug)) throw fail(404, "没有这个网站。");
    const site = store.getSite(slug);
    if (!site) throw fail(404, "没有这个网站。");
    const q = String(question || "").trim();
    if (!q) throw fail(400, "请先写下想问的问题。");
    if (q.length > 300) throw fail(400, "问题请收在 300 字以内。");
    const profile = normalizeProfile(site.profile);
    let answer;
    let answeredFrom;
    let source = "offline";
    let fallback = false;
    if (isJailbreak(q)) {
      answer = refusalAnswer();
      answeredFrom = "refused";
    } else {
      const agent = await runAgent("avatar", { profile, question: q }, config);
      source = agent.source;
      fallback = !!agent.fallback;
      const faq = matchFaq(q, profile.faq);
      const grounded = evidenceScore(q, profile) >= 0.34;
      if (!grounded) {
        answer = handoffAnswer(profile);
        answeredFrom = "handoff";
      } else if (faq && !String(agent.answer || "").includes(String(faq.a).slice(0, 8))) {
        answer = faq.a;
        answeredFrom = "faq";
      } else {
        answer = String(agent.answer || "").trim() || handoffAnswer(profile);
        answeredFrom = agent.answered_from || (faq ? "faq" : "profile");
        if (/档案里没有|不知道|无法回答|不能替/.test(answer)) answeredFrom = "handoff";
      }
    }
    site.avatarAsks = (site.avatarAsks || 0) + 1;
    store.saveSite(site);
    store.addEvent({ type: "avatar_ask", slug, answered_from: answeredFrom });
    if (answeredFrom === "handoff") store.addEvent({ type: "avatar_handoff", slug });
    if (fallback) store.addEvent({ type: "llm_fallback", agent: "avatar", slug });
    return {
      answer,
      answered_from: answeredFrom,
      label: "AI 生成",
      source,
      fallback,
      contacts: profile.contacts,
    };
  }

  function discover(query) {
    const q = String(query || "").trim().toLowerCase();
    const sites = store.listSites();
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];
    const results = sites
      .filter((site) => {
        if (!terms.length) return true;
        const blob = searchBlob(site).toLowerCase();
        return terms.every((term) => blob.includes(term));
      })
      .map((site) => cardOf(site))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return { query: q, results, empty: results.length === 0 };
  }

  function recordVisit(slug) {
    const site = getPublicSite(slug);
    if (!site) return null;
    site.visits = (site.visits || 0) + 1;
    store.saveSite(site);
    store.addEvent({ type: "site_visit", slug: site.slug });
    return site;
  }

  function stats(slug) {
    const site = store.getSite(slug);
    if (!site) throw fail(404, "没有这个网站。");
    return { slug, visits: site.visits || 0, avatarAsks: site.avatarAsks || 0 };
  }

  function getPublicSite(slug) {
    if (!isSafeSlug(slug)) return null;
    const direct = store.getSite(slug);
    if (direct) return direct;
    if (isExampleAlias(slug)) {
      const example = store.getSite(EXAMPLE_SLUG);
      if (example && example.example) return example;
    }
    return null;
  }

  return {
    createSession,
    sendMessage,
    turn,
    command,
    addImport,
    generateProfile,
    editProfile,
    publish,
    ask,
    discover,
    recordVisit,
    stats,
    getPublicSite,
    requireSession,
    ownerSession,
    draft,
    importPrompt: IMPORT_PROMPT,
  };
}

// 说错后撤回的回答不参与草稿、整理和复述。
function liveMessages(session) {
  return session.messages.filter((message) => !message.retracted);
}

function recapText(recap) {
  return String(recap || "").replace(/^记下了[：:]\s*/, "").replace(/[。.]\s*$/, "").trim();
}

function transcriptOf(session) {
  return liveMessages(session)
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n");
}

function importText(session) {
  return session.imports.map((item) => item.rawText).join("\n\n");
}

function labelOf(topic) {
  return ({ who: "你是谁", offer: "能提供什么", work: "经历与作品", story: "你的故事", seek: "联系与寻找", style: "网站风格" })[topic] || topic;
}

function searchBlob(site) {
  const profile = normalizeProfile(site.profile);
  return [
    profile.name,
    profile.title,
    profile.tagline,
    profile.city,
    profile.about,
    profile.story,
    profile.tags.join(" "),
    profile.services.map((item) => `${item.name} ${item.description} ${item.price}`).join(" "),
    profile.seeking.map((item) => item.who).join(" "),
    profile.highlights.map((item) => `${item.title} ${item.description}`).join(" "),
  ].join("\n");
}

function cardOf(site) {
  const profile = normalizeProfile(site.profile);
  return {
    slug: site.slug,
    url: `/u/${encodeURIComponent(site.slug)}`,
    name: profile.name,
    title: profile.title,
    city: profile.city,
    tags: profile.tags.slice(0, 4),
    services: profile.services.slice(0, 2).map((item) => ({ name: item.name, price: item.price })),
    example: !!site.example,
    theme: profile.theme,
    updatedAt: site.updatedAt || site.publishedAt || 0,
  };
}

module.exports = { createService, isVague, oneQuestion, countQuestions, TOPIC_IDS, FOLLOWUP_MAX, SECTION_LABELS };
