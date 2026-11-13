"use strict";

const TOPICS = [
  { id: "who", label: "你是谁" },
  { id: "offer", label: "能提供什么" },
  { id: "work", label: "经历与作品" },
  { id: "story", label: "你的故事" },
  { id: "seek", label: "联系与寻找" },
  { id: "style", label: "网站风格" },
];

const TOPIC_IDS = TOPICS.map((topic) => topic.id);

const THEMES = {
  warm: { id: "warm", label: "温暖", accent: "#A9532F" },
  simple: { id: "simple", label: "简约", accent: "#924526" },
  ink: { id: "ink", label: "墨色", accent: "#7C3B22" },
  cinema: { id: "cinema", label: "光影", accent: "#A9532F" },
  editorial: { id: "editorial", label: "杂志", accent: "#924526" },
};

function blankContacts() {
  return { wechat: "", email: "", phone: "", xiaohongshu: "", douyin: "", website: "" };
}

function blankProfile() {
  return {
    schema_version: "0.1",
    name: "",
    title: "",
    tagline: "",
    city: "",
    tags: [],
    about: "",
    services: [],
    seeking: [],
    highlights: [],
    story: "",
    contacts: blankContacts(),
    faq: [],
    theme: "warm",
    accent: THEMES.warm.accent,
  };
}

