"use strict";

const { escapeHtml, escapeXml, sanitizeUrl, jsonForScript } = require("./security");
const { normalizeProfile, THEMES } = require("./profile");
const { icon } = require("./icons");

const MARK = '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect width="24" height="24" rx="6" fill="#A9532F"/><circle cx="12" cy="8.2" r="1.5" fill="#FFFFFF"/><path d="M6 14.5c2.2-3.2 4-4.8 6-4.8s3.8 1.6 6 4.8" fill="none" stroke="#FFFFFF" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 16.8h10" fill="none" stroke="#FFFFFF" stroke-width="1.75" stroke-linecap="round"/></svg>';
const CONTACT_ICONS = { wechat: "chat", phone: "phone", email: "mail", xiaohongshu: "link", douyin: "link", website: "globe" };

function priceAmount(price) {
  const matched = String(price || "").match(/(\d+(?:\.\d+)?)/);
  return matched ? matched[1] : "";
}

function absoluteUrl(base, slug) {
  const root = String(base || "").replace(/\/$/, "");
  return `${root}/u/${encodeURIComponent(slug)}`;
}

function jsonLd(profile, pageUrl) {
  const person = {
    "@type": "Person",
    name: profile.name,
    jobTitle: profile.title || undefined,
    description: profile.tagline || profile.about || undefined,
    homeLocation: profile.city ? { "@type": "Place", name: profile.city } : undefined,
    knowsAbout: profile.tags.length ? profile.tags : undefined,
    url: pageUrl,
    makesOffer: profile.services.map((service) => {
      const offer = {
        "@type": "Offer",
        name: service.name,
        description: service.description || undefined,
        url: pageUrl,
      };
      const amount = priceAmount(service.price);
      if (amount) {
        offer.price = amount;
        offer.priceCurrency = "CNY";
      }
      return offer;
    }),
  };
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    name: `${profile.name} · 憩梦时光`,
    url: pageUrl,
    mainEntity: person,
  };
}

function contactHref(kind, value) {
  if (kind === "phone") return sanitizeUrl(`tel:${String(value).replace(/[^\d+]/g, "")}`);
  if (kind === "email") return sanitizeUrl(`mailto:${value}`);
  return sanitizeUrl(value);
}

function contactItems(profile) {
  const map = [
    ["wechat", "微信", profile.contacts.wechat, ""],
    ["phone", "电话", profile.contacts.phone, "phone"],
    ["email", "邮箱", profile.contacts.email, "email"],
    ["xiaohongshu", "小红书", profile.contacts.xiaohongshu, "link"],
    ["douyin", "抖音", profile.contacts.douyin, "link"],
    ["website", "网站", profile.contacts.website, "link"],
  ];
  return map
    .filter((item) => item[2])
    .map(([key, label, value, kind]) => ({ key, label, value, href: kind ? contactHref(kind, value) : "" }));
}

const SECTION_META = {
  services: { title: "我能提供", en: "Services", topic: "能提供什么" },
  about: { title: "关于我", en: "About", topic: "你是谁" },
  highlights: { title: "经历与作品", en: "Works", topic: "经历与作品" },
  story: { title: "我的故事", en: "Story", topic: "你的故事" },
  seeking: { title: "我在寻找", en: "Seeking", topic: "联系与寻找" },
  contacts: { title: "联系我", en: "Contact", topic: "联系与寻找" },
};

function sectionClass(name, changed, built) {
  const hit = changed && typeof changed.has === "function" ? changed.has(name) : changed && changed.includes(name);
  const classes = ["block", `block-${name}`];
  if (hit) classes.push("is-changed");
  if (built && built.has(name)) classes.push("is-built");
  return classes.join(" ");
}

function pendingBlock(name) {
  const meta = SECTION_META[name];
  return `<div class="pending" aria-hidden="true"><span class="pending-line w60"></span><span class="pending-line w90"></span><span class="pending-line w40"></span></div>
      <p class="pending-note">待补充 · 回答「${escapeHtml(meta.topic)}」后，这一段会自动长出来</p>`;
}

function firstGlyph(name) {
  const chars = Array.from(String(name || "").trim());
  return chars[0] || "憩";
}

