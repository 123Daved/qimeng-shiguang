"use strict";

const prompts = require("./prompts");
const { chatComplete, parseJsonLoose } = require("./llm");
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

module.exports = { runAgent };