function cleanString(value, max = 2000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function inferTheme(text) {
  const raw = String(text ?? "");
  if (/光影|电影感|电影风|暗色|深色|cinema/i.test(raw)) return "cinema";
  if (/杂志|画报|editorial|magazine/i.test(raw)) return "editorial";
  if (/简约|极简|干净/.test(raw)) return "simple";
  if (/墨色|墨韵|故事感|沉稳/.test(raw)) return "ink";
  if (/温暖|温馨|暖/.test(raw)) return "warm";
  if (THEMES[raw]) return raw;
  return "";
}

function normalizeProfile(input) {
  const src = asObject(input);
  const profile = blankProfile();
  for (const key of ["name", "title", "tagline", "city", "about", "story"]) {
    profile[key] = cleanString(src[key], key === "story" || key === "about" ? 4000 : 200);
  }
  profile.tags = (Array.isArray(src.tags) ? src.tags : [])
    .map((tag) => cleanString(tag, 24))
    .filter(Boolean)
    .slice(0, 12);
  profile.services = (Array.isArray(src.services) ? src.services : [])
    .map((item) => ({
      name: cleanString(asObject(item).name, 40),
      description: cleanString(asObject(item).description, 300),
      price: cleanString(asObject(item).price, 40),
      for_whom: cleanString(asObject(item).for_whom, 80),
    }))
    .filter((item) => item.name)
    .slice(0, 12);
  profile.seeking = (Array.isArray(src.seeking) ? src.seeking : [])
    .map((item) => ({
      who: cleanString(asObject(item).who, 80),
      description: cleanString(asObject(item).description, 300),
    }))
    .filter((item) => item.who)
    .slice(0, 8);
  profile.highlights = (Array.isArray(src.highlights) ? src.highlights : [])
    .map((item) => ({
      title: cleanString(asObject(item).title, 80),
      description: cleanString(asObject(item).description, 400),
    }))
    .filter((item) => item.title || item.description)
    .slice(0, 12);
  profile.faq = (Array.isArray(src.faq) ? src.faq : [])
    .map((item) => ({
      q: cleanString(asObject(item).q, 120),
      a: cleanString(asObject(item).a, 400),
    }))
    .filter((item) => item.q && item.a)
    .slice(0, 12);
  const contacts = asObject(src.contacts);
  profile.contacts = blankContacts();
  for (const key of Object.keys(profile.contacts)) profile.contacts[key] = cleanString(contacts[key], 120);
  const theme = THEMES[src.theme] ? src.theme : inferTheme(src.theme) || inferTheme(src.style) || "warm";
  profile.theme = theme;
  profile.accent = THEMES[theme].accent;
  profile.schema_version = "0.1";
  return profile;
}

function blankCoverage() {
  return { who: false, offer: false, work: false, story: false, seek: false, style: false };
}

function coverageFromText(text) {
  const raw = String(text ?? "");
  return {
    who: /我是|我叫/.test(raw),
    offer: /我能提供|服务清单|元起|元\/|元每人/.test(raw) || /\d+\s*元/.test(raw),
    work: /经历与作品|经历：|作品：/.test(raw),
    story: /我的故事|之所以/.test(raw),
    seek: /联系方式|微信|电话|邮箱|小红书|抖音|正在寻找/.test(raw),
    style: /网站风格|想要温暖|想要简约|想要墨色|想要光影|想要杂志|风格想要|风格换成/.test(raw),
  };
}

function mergeCoverage(base, extra) {
  const next = { ...blankCoverage(), ...base };
  for (const id of TOPIC_IDS) if (extra && extra[id]) next[id] = true;
  return next;
}

function firstMissingTopic(coverage) {
  return TOPIC_IDS.find((id) => !coverage[id]) || "";
}

function stripPrivateNotes(profile, imports) {
  const blocked = [];
  for (const item of imports || []) {
    for (const line of String(item.rawText || item || "").split(/\r?\n/)) {
      if (/内部备注|不要公开/.test(line)) blocked.push(line.trim());
    }
  }
  const walk = (value) => {
    if (typeof value === "string") {
      let next = value;
      for (const line of blocked) if (line) next = next.split(line).join("");
      next = next.replace(/内部备注[^\n]*/g, "").replace(/机密原文\S*/g, "").trim();
      return next;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const copy = {};
      for (const [key, item] of Object.entries(value)) copy[key] = walk(item);
      return copy;
    }
    return value;
  };
  return normalizeProfile(walk(profile));
}

function parseServiceLine(line) {
  const trimmed = String(line || "").replace(/^[\s\-*・•]+/, "").trim();
  const matched = trimmed.match(/^([^：:]{1,30})[：:](.+)$/);
  if (!matched) return null;
  const name = matched[1].trim();
  const rest = matched[2].trim();
  if (!name || /^(我是谁|我能提供|经历与作品|我的故事|联系方式|我正在寻找|网站风格|客人常问)$/.test(name)) return null;
  if (!/元|适合|房|向导|摄影|服务/.test(trimmed)) return null;
  const price = (rest.match(/\d+\s*元[^，,。；]*/ ) || [])[0] || "";
  const forWhom = (rest.match(/适合([^，,。；]+)/) || [])[1] || "";
  let description = rest;
  if (price) description = description.replace(price, "");
  if (forWhom) description = description.replace(`适合${forWhom}`, "");
  description = description.replace(/[，,]{2,}/g, "，").replace(/^[，,\s]+|[，,\s]+$/g, "").trim();
  return { name, description, price: price.trim(), for_whom: forWhom.trim() };
}

function sectionAfter(text, startLabel, endLabels) {
  const start = text.indexOf(startLabel);
  if (start < 0) return "";
  const from = start + startLabel.length;
  let end = text.length;
  for (const label of endLabels) {
    const at = text.indexOf(label, from);
    if (at >= 0 && at < end) end = at;
  }
  return text.slice(from, end).replace(/^[\s：:]+/, "").trim();
}

function extractProfileFromText(text) {
  const kept = String(text || "")
    .split(/\r?\n/)
    .filter((line) => !/内部备注|不要公开/.test(line))
    .join("\n")
    .trim();
  const profile = blankProfile();
  if (!kept) return profile;

  const nameMatch = kept.match(/我(?:是|叫)\s*([^，,\n]{1,60})/);
  if (nameMatch) profile.name = nameMatch[1].trim();

  if (kept.includes("惠州") && kept.includes("双月湾")) profile.city = "惠州双月湾";
  else {
    const cityMatch = kept.match(/在([\u4e00-\u9fa5]{2,12}?)(?:做|，|,|的)/);
    if (cityMatch) profile.city = cityMatch[1];
  }

  const titles = ["民宿主理人", "独立摄影师", "摄影师", "设计师", "咨询顾问", "培训师", "自由职业者", "主理人", "向导"];
  profile.title = titles.find((title) => kept.includes(title)) || "";

  const headings = ["我能提供", "经历与作品", "我的故事", "联系方式", "我正在寻找", "网站风格", "客人常问", "内部备注"];
  const intro = sectionAfter(`我是谁：\n${kept}`, "我是谁：", headings);
  const firstSentence = (intro || kept).split(/[。！？\n]/).map((part) => part.trim()).find(Boolean) || "";
  profile.tagline = firstSentence.slice(0, 48);
  profile.about = (intro || firstSentence).split(/\n\n/)[0].trim().slice(0, 400);

  const offer = sectionAfter(kept, "我能提供", headings.filter((item) => item !== "我能提供"));
  const serviceLines = (offer || kept).split(/\n/);
  for (const line of serviceLines) {
    const service = parseServiceLine(line);
    if (service) profile.services.push(service);
  }

  const work = sectionAfter(kept, "经历与作品", headings.filter((item) => item !== "经历与作品"));
  if (work) {
    const sentence = work.split(/\n/).map((line) => line.trim()).filter(Boolean)[0] || "";
    profile.highlights.push({ title: sentence.slice(0, 40), description: work.slice(0, 400) });
  }

  const story = sectionAfter(kept, "我的故事", headings.filter((item) => item !== "我的故事"));
  if (story) profile.story = story.split(/\n\n/)[0].trim().slice(0, 800);

  const contactText = `${sectionAfter(kept, "联系方式", headings.filter((item) => item !== "联系方式"))}\n${kept}`;
  const pick = (re) => (contactText.match(re) || [])[1] || "";
  profile.contacts.wechat = pick(/微信[:：\s]*([^\s，,。\n]+)/).trim();
  profile.contacts.phone = pick(/电话[:：\s]*([+\d][\d\-+\s]{5,18})/).trim();
  profile.contacts.email = pick(/邮箱[:：\s]*([^\s，,。\n]+)/).trim();
  profile.contacts.xiaohongshu = pick(/小红书[:：\s「]*([^」\n，,。]+)/).trim();
  profile.contacts.douyin = pick(/抖音[:：\s「]*([^」\n，,。]+)/).trim();
  profile.contacts.website = pick(/个人网站[:：\s]*([^\s，,。\n]+)/).trim() || pick(/(?:^|\n)网站[:：\s]*([^\s，,。\n]+)/).trim();

  const seekingText = sectionAfter(kept, "我正在寻找", headings.filter((item) => item !== "我正在寻找"));
  const seekingMatch = seekingText || (kept.match(/正在寻找([^。\n]+)/) || [])[1] || "";
  if (seekingMatch) {
    for (const part of seekingMatch.split(/以及|，也|，|、/)) {
      const who = part.replace(/^(我正在寻找|寻找)/, "").trim();
      if (who) profile.seeking.push({ who: who.slice(0, 80), description: "" });
    }
  }

  const faqText = sectionAfter(kept, "客人常问", headings.filter((item) => item !== "客人常问"));
  const faqSource = faqText || kept;
  for (const line of faqSource.split(/\n/)) {
    const matched = line.match(/([^：:\n]{2,40}？)\s*([^。\n]+。?)/);
    if (matched && !/请只根据|不知道就写/.test(line)) profile.faq.push({ q: matched[1].trim(), a: matched[2].trim() });
  }

  const theme = inferTheme(sectionAfter(kept, "网站风格", ["客人常问", "内部备注"]) || kept);
  if (theme) profile.theme = theme;

  const tags = [];
  if (kept.includes("民宿")) tags.push("民宿");
  if (kept.includes("双月湾")) tags.push("双月湾");
  if (kept.includes("惠州")) tags.push("惠州");
  if (kept.includes("摄影")) tags.push("摄影");
  if (profile.city && !tags.includes(profile.city)) tags.push(profile.city);
  profile.tags = [...new Set(tags)].slice(0, 8);
  return normalizeProfile(profile);
}

function diffFields(before, after) {
  const changed = [];
  const keys = ["name", "title", "tagline", "city", "about", "story", "theme", "accent", "tags", "services", "seeking", "highlights", "contacts", "faq"];
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  }
  return changed;
}

