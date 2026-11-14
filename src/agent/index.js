"use strict";

const prompts = require("./prompts");
const { chatComplete, chatStream, parseJsonLoose } = require("./llm");
const { createSentenceSplitter, isQuestion } = require("../voice/sentences");
const offline = require("./offline");

function parseInterview(raw, topic, follow) {
  try {
    const data = parseJsonLoose(raw);
    if (data && data.reply) return { reply: String(data.reply), topic: data.topic || topic, is_followup: !!data.is_followup, coverage: data.coverage || {} };
  } catch {
    if (/[？?]/.test(raw || "")) return { reply: String(raw), topic, is_followup: !!follow, coverage: {} };
  }
  return null;
}

function parseOrganize(raw) {
  const data = parseJsonLoose(raw);
  return { profile: data.profile && data.profile.name ? data.profile : data };
}

function parseEdit(raw) {
  const data = parseJsonLoose(raw);
  return { profile: data.profile && data.profile.name ? data.profile : data };
}

function parseAvatar(raw) {
  try {
    const data = parseJsonLoose(raw);
    if (data && data.answer) return { answer: String(data.answer), answered_from: data.answered_from || "profile" };
  } catch {
    if (String(raw || "").trim()) return { answer: String(raw).trim(), answered_from: "profile" };
  }
  return null;
}

async function runAgent(kind, input, config) {
  const forceOffline = config.demoMode || !config.llmApiKey;
  if (forceOffline) {
    const result = offlineResult(kind, input);
    return { ...result, source: "offline", fallback: false };
  }
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const messages = messagesFor(kind, input);
      const maxTokens = kind === "organize" || kind === "edit" ? 3500 : 800;
      const raw = await chatComplete({
        baseUrl: config.llmBaseUrl,
        apiKey: config.llmApiKey,
        model: config.llmModel,
        messages,
        maxTokens,
        fetchImpl: config.fetchImpl,
      });
      const parsed = parseResult(kind, raw, input);
      if (!parsed) throw Object.assign(new Error("parse"), { code: "parse" });
      return { ...parsed, source: "llm", fallback: false };
    } catch (error) {
      lastError = error;
    }
  }
  const result = offlineResult(kind, input);
  return { ...result, source: "offline", fallback: true, fallbackReason: lastError?.code || "error" };
}

function messagesFor(kind, input) {
  if (kind === "interview") return prompts.interviewMessages(input);
  if (kind === "organize") return prompts.organizeMessages(input);
  if (kind === "edit") return prompts.editMessages(input);
  if (kind === "avatar") return prompts.avatarMessages(input);
  throw new Error("agent");
}

function offlineResult(kind, input) {
  if (kind === "interview") return offline.offlineInterview(input);
  if (kind === "organize") return offline.offlineOrganize(input);
  if (kind === "edit") return offline.offlineEdit(input);
  if (kind === "avatar") return offline.offlineAvatar(input);
  throw new Error("agent");
}

function parseResult(kind, raw, input) {
  if (kind === "interview") return parseInterview(raw, input.topic, input.follow);
  if (kind === "organize") return parseOrganize(raw);
  if (kind === "edit") return parseEdit(raw);
  if (kind === "avatar") return parseAvatar(raw);
  return null;
}

// ---------------------------------------------------------------- 流式采访

const FILLERS = /(嗯+|呃+|啊+|那个|就是说|然后呢|对吧|的话呢)[，,、\s]*/g;

// 不调用大模型的一句话复述：去掉口头语，截到 30 个字以内。
function ruleRecap(answer) {
  const tidy = String(answer || "").replace(FILLERS, "").replace(/\s+/g, " ").replace(/[。！？!?；;，,、\s]+$/, "").trim();
  if (!tidy) return "";
  const chars = Array.from(tidy);
  return `记下了：${chars.length > 30 ? `${chars.slice(0, 30).join("")}…` : tidy}。`;
}