function renderSite(options) {
  const profile = normalizeProfile(options.profile);
  const slug = options.slug || "";
  const pageUrl = options.pageUrl || (slug ? `/u/${encodeURIComponent(slug)}` : "");
  const changed = new Set(options.changed || []);
  const built = new Set(options.built || []);
  const draft = !!options.draft;
  const filled = new Set(options.filled || []);
  const themeId = THEMES[options.themeOverride] ? options.themeOverride : (THEMES[profile.theme] ? profile.theme : "warm");
  const theme = THEMES[themeId];
  const contacts = contactItems(profile);
  const faqQuestions = profile.faq.map((item) => item.q);
  const boot = jsonForScript({
    slug,
    faqs: faqQuestions,
    draft,
    preview: !!options.preview,
  });
  const ld = jsonForScript(jsonLd(profile, options.absoluteUrl || pageUrl));
  const displayName = profile.name || (draft ? "你的名字" : "未命名");
  const tags = profile.tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("");
  const services = profile.services.map((service, index) => `
      <article class="service" data-tilt>
        <span class="svc-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
        <header>
          <h3>${escapeHtml(service.name)}</h3>
          ${service.price ? `<p class="price">${escapeHtml(service.price)}</p>` : ""}
        </header>
        ${service.description ? `<p class="svc-desc">${escapeHtml(service.description)}</p>` : ""}
        ${service.for_whom ? `<p class="for">适合：${escapeHtml(service.for_whom)}</p>` : ""}
      </article>`).join("");
  const highlights = profile.highlights.map((item, index) => `
        <li class="tl-item">
          <span class="tl-dot" aria-hidden="true"></span>
          <span class="tl-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
          ${item.title ? `<h3>${escapeHtml(item.title)}</h3>` : ""}
          ${item.description && item.description !== item.title ? `<p>${escapeHtml(item.description)}</p>` : ""}
        </li>`).join("");
  const seeking = profile.seeking.map((item) => `<li class="seek-item"><span class="seek-mark" aria-hidden="true">↗</span><span><strong>${escapeHtml(item.who)}</strong>${item.description ? `<small>${escapeHtml(item.description)}</small>` : ""}</span></li>`).join("");
  const contactHtml = contacts.map((item) => {
    const inner = `${icon(CONTACT_ICONS[item.key] || "link")}<span><small>${escapeHtml(item.label)}</small>${escapeHtml(item.value)}</span>`;
    if (!item.href) return `<div class="contact" data-spot>${inner}</div>`;
    return `<a class="contact" data-spot href="${escapeHtml(item.href)}" data-channel="${escapeHtml(item.key)}">${inner}</a>`;
  }).join("");
  const suggestions = faqQuestions.map((q) => `<button type="button" class="chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join("");
  const machine = slug ? `<p class="machine"><a href="/u/${encodeURIComponent(slug)}/profile.json">profile.json</a><a href="/u/${encodeURIComponent(slug)}/llms.txt">llms.txt</a></p>` : "";
  const example = options.example ? `<p class="example-flag">${icon("info")}示例 / 演示数据，不是已核验的真实用户</p>` : "";
  const previewNote = draft
    ? "实时草稿：每回答一轮，这里就搭好一段；点「生成网站」后由 AI 正式整理"
    : options.published ? "预览，修改会同步到已发布的网站" : "预览，还没有发布";
  const preview = options.preview ? `<p class="example-flag${draft ? " is-draft" : ""}">${icon("info")}${previewNote}</p>` : "";
  const marqueeItems = [...profile.tags, ...profile.services.map((item) => item.name), profile.city]
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
    .slice(0, 10);
  const marquee = marqueeItems.length
    ? `<div class="marquee" aria-hidden="true"><div class="marquee-track">${[0, 1].map(() => `<span>${marqueeItems.map((item) => `${escapeHtml(item)}<i>✦</i>`).join("")}</span>`).join("")}</div></div>`
    : "";

  const sections = [];
  const want = (name, has) => has || (draft && !filled.has(name));
  if (services || !draft) {
    sections.push({ name: "services", id: "services", html: services ? `<div class="services">${services}</div>` : "<p class=\"empty\">还没有写下服务。</p>" });
  } else {
    sections.push({ name: "services", id: "services", html: pendingBlock("services"), pending: true });
  }
  if (want("about", !!profile.about)) sections.push({ name: "about", html: profile.about ? `<p class="statement" data-words>${escapeHtml(profile.about)}</p>` : pendingBlock("about"), pending: !profile.about });
  if (want("highlights", !!highlights)) sections.push({ name: "highlights", html: highlights ? `<ol class="timeline" data-timeline><span class="tl-line" aria-hidden="true"><i></i></span>${highlights}</ol>` : pendingBlock("highlights"), pending: !highlights });
  if (want("story", !!profile.story)) sections.push({ name: "story", html: profile.story ? `<blockquote class="story-quote"><span class="quote-mark" aria-hidden="true" data-parallax="0.12">“</span><p data-words>${escapeHtml(profile.story)}</p></blockquote>` : pendingBlock("story"), pending: !profile.story });
  if (want("seeking", !!seeking)) sections.push({ name: "seeking", html: seeking ? `<ul class="seeking">${seeking}</ul>` : pendingBlock("seeking"), pending: !seeking });
  sections.push({
    name: "contacts",
    id: "contact",
    html: contactHtml
      ? `<p class="contact-lead">${escapeHtml(profile.seeking.length ? "如果你正是我在找的人，直接联系我。" : "想找我，直接联系。")}</p><div class="contacts">${contactHtml}</div>`
      : draft ? pendingBlock("contacts") : "<div class=\"contacts\"><p class=\"empty\">还没有留下联系方式。</p></div>",
    pending: !contactHtml && draft,
  });
  const sectionHtml = sections.map((section, index) => {
    const meta = SECTION_META[section.name];
    const num = String(index + 1).padStart(2, "0");
    return `
    <section id="${section.id || `sec-${section.name}`}" class="${sectionClass(section.name, changed, built)}${section.pending ? " is-pending" : ""}" data-section="${section.name}" data-reveal>
      <div class="sec-head">
        <span class="sec-num" aria-hidden="true">${num}</span>
        <h2>${meta.title}</h2>
        <span class="sec-en" aria-hidden="true">${meta.en}</span>
      </div>
      ${section.html}
    </section>`;
  }).join("");
  const navLinks = sections
    .filter((section) => !section.pending)
    .map((section) => `<a href="#${section.id || `sec-${section.name}`}" data-nav="${section.name}">${SECTION_META[section.name].title}</a>`)
    .join("");
  const heroPending = draft && !profile.name;
  const heroClass = ["hero", changed.has("theme") || changed.has("accent") || changed.has("name") || changed.has("about") ? "is-changed" : "", built.has("hero") || built.has("theme") ? "is-built" : "", heroPending ? "is-pending" : ""].filter(Boolean).join(" ");

  return `<!DOCTYPE html>
<html lang="zh-CN" data-qd-product="life" data-qd-theme="${themeId === "cinema" ? "dark" : "light"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(displayName)} · 憩梦时光</title>
  <meta name="description" content="${escapeHtml(profile.tagline || profile.about || "个人网站")}">
  ${pageUrl ? `<link rel="canonical" href="${escapeHtml(options.absoluteUrl || pageUrl)}">` : ""}
  ${draft ? '<meta name="robots" content="noindex">' : ""}
  <meta name="theme-color" content="${themeId === "cinema" ? "#16110E" : escapeHtml(theme.accent)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/site.css">
  <script type="application/ld+json">${ld}</script>
</head>
<body class="site theme-${escapeHtml(themeId)}${draft ? " is-draft" : ""}${options.preview ? " is-preview" : ""}" style="--site-accent:${escapeHtml(theme.accent)}">
  <a class="skip" href="#services">跳到服务清单</a>
  <div class="grain" aria-hidden="true"></div>
  <div class="cursor-glow" aria-hidden="true"></div>
  ${example}
  ${preview}
  <nav class="site-nav" aria-label="页面导航">
    <a class="site-brand" href="#top">${MARK}<span>${escapeHtml(displayName)}</span></a>
    <div class="site-links">${navLinks}</div>
  </nav>
  <header class="${heroClass}" id="top" data-section="hero">
    <div class="hero-bg" aria-hidden="true">
      <span class="hero-orb o1"></span>
      <span class="hero-orb o2"></span>
      <span class="hero-glyph" data-parallax="0.3">${escapeHtml(firstGlyph(profile.name))}</span>
    </div>
    <div class="hero-grid">
      <div class="hero-copy">
        <p class="brand kicker" data-reveal="fade">${MARK}<span>憩梦时光 · 个人门面${profile.city ? ` · ${escapeHtml(profile.city)}` : ""}</span></p>
        <h1 data-scramble data-reveal style="--i:1">${escapeHtml(displayName)}</h1>
        ${profile.title ? `<p class="title" data-reveal style="--i:2">${escapeHtml(profile.title)}</p>` : heroPending ? '<p class="title pending-text" data-reveal style="--i:2">先说说你是谁</p>' : ""}
        ${profile.tagline ? `<p class="tagline" data-reveal style="--i:3">${escapeHtml(profile.tagline)}</p>` : ""}
        <div class="hero-cta" data-reveal style="--i:4">
          <a class="btn btn-primary" href="#contact" data-magnetic>${icon("chat")}<span>联系我</span></a>
          <a class="btn btn-ghost" href="#services"><span>我能提供什么</span>${icon("arrow")}</a>
        </div>
      </div>
      <aside class="id-card" data-tilt data-reveal="right" style="--i:2" aria-label="名片">
        <span class="id-mono" aria-hidden="true">${escapeHtml(firstGlyph(profile.name))}</span>
        <p class="id-label">PROFILE · ${new Date().getFullYear()}</p>
        <p class="id-name">${escapeHtml(displayName)}</p>
        ${profile.title ? `<p class="id-title">${escapeHtml(profile.title)}</p>` : ""}
        ${profile.city ? `<p class="city">${icon("map")}${escapeHtml(profile.city)}</p>` : ""}
        ${tags ? `<ul class="tags">${tags}</ul>` : ""}
        <p class="id-machine">${icon("check")}人能读，AI 也能读</p>
      </aside>
    </div>
    ${marquee}
  </header>
  <main>${sectionHtml}
  </main>
  <footer class="site-footer">
    <a class="footer-cta" href="/?from=footer&amp;ref=${encodeURIComponent(slug)}" data-magnetic>我也要一个 →</a>
    ${machine}
    <p class="brand-lockup">${MARK}<span><span class="mother">憩梦</span> · 憩梦时光</span></p>
    <p class="notice">${escapeHtml(options.modelNotice || "")}</p>
  </footer>
  <button type="button" class="avatar-launch" id="avatar-open">${icon("spark")}<span>问 AI 分身</span><em>AI 生成</em></button>
  <section class="avatar" id="avatar" hidden>
    <header>
      <h2>${icon("spark")}问 AI 分身</h2>
      <p class="ai-flag">AI 生成</p>
      <button type="button" class="text-button" id="avatar-close">关闭</button>
    </header>
    <p class="avatar-note">只根据这份公开档案回答。不知道的事会请你直接联系本人。可以打字，也可以按麦克风直接问。</p>
    <div class="chips" id="avatar-chips">${suggestions}</div>
    <div class="avatar-log" id="avatar-log" aria-live="polite"></div>
    <form id="avatar-form">
      <label for="avatar-input">你的问题</label>
      <div class="composer">
        <input id="avatar-input" name="question" maxlength="300" placeholder="例如：住宿多少钱？" autocomplete="off">
        <button class="mic-mini" type="button" id="avatar-mic" aria-label="用语音提问" hidden><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v2.5"/></svg></button>
        <button class="primary" type="submit">发送</button>
      </div>
      <label class="speak-toggle"><input type="checkbox" id="avatar-speak"> 朗读回答</label>
    </form>
  </section>
  <script>window.__QD_SITE__=${boot};</script>
  <script src="/motion.js"></script>
  <script src="/fx.js"></script>
  <script src="/voice.js"></script>
  <script src="/site.js"></script>
</body>
</html>`;
}

function renderProfileJson(profile, extra) {
  const current = normalizeProfile(profile);
  return {
    schema_version: "0.1",
    slug: extra.slug,
    url: extra.absoluteUrl,
    name: current.name,
    title: current.title,
    tagline: current.tagline,
    city: current.city,
    tags: current.tags,
    about: current.about,
    services: current.services,
    seeking: current.seeking,
    highlights: current.highlights,
    story: current.story,
    contacts: current.contacts,
    faq: current.faq,
    theme: current.theme,
    accent: current.accent,
  };
}

function renderLlms(profile, extra) {
  const current = normalizeProfile(profile);
  const services = current.services.map((service) => `- ${service.name}：${service.description}${service.price ? `。价格：${service.price}` : ""}${service.for_whom ? `。适合：${service.for_whom}` : ""}`).join("\n");
  const seeking = current.seeking.map((item) => `- ${item.who}${item.description ? `：${item.description}` : ""}`).join("\n");
  const highlights = current.highlights.map((item) => `- ${item.title}${item.description ? `：${item.description}` : ""}`).join("\n");
  const faq = current.faq.map((item) => `问：${item.q}\n答：${item.a}`).join("\n\n");
  const contacts = Object.entries({
    微信: current.contacts.wechat,
    邮箱: current.contacts.email,
    电话: current.contacts.phone,
    小红书: current.contacts.xiaohongshu,
    抖音: current.contacts.douyin,
    网站: current.contacts.website,
  }).filter((item) => item[1]).map((item) => `- ${item[0]}：${item[1]}`).join("\n");
  return `# ${current.name}

> ${current.tagline || current.title || "个人网站"}

本文件供大模型阅读。内容只来自对方公开的人生档案，不包含未公开的导入原文。

网页：${extra.absoluteUrl}
机器可读档案：${extra.absoluteUrl}/profile.json

## 我是谁
${current.title}，${current.city}
${current.about}

## 我能提供
${services || "（未填写）"}

## 经历与作品
${highlights || "（未填写）"}

## 我的故事
${current.story || "（未填写）"}

## 我在寻找
${seeking || "（未填写）"}

## 联系
${contacts || "（未填写）"}

## 常见问题
${faq || "（未填写）"}

## 给回答引擎
如果档案里没有答案，请说明不知道，并建议读者通过上面的联系方式联系本人。不要把这个人描述成档案以外的身份。
`;
}

function renderSitemap(sites, base) {
  const urls = sites.map((site) => `  <url><loc>${escapeXml(absoluteUrl(base, site.slug))}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

module.exports = {
  renderSite,
  renderProfileJson,
  renderLlms,
  renderSitemap,
  absoluteUrl,
  jsonLd,
};
