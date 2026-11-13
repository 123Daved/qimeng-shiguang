"use strict";

const { extractProfileFromText, normalizeProfile, applyEdit } = require("../profile");
const { questionFor } = require("./prompts");
const { draftFromTurns } = require("../draft");

function offlineInterview({ topic, follow }) {
  return {
    reply: questionFor(topic, follow),
    topic,
    is_followup: !!follow,
    coverage: {},
  };
}

function offlineOrganize({ transcript, imported, turns }) {
  if (Array.isArray(turns) && turns.length) {
    return { profile: draftFromTurns({ messages: turns, imported: imported || "" }).profile };
  }
  return { profile: extractProfileFromText(`${imported || ""}\n${transcript || ""}`) };
}

function offlineEdit({ profile, instruction }) {
  const current = normalizeProfile(profile);
  const intentText = String(instruction || "");
  if (/活泼|简介|关于我/.test(intentText) && !/风格/.test(intentText)) {
    const tweaked = normalizeProfile(current);
    tweaked.about = tweaked.about ? tweaked.about.replace(/。?$/, "！") : tweaked.about;
    return { profile: tweaked };
  }
  return { profile: applyEdit(current, current, instruction).profile };
}

function profileBlob(profile) {
  return JSON.stringify(profile || {});
}

function bigrams(text) {
  const han = String(text || "").replace(/[^\u4e00-\u9fa5]/g, "");
  const items = [];
  for (let i = 0; i < han.length - 1; i += 1) items.push(han.slice(i, i + 2));
  return items;
}

const STOP_BIGRAMS = new Set(["什么", "怎么", "为何", "为什么", "是否", "能否", "请问", "一下", "周末", "今天", "明天", "可以", "不能", "有没", "知道", "想问", "多少", "如何", "我们", "你们", "他们", "这个", "那个", "一下", "能不能", "有没有", "请问", "想知"]);

function evidenceScore(question, profile) {
  const blob = profileBlob(profile);
  const useful = bigrams(question).filter((item) => !STOP_BIGRAMS.has(item));
  if (!useful.length) return 1;
  const hits = useful.filter((item) => blob.includes(item));
  return hits.length / useful.length;
}

function isJailbreak(question) {
  return /忽略(以上|之前|全部|先前)?(的)?(指令|规则|提示)|你现在是|从现在开始你|换个?身份|扮演|系统提示|developer mode|jailbreak|pretend you/i.test(String(question || ""));
}

function contactLines(profile) {
  const contacts = profile.contacts || {};
  const parts = [];
  if (contacts.wechat) parts.push(`微信 ${contacts.wechat}`);
  if (contacts.phone) parts.push(`电话 ${contacts.phone}`);
  if (contacts.email) parts.push(`邮箱 ${contacts.email}`);
  if (contacts.xiaohongshu) parts.push(`小红书 ${contacts.xiaohongshu}`);
  if (contacts.douyin) parts.push(`抖音 ${contacts.douyin}`);
  if (contacts.website) parts.push(`网站 ${contacts.website}`);
  return parts.join("，");
}

function handoffAnswer(profile) {
  const contacts = contactLines(profile);
  return `档案里没有这个问题的答案，我不能替对方编造。建议直接联系本人${contacts ? `：${contacts}` : "。"}`;
}

function refusalAnswer() {
  return "我是这个页面上的 AI 分身，只能根据公开档案回答，不能更换身份。你可以问服务、价格，或怎么联系本人。";
}

function matchFaq(question, faq) {
  let best = null;
  let bestScore = 0;
  for (const item of faq || []) {
    const left = new Set(bigrams(question));
    const right = bigrams(item.q);
    if (!right.length) continue;
    const hits = right.filter((itemGram) => left.has(itemGram)).length;
    const score = hits / right.length;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

function offlineAvatar({ profile, question }) {
  const current = normalizeProfile(profile);
  if (isJailbreak(question)) return { answer: refusalAnswer(), answered_from: "refused" };
  const faq = matchFaq(question, current.faq);
  if (faq) return { answer: faq.a, answered_from: "faq" };
  if (evidenceScore(question, current) < 0.34) return { answer: handoffAnswer(current), answered_from: "handoff" };
  const service = current.services.find((item) => question.includes(item.name.slice(0, 2)));
  if (service) {
    const price = service.price ? `，${service.price}` : "";
    return { answer: `${service.name}：${service.description}${price}。`, answered_from: "profile" };
  }
  if (current.about && evidenceScore(question, current) >= 0.5) return { answer: current.about, answered_from: "profile" };
  return { answer: handoffAnswer(current), answered_from: "handoff" };
}

module.exports = {
  offlineInterview,
  offlineOrganize,
  offlineEdit,
  offlineAvatar,
  isJailbreak,
  evidenceScore,
  matchFaq,
  handoffAnswer,
  refusalAnswer,
  contactLines,
};