function cleanSentence(text) {
  return String(text || "")
    .replace(/^[\s"'“”「」『』*#>\-]+/, "")
    .replace(/["'“”*]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 流式采访官：一句一句地产出「复述 + 一个问句」。
 * 规则由这里强制，不依赖模型自觉：
 *   - 最多两句陈述，问句只能有一个，出现问句就立刻停；
 *   - 模型没问出问题、或中途断了，就补上规则题库里的问句；
 *   - 一个字都没拿到就整轮降级到离线规则，流程不中断。
 * @returns {Promise<{sentences:{text:string,kind:string}[], reply:string, recap:string, question:string, source:string, fallback:boolean, fallbackReason?:string}>}
 */
async function streamInterview(input, config, { onSentence, signal } = {}) {
  const round = input.follow === true ? 1 : Number(input.follow) || 0;
  const fallbackQuestion = prompts.questionFor(input.topic, round);
  const sentences = [];
  const emit = (text, kind) => {
    const item = { text, kind };
    sentences.push(item);
    if (onSentence) onSentence(item, sentences.length - 1);
  };
  const finish = (source, fallback, reason) => {
    const question = sentences.find((item) => item.kind === "question")?.text || "";
    const recap = sentences.filter((item) => item.kind !== "question").map((item) => item.text).join("");
    const out = { sentences, reply: sentences.map((item) => item.text).join(""), recap, question, source, fallback };
    if (reason) out.fallbackReason = reason;
    return out;
  };
  const offlineTurn = (fallback, reason) => {
    const recap = !round && input.answer ? ruleRecap(input.answer) : "";
    if (recap) emit(recap, "recap");
    emit(fallbackQuestion, "question");
    return finish("offline", fallback, reason);
  };

  if (config.demoMode || !config.llmApiKey) return offlineTurn(false);

  const stopper = new AbortController();
  const onOuter = () => stopper.abort();
  if (signal) {
    if (signal.aborted) stopper.abort();
    else signal.addEventListener("abort", onOuter, { once: true });
  }
  let asked = false;
  let statements = 0;
  let jsonMode = null;
  const splitter = createSentenceSplitter((raw) => {
    if (asked) return;
    const text = cleanSentence(raw);
    if (!text) return;
    if (isQuestion(text)) {
      // 一句里夹了多个问号：只留到第一个问号。
      const first = text.match(/^.*?[？?]/);
      asked = true;
      emit(first ? first[0] : text, "question");
      stopper.abort();
      return;
    }
    if (statements >= 2) return;
    statements += 1;
    emit(/[。！!；;]$/.test(text) ? text : `${text}。`, round ? "ack" : "recap");
  });
  let errorCode = "";
  try {
    await chatStream({
      baseUrl: config.llmBaseUrl,
      apiKey: config.llmApiKey,
      model: config.llmModel,
      messages: prompts.interviewStreamMessages(input),
      maxTokens: 400,
      fetchImpl: config.fetchImpl,
      signal: stopper.signal,
      onDelta(delta) {
        // 个别模型不听话，仍然输出 JSON：整段收齐后再解析，不把花括号读给用户听。
        if (jsonMode === null) jsonMode = /^\s*[{`]/.test(delta) ? "" : false;
        if (jsonMode !== false) jsonMode += delta;
        else splitter.push(delta);
      },
    });
    if (jsonMode) {
      try {
        splitter.push(String(parseJsonLoose(jsonMode).reply || ""));
      } catch { /* 解析不了就走下面的兜底问句 */ }
    }
    splitter.flush();
  } catch (error) {
    errorCode = error.code || "error";
  } finally {
    if (signal) signal.removeEventListener("abort", onOuter);
  }
  if (!sentences.length) return offlineTurn(true, errorCode || "empty");
  if (!asked) {
    emit(fallbackQuestion, "question");
    return finish("llm", true, errorCode || "no_question");
  }
  return finish("llm", false);
}

module.exports = { runAgent, streamInterview, ruleRecap };