function classifyInstruction(instruction) {
  const text = String(instruction || "").trim();
  if (/加一个服务|新增服务|增加一项服务|加一项服务/.test(text)) return "add_service";
  if (/简介|关于我|文案|活泼|写得/.test(text) && !/风格/.test(text)) return "about";
  if (/简约|极简|温暖|墨色|光影|电影感|杂志|画报|风格|主题/.test(text)) return "theme";
  return "general";
}

function parseServiceFromInstruction(instruction) {
  const matched = String(instruction || "").match(/(?:加一个服务|新增服务|增加一项服务|加一项服务)[:：]?\s*(.+)$/);
  if (!matched) return null;
  const rest = matched[1].trim();
  const price = (rest.match(/\d+\s*元[^，,。]*/) || [])[0] || "";
  let name = rest;
  if (price) name = rest.slice(0, rest.indexOf(price)).replace(/[：:，,\s]+$/g, "").trim();
  name = name || rest.slice(0, 20);
  return { name: name.slice(0, 40), description: rest.slice(0, 200), price, for_whom: "" };
}

function applyEdit(before, proposed, instruction) {
  const base = normalizeProfile(before);
  const next = normalizeProfile(proposed);
  const intent = classifyInstruction(instruction);
  const result = normalizeProfile(base);
  if (intent === "theme") {
    const theme = inferTheme(instruction) || next.theme || base.theme;
    result.theme = THEMES[theme] ? theme : base.theme;
    result.accent = THEMES[result.theme].accent;
  } else if (intent === "add_service") {
    const parsed = parseServiceFromInstruction(instruction);
    const extras = next.services.filter((service) => !base.services.some((item) => item.name === service.name));
    const adding = extras.length ? extras : parsed ? [parsed] : [];
    result.services = [...base.services, ...adding].slice(0, 12);
  } else if (intent === "about") {
    if (next.about && next.about !== base.about) result.about = next.about;
    else if (result.about) result.about = /！$/.test(result.about) ? result.about : result.about.replace(/。?$/, "！");
  } else {
    return { profile: next, changed: diffFields(base, next), intent };
  }
  return { profile: result, changed: diffFields(base, result), intent };
}

