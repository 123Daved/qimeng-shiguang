"use strict";

// 实时草稿：每答一轮就用规则（不调用大模型）把已经说过的话拼成一份草稿档案，
// 让工作台右侧的预览一段一段“长”出来。正式生成仍然走 organize 智能体。

const { extractProfileFromText, normalizeProfile, inferTheme } = require("./profile");

const SECTION_OF_TOPIC = {
  who: ["hero", "about"],
  offer: ["services"],
  work: ["highlights"],
  story: ["story"],
  seek: ["seeking", "contacts"],
  style: ["theme"],
};

const FILLERS = /(嗯+|呃+|啊+|那个|就是说|然后呢|对吧|的话呢)[，,、\s]*/g;

function tidy(text) {
  return String(text || "")
    .replace(FILLERS, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[，,]{2,}/g, "，")
    .trim();
}

function sentences(text) {
  return tidy(text)
    .split(/[。！？!?\n；;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function guessName(text) {
  const raw = tidy(text);
  const matched = raw.match(/(?:我叫|我是|叫我|称呼我|大家叫我)\s*([\u4e00-\u9fa5A-Za-z·]{1,12}?)(?:[，,。、\s]|在|做|是|，|$)/);
  if (!matched) return "";
  const name = matched[1].replace(/(老师|同学)$/, "").trim();
  if (/^(一名|一个|一位|做|在)/.test(name)) return "";
  if (/^[\u4e00-\u9fa5]{6,}$/.test(name)) return name.slice(0, 3);
  return name.slice(0, 12);
}

function guessCity(text) {
  const matched = tidy(text).match(/(?:在|来自|住在|base\s*)([\u4e00-\u9fa5]{2,8}?)(?:做|当|开|，|,|。|的|工作|生活)/);
  return matched ? matched[1] : "";
}

function guessTitle(text) {
  const raw = tidy(text);
  const matched = raw.match(/(?:做|当|是一名|是一个|是一位|职业是|是)(?:一名|一个|一位)?([\u4e00-\u9fa5A-Za-z]{0,8}?(?:主理人|创始人|工程师|设计师|摄影师|老师|教练|顾问|博主|作者|经理|老板|师|家|员|者))/);
  return matched ? matched[1] : "";
}

function looseServices(text) {
  const services = [];
  for (const part of sentences(text)) {
    const price = (part.match(/\d+(?:\.\d+)?\s*(?:元|块)(?:起|\/[\u4e00-\u9fa5]+|每[\u4e00-\u9fa5]+|一[\u4e00-\u9fa5])?/) || [])[0] || "";
    const forWhom = (part.match(/适合([^，,。]+)/) || [])[1] || "";
    let name = part.split(/[，,：:]/)[0]
      .replace(/^(还有|另外|以及|再就是|然后)/, "")
      .replace(/^(我(?:能|可以)?(?:提供|做|接)|提供|主要(?:做|是)|可以)/, "")
      .replace(/\d+(?:\.\d+)?\s*(?:元|块).*/, "")
      .trim();
    if (!name || name.length > 24) name = part.slice(0, 12);
    let description = part.replace(/^(还有|另外|以及|再就是|然后)/, "");
    if (price) description = description.replace(price, "");
    if (forWhom) description = description.replace(`适合${forWhom}`, "");
    description = description.replace(/[，,]{2,}/g, "，").replace(/^[，,\s]+|[，,\s]+$/g, "");
    if (description === name || /^(我(?:能|可以)?(?:提供|做|接)|提供|可以做)?\s*$/.test(description.replace(name, ""))) description = "";
    services.push({ name: name.slice(0, 40), description: description.slice(0, 300), price: price.replace("块", "元").trim(), for_whom: forWhom.trim() });
    if (services.length >= 4) break;
  }
  return services;
}

function topicTexts(messages) {
  const out = {};
  for (const message of messages || []) {
    if (message.role !== "user" || !message.topic) continue;
    out[message.topic] = `${out[message.topic] || ""}${message.content}\n`;
  }
  return out;
}

/**
 * 根据会话里已有的导入资料和采访回答，拼出一份草稿档案。
 * 返回 { profile, filled }，filled 是已经有内容的版块。
 */
function draftFromTurns({ messages = [], imported = "" } = {}) {
  const byTopic = topicTexts(messages);
  const transcript = Object.values(byTopic).join("\n");
  const profile = extractProfileFromText(`${imported}\n${transcript}`);

  const who = byTopic.who || "";
  if (who) {
    const spoken = guessName(who);
    if (!profile.name || (spoken && (profile.name.length > 8 || /在|做|是/.test(profile.name)))) profile.name = spoken || profile.name;
    if (!profile.city) profile.city = guessCity(who);
    const spokenTitle = guessTitle(who);
    if (spokenTitle && (!profile.title || !who.includes(profile.title) || spokenTitle.includes(profile.title))) profile.title = spokenTitle;
    profile.tagline = tidy(profile.tagline);
    profile.about = tidy(profile.about);
    const first = sentences(who)[0] || "";
    if (!profile.tagline || profile.tagline === first.slice(0, 48)) profile.tagline = first.slice(0, 48);
    if (!profile.about) profile.about = sentences(who).join("。").slice(0, 400);
  }
  if (byTopic.offer && !profile.services.length) profile.services = looseServices(byTopic.offer);
  if (byTopic.work && !profile.highlights.length) {
    const parts = sentences(byTopic.work);
    profile.highlights = parts.slice(0, 4).map((part) => ({ title: part.split(/[，,]/)[0].slice(0, 24), description: part.slice(0, 400) }));
  }
  if (byTopic.story && !profile.story) profile.story = sentences(byTopic.story).join("。").slice(0, 800);
  if (byTopic.seek && !profile.seeking.length) {
    const wanted = tidy(byTopic.seek).match(/(?:寻找|想找|希望找到|欢迎|想认识)([^。\n]+)/);
    if (wanted) {
      for (const part of wanted[1].split(/以及|，也|，|、|和/)) {
        const whoText = part.trim();
        if (whoText && whoText.length > 1) profile.seeking.push({ who: whoText.slice(0, 80), description: "" });
      }
    }
  }
  if (byTopic.style) {
    const theme = inferTheme(byTopic.style);
    if (theme) profile.theme = theme;
  }
  if (who && profile.title && !profile.tags.includes(profile.title)) profile.tags = [profile.title, ...profile.tags.filter((tag) => who.includes(tag) || tag === profile.city)];
  if (!profile.tags.length && profile.title) profile.tags = [profile.title, profile.city].filter(Boolean);

  const normalized = normalizeProfile(profile);
  const filled = [];
  if (normalized.name) filled.push("hero");
  if (normalized.about) filled.push("about");
  if (normalized.services.length) filled.push("services");
  if (normalized.highlights.length) filled.push("highlights");
  if (normalized.story) filled.push("story");
  if (normalized.seeking.length) filled.push("seeking");
  if (Object.values(normalized.contacts).some(Boolean)) filled.push("contacts");
  if (byTopic.style || /网站风格/.test(imported)) filled.push("theme");
  return { profile: normalized, filled };
}

module.exports = { draftFromTurns, looseServices, guessName, guessCity, guessTitle, tidy, SECTION_OF_TOPIC };
