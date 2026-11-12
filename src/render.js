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

function sectionClass(name, changed) {
  const hit = changed && typeof changed.has === "function" ? changed.has(name) : changed && changed.includes(name);
  return hit ? "block is-changed" : "block";
}

function renderSite(options) {
  const profile = normalizeProfile(options.profile);
  const slug = options.slug || "";
  const pageUrl = options.pageUrl || (slug ? `/u/${encodeURIComponent(slug)}` : "");
  const changed = new Set(options.changed || []);
  const theme = THEMES[profile.theme] || THEMES.warm;
  const contacts = contactItems(profile);
  const faqQuestions = profile.faq.map((item) => item.q);
  const boot = jsonForScript({
    slug,
    faqs: faqQuestions,
  });
  const ld = jsonForScript(jsonLd(profile, options.absoluteUrl || pageUrl));
  const tags = profile.tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("");
  const services = profile.services.map((service) => `
    <article class="service">
      <header>
        <h3>${escapeHtml(service.name)}</h3>
        ${service.price ? `<p class="price">${escapeHtml(service.price)}</p>` : ""}
      </header>
      ${service.description ? `<p>${escapeHtml(service.description)}</p>` : ""}
      ${service.for_whom ? `<p class="for">适合：${escapeHtml(service.for_whom)}</p>` : ""}
    </article>`).join("");
  const highlights = profile.highlights.map((item) => `
    <article>
      ${item.title ? `<h3>${escapeHtml(item.title)}</h3>` : ""}
      ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
    </article>`).join("");
  const seeking = profile.seeking.map((item) => `<li><strong>${escapeHtml(item.who)}</strong>${item.description ? `：${escapeHtml(item.description)}` : ""}</li>`).join("");
  const contactHtml = contacts.map((item) => {
    const inner = `${icon(CONTACT_ICONS[item.key] || "link")}<span><small>${escapeHtml(item.label)}</small>${escapeHtml(item.value)}</span>`;
    if (!item.href) return `<div class="contact">${inner}</div>`;
    return `<a class="contact" href="${escapeHtml(item.href)}" data-channel="${escapeHtml(item.key)}">${inner}</a>`;
  }).join("");
  const suggestions = faqQuestions.map((q) => `<button type="button" class="chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join("");
  const machine = slug ? `<p class="machine"><a href="/u/${encodeURIComponent(slug)}/profile.json">profile.json</a><a href="/u/${encodeURIComponent(slug)}/llms.txt">llms.txt</a></p>` : "";
  const example = options.example ? `<p class="example-flag">${icon("info")}示例 / 演示数据，不是已核验的真实用户</p>` : "";
  const preview = options.preview ? `<p class="example-flag">${icon("info")}${options.published ? "预览，修改会同步到已发布的网站" : "预览，还没有发布"}</p>` : "";

  return `<!DOCTYPE html>
<html lang="zh-CN" data-qd-product="life" data-qd-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(profile.name || "未命名")} · 憩梦时光</title>
  <meta name="description" content="${escapeHtml(profile.tagline || profile.about || "个人网站")}">
  ${pageUrl ? `<link rel="canonical" href="${escapeHtml(options.absoluteUrl || pageUrl)}">` : ""}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
  <script type="application/ld+json">${ld}</script>
</head>
<body class="site theme-${escapeHtml(profile.theme)}" style="--site-accent:${escapeHtml(theme.accent)}">
  <a class="skip" href="#services">跳到服务清单</a>
  ${example}
  ${preview}
  <header class="hero ${changed.has("theme") || changed.has("accent") || changed.has("name") || changed.has("about") ? "is-changed" : ""}">
    <p class="brand">${MARK}<span>憩梦时光</span></p>
    <h1>${escapeHtml(profile.name || "未命名")}</h1>
    ${profile.title ? `<p class="title">${escapeHtml(profile.title)}</p>` : ""}
    ${profile.tagline ? `<p class="tagline">${escapeHtml(profile.tagline)}</p>` : ""}
    ${profile.city ? `<p class="city">${escapeHtml(profile.city)}</p>` : ""}
    ${tags ? `<ul class="tags">${tags}</ul>` : ""}
  </header>
  <main>
    <section id="services" class="${sectionClass("services", changed)}" data-section="services">
      <h2>我能提供</h2>
      ${services || "<p class=\"empty\">还没有写下服务。</p>"}
    </section>
    ${profile.about ? `<section class="${sectionClass("about", changed)}" data-section="about"><h2>关于我</h2><p>${escapeHtml(profile.about)}</p></section>` : ""}
    ${highlights ? `<section class="${sectionClass("highlights", changed)}" data-section="highlights"><h2>经历与作品</h2>${highlights}</section>` : ""}
    ${profile.story ? `<section class="${sectionClass("story", changed)}" data-section="story"><h2>我的故事</h2><p>${escapeHtml(profile.story)}</p></section>` : ""}
    ${seeking ? `<section class="${sectionClass("seeking", changed)}" data-section="seeking"><h2>我在寻找</h2><ul>${seeking}</ul></section>` : ""}
    <section class="${sectionClass("contacts", changed)}" data-section="contacts">
      <h2>联系我</h2>
      <div class="contacts">${contactHtml || "<p class=\"empty\">还没有留下联系方式。</p>"}</div>
    </section>
  </main>
  <footer class="site-footer">
    <a class="footer-cta" href="/?from=footer&amp;ref=${encodeURIComponent(slug)}">我也要一个 →</a>
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
    <p class="avatar-note">只根据这份公开档案回答。不知道的事会请你直接联系本人。</p>
    <div class="chips" id="avatar-chips">${suggestions}</div>
    <div class="avatar-log" id="avatar-log" aria-live="polite"></div>
    <form id="avatar-form">
      <label for="avatar-input">你的问题</label>
      <div class="composer">
        <input id="avatar-input" name="question" maxlength="300" placeholder="例如：住宿多少钱？" autocomplete="off">
        <button class="primary" type="submit">发送</button>
      </div>
    </form>
  </section>
  <script>window.__QD_SITE__=${boot};</script>
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