const DEMO_IMPORT = `我是阿岚，在惠州双月湾做民宿主理人。小民宿叫「双月湾慢屋」，离海边走路五分钟。

我能提供：
- 海景双人房：看得到日出，380 元起，适合想安静看海的情侣
- 家庭套房：两室一厅，680 元起，适合带孩子的家庭
- 清晨赶海向导：带你去滩涂，120 元/人，适合住店客人

经历与作品：2019 年从广州回到双月湾，把家里的旧屋改成民宿，至今接待过两千多位客人。屋子里的老船木桌子是我父亲留下的。

我的故事：我在双月湾长大，离开十年又回来。我想让客人住得像在朋友家，而不是住进一个编号房间。

联系方式：微信 alan-shuangyue，电话 13800138000，小红书「双月湾阿岚」。
我正在寻找会给民宿拍照的本地摄影师，也欢迎想在周末驻留写作的人。

网站风格：想要温暖一点。

客人常问：住宿多少钱？海景双人房 380 元起，家庭套房 680 元起，含简单早餐。
`;

module.exports = {
  TOPICS,
  TOPIC_IDS,
  THEMES,
  blankProfile,
  blankCoverage,
  normalizeProfile,
  coverageFromText,
  mergeCoverage,
  firstMissingTopic,
  stripPrivateNotes,
  extractProfileFromText,
  diffFields,
  classifyInstruction,
  applyEdit,
  inferTheme,
  DEMO_IMPORT,
};
