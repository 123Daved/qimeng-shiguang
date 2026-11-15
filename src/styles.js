"use strict";

/*
 * 个人网站的三种职业风格：慢屋（民宿 / 慢生活）、纸山（作品集）、贴纸（产品 / 独立开发）。
 * 只负责页面主体（首屏 + 各版块）；<head>、结构化数据、AI 分身、页脚仍由 render.js 统一输出。
 *
 * 约定：
 * - 每个版块带 data-section，工作台可以点选它、用一句话只改这一块；草稿缺的版块显示「待补充」。
 * - 第二屏都是服务清单（PRD 12.10）。
 * - 用户内容一律转义；图片地址在 profile.js 里已经只放行 https 与站内 /img/。
 * - 手绘线、撕边、剪纸山都在服务端生成并内联，关掉脚本也能看到；同一个人每次形状相同。
 * - 没有图片时用风格自己的插画兜底，不显示灰色占位。
 */

const { escapeHtml: esc } = require("./security");
const O = require("./ornaments");

function seedOf(text) {
  let h = 7;
  for (const ch of String(text || "憩梦")) h = (Math.imul(h, 31) + ch.codePointAt(0)) >>> 0;
  return h || 1;
}

function glyph(name) {
  return Array.from(String(name || "").trim())[0] || "憩";
}

function brush(w, h, seed, opts = {}) {
  const d = O.brush(w, { seed, kind: opts.kind || "brush", amp: opts.amp || 3, h });
  return `<svg class="brush ${opts.cls || ""}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}

function img(image, cls, eager) {
  if (!image || !image.url) return "";
  return `<img class="${cls || ""}" src="${esc(image.url)}" alt="${esc(image.alt || "")}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer">`;
}

function firstSentence(text, max = 40) {
  const value = String(text || "").trim();
  if (!value) return "";
  const cut = value.split(/(?<=[。！？!?])/)[0];
  const chars = Array.from(cut);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : cut;
}

// 标题用：取第一个分句，太长就截断（例如经历的第一句常常是一整段话）。
function clause(text, max = 18) {
  const value = String(text || "").trim();
  const first = value.split(/[，。！？；,.!?;]/)[0] || value;
  const chars = Array.from(first);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : first;
}

// 说明文字：去掉结尾多余的标点，统一用句号收尾。
function sentence(text) {
  const value = String(text || "").trim().replace(/[，,。.、；;\s]+$/u, "");
  return value ? `${value}。` : "";
}

// 把一段话按标点断成 3–4 行，用于慢屋的手写诗句。
function poemLines(text) {
  const parts = String(text || "").split(/(?<=[，。、；！？,.!?])/).map((item) => item.trim()).filter(Boolean);
  return parts.slice(0, 4).map((line) => esc(line)).join("<br>");
}

// 版块状态类：不用旧主题的 .block（它带着旧版式的边距和分隔线），只保留 block-名字 作为钩子。
function stateClass(ctx, name) {
  return ["s-block", `block-${name}`, ctx.changed.has(name) ? "is-changed" : "", ctx.built.has(name) ? "is-built" : ""].filter(Boolean).join(" ");
}

/** 公共：版块外壳 */
function section(ctx, name, inner, opts = {}) {
  const pending = !!opts.pending;
  const id = opts.id || `sec-${name}`;
  const cls = [opts.cls || "", stateClass(ctx, name), pending ? "is-pending" : ""].filter(Boolean).join(" ");
  return `<section id="${id}" class="${cls}" data-section="${name}" data-reveal${opts.label ? ` aria-label="${esc(opts.label)}"` : ""}>${inner}</section>`;
}

function heroState(ctx) {
  const { changed, built } = ctx;
  return [
    changed.has("theme") || changed.has("accent") || changed.has("name") || changed.has("tagline") || changed.has("title") || changed.has("media") ? "is-changed" : "",
    built.has("hero") || built.has("theme") ? "is-built" : "",
    ctx.draft && !ctx.profile.name ? "is-pending" : "",
  ].filter(Boolean).join(" ");
}

function navLinks(ctx, items) {
  return items.filter(Boolean).map(([href, label, name]) => `<a href="${href}" data-nav="${name}">${esc(label)}</a>`).join("");
}

function contactList(ctx, cls) {
  return ctx.contacts.map((item) => {
    const inner = `${ctx.icon(ctx.contactIcon(item.key))}<span><small>${esc(item.label)}</small>${esc(item.value)}</span>`;
    if (!item.href) return `<div class="${cls}">${inner}</div>`;
    return `<a class="${cls}" href="${esc(item.href)}" data-channel="${esc(item.key)}">${inner}</a>`;
  }).join("");
}

function seekingLine(profile) {
  if (!profile.seeking.length) return "";
  return profile.seeking.map((item) => `${esc(item.who)}${item.description ? `（${esc(item.description)}）` : ""}`).join("、");
}

function has(ctx) {
  const p = ctx.profile;
  return {
    services: p.services.length > 0,
    about: !!p.about,
    highlights: p.highlights.length > 0,
    story: !!p.story,
    seeking: p.seeking.length > 0,
    contacts: ctx.contacts.length > 0,
  };
}

// 草稿里还没说到的版块显示「待补充」；正式页面没有内容的版块直接不出现。
function want(ctx, name, present) {
  return present || (ctx.draft && !ctx.filled.has(name));
}

/* ======================================================================== 慢屋 */
function slowhouse(ctx) {
  const p = ctx.profile;
  const seed = seedOf(ctx.slug || p.name);
  const h = has(ctx);
  const hero = p.media.hero;
  const gallery = p.media.gallery;
  const who = [p.title, p.city].filter(Boolean).map(esc).join(" · ");
  const poem = p.tagline || firstSentence(p.story) || firstSentence(p.about);
  const sky = `<svg class="sh-sea" viewBox="0 0 600 220" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path class="sh-hill" d="${O.mountain(600, 120, { seed, peaks: 3, rough: 0.25 })}" transform="translate(0 40)"/>
      <path class="sh-water" d="M0 160 L600 160 L600 220 L0 220 Z"/>
      ${[0, 1, 2].map((i) => `<path class="sh-wave" d="${O.brush(600, { seed: seed + i, kind: "wave", amp: 2.4, h: 14 })}" transform="translate(0 ${168 + i * 16})"/>`).join("")}
    </svg>`;
  const photo = hero
    ? img(hero, "sh-photo-img", true)
    : `<div class="sh-photo-art" aria-hidden="true"><span class="sh-window"></span><span class="sh-lamp"></span><span class="sh-glyph">${esc(glyph(p.name))}</span></div>`;

  const polaroids = p.services.slice(0, 3).map((service, i) => {
    const pic = gallery[i] ? img(gallery[i], "", false) : `<span class="sh-paper" aria-hidden="true">${esc(glyph(service.name))}</span>`;
    return `<figure class="sh-polaroid" data-reveal style="--i:${i}"><div class="sh-pic">${pic}</div><figcaption>〈${esc(service.name)}${service.price ? ` <b>${esc(service.price)}</b>` : ""}〉</figcaption></figure>`;
  }).join("");
  const band = h.services || ctx.draft
    ? `<section class="sh-band ${stateClass(ctx, "services")}${!h.services ? " is-pending" : ""}" data-section="services" aria-label="一眼看我能提供什么">
        <svg class="sh-edge" viewBox="0 0 1280 34" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="${O.torn(1280, 34, { seed, amp: 6, base: 0.55 })}"/></svg>
        <div class="sh-polaroids">${polaroids || ctx.pendingBlock("services")}</div>
        ${poem ? `<div class="sh-poem" data-reveal style="--i:3"><svg class="sh-vline" viewBox="0 0 8 200" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="M4 2 C1 50 7 100 3 150 S6 190 4 198"/></svg><p>${poemLines(poem)}</p>${brush(130, 12, seed + 4, { cls: "sh-poem-line" })}</div>` : ""}
      </section>`
    : "";

  const heading = (kicker, title, s) => `<p class="s-kicker">${esc(kicker)}</p><h2 class="s-h2">${esc(title)}</h2>${brush(130, 12, s, { cls: "s-h2-line" })}`;
  const parts = [];
  if (h.services || !ctx.draft) {
    const rows = p.services.map((service, i) => `<article class="sh-room" data-reveal style="--i:${i}"><h3>${esc(service.name)}</h3><p>${esc(sentence(service.description))}${service.for_whom ? `${service.description ? " " : ""}适合：${esc(sentence(service.for_whom))}` : ""}</p>${service.price ? `<p class="sh-price">${esc(service.price)}</p>` : "<span></span>"}</article>`).join("");
    parts.push(section(ctx, "services", `<div class="s-wrap">${heading("我能提供", "住下，或者只是来坐坐", seed + 8)}<div class="sh-rooms">${rows || '<p class="s-empty">还没有写下服务。</p>'}</div></div>`, { id: "services", cls: "sh-sec" }));
  }
  if (want(ctx, "story", h.story) || want(ctx, "about", h.about)) {
    const quote = firstSentence(p.story || p.about, 30);
    const body = [p.about, p.story].filter(Boolean).filter((text, i, list) => list.indexOf(text) === i).map((text) => `<p>${esc(text)}</p>`).join("");
    const inner = body
      ? `<div class="s-wrap sh-story"><div><p class="s-kicker">我的故事</p><span class="sh-qmark" aria-hidden="true">“</span><blockquote>${esc(quote)}</blockquote></div><div class="sh-story-body">${body}${gallery[3] ? `<div class="sh-wide">${img(gallery[3], "", false)}</div>` : ""}</div></div>`
      : `<div class="s-wrap">${heading("我的故事", "我的故事", seed + 9)}${ctx.pendingBlock("story")}</div>`;
    parts.push(section(ctx, "story", inner, { cls: "sh-sec sh-story-sec", pending: !body }));
  }
  if (want(ctx, "highlights", h.highlights)) {
    const items = p.highlights.map((item, i) => `<li data-reveal style="--i:${i}"><span class="sh-no">${String(i + 1).padStart(2, "0")}</span><div><h3>${esc(clause(item.title || item.description, 20))}</h3>${item.description && item.description !== item.title ? `<p>${esc(item.description)}</p>` : ""}</div></li>`).join("");
    parts.push(section(ctx, "highlights", `<div class="s-wrap">${heading("经历与作品", "慢慢做过的几件事", seed + 13)}${items ? `<ol class="sh-log">${items}</ol>` : ctx.pendingBlock("highlights")}</div>`, { cls: "sh-sec", pending: !items }));
  }
  const seek = seekingLine(p);
  const contactHtml = contactList(ctx, "sh-contact");
  parts.push(section(ctx, "contacts", `<div class="s-wrap">${heading("找我聊聊", "想来，或者只是想问一句", seed + 5)}
      ${contactHtml ? `<div class="sh-contacts">${contactHtml}</div>` : ctx.draft ? ctx.pendingBlock("contacts") : '<p class="s-empty">还没有留下联系方式。</p>'}
      ${seek ? `<p class="sh-seek" data-section="seeking">我也在找：${seek}</p>` : want(ctx, "seeking", false) ? `<div data-section="seeking" class="is-pending">${ctx.pendingBlock("seeking")}</div>` : ""}
      <a class="s-btn s-btn-light" href="#avatar" data-open-avatar>${ctx.icon("spark")}先问问 AI 分身</a></div>`, { id: "contact", cls: "sh-sec sh-contact-sec", pending: !contactHtml && ctx.draft }));

  const links = navLinks(ctx, [
    ["#services", "我能提供", "services"],
    want(ctx, "story", h.story || h.about) && ["#sec-story", "我的故事", "story"],
    h.highlights && ["#sec-highlights", "经历与作品", "highlights"],
    ["#contact", "联系我", "contacts"],
  ]);

  return `<div class="sh-fold">
    <header class="sh-hero ${heroState(ctx)}" id="top" data-section="hero">
      <div class="sh-sky">${sky}</div>
      <div class="sh-photo">${photo}</div>
      <nav class="sh-nav" aria-label="页面导航"><a class="sh-brand" href="#top">${ctx.icon("home")}<span>${esc(ctx.displayName)}</span></a><div class="sh-links site-links">${links}</div></nav>
      <div class="sh-title">
        <h1 data-reveal>${esc(ctx.displayName)}</h1>
        ${who ? `<p class="sh-who" data-reveal style="--i:1">${who}</p>` : ctx.draft ? '<p class="sh-who pending-text">先说说你是谁</p>' : ""}
        ${brush(210, 16, seed + 11, { cls: "sh-title-line" })}
      </div>
    </header>
    ${band}
  </div>
  <main>${parts.join("")}</main>`;
}

/* ======================================================================== 纸山 */
function papermountain(ctx) {
  const p = ctx.profile;
  const seed = seedOf(ctx.slug || p.name);
  const h = has(ctx);
  const hero = p.media.hero;
  const gallery = p.media.gallery;
  const mtn = (w, hh, s, peaks, cls) => `<svg class="${cls}" viewBox="0 0 ${w} ${hh}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="pm-m1" d="${O.mountain(w, hh, { seed: s, peaks, rough: 0.32 })}"/><path class="pm-m2" d="${O.mountain(w, hh, { seed: s + 7, peaks, rough: 0.3 }).replace(/L([\d.]+) ([\d.]+)/g, (m, x, y) => `L${x} ${Math.min(hh, Number(y) + hh * 0.22).toFixed(1)}`)}"/></svg>`;
  const portrait = hero ? img(hero, "pm-portrait-img", true) : `<div class="pm-portrait-art" aria-hidden="true"><span>${esc(glyph(p.name))}</span>${mtn(250, 120, seed + 3, 2, "pm-portrait-mtn")}</div>`;
  const label = p.tags[0] || p.title || "代表作";
  const lead = p.highlights[0];
  const wallItems = [0, 1, 2].map((i) => {
    if (gallery[i]) return `<div class="pm-tile" style="--d:${i}">${img(gallery[i], "", i === 0)}</div>`;
    const other = p.highlights[i + 1] || p.services[i];
    const text = other ? (other.title || other.name || "") : "";
    return `<div class="pm-tile pm-tile-art pm-art-${i}" style="--d:${i}" aria-hidden="true"><span>${esc(text || glyph(p.name))}</span></div>`;
  }).join("");

  const parts = [];
  if (want(ctx, "highlights", h.highlights)) {
    parts.push(section(ctx, "highlights", lead
      ? `<p class="pm-crumb">作品 / ${esc(label)}<i aria-hidden="true"></i></p><h2 class="pm-case-title">${esc(clause(lead.title || lead.description, 16))}${p.title ? ` <span>${esc(p.title)}</span>` : ""}</h2>${lead.description && lead.description !== lead.title ? `<p class="pm-desc">${esc(lead.description)}</p>` : ""}<div class="pm-wall">${wallItems}</div>`
      : `<p class="pm-crumb">作品<i aria-hidden="true"></i></p>${ctx.pendingBlock("highlights")}`, { id: "works", cls: "pm-case", pending: !lead }));
  }
  if (h.services || !ctx.draft) {
    const cards = p.services.map((service, i) => `<article data-reveal style="--i:${i}"><span class="pm-n">${String(i + 1).padStart(2, "0")}</span><h3>${esc(service.name)}</h3>${service.description ? `<p>${esc(service.description)}</p>` : ""}${service.for_whom ? `<p class="pm-for">适合：${esc(service.for_whom)}</p>` : ""}${service.price ? `<p class="pm-price">${esc(service.price)}</p>` : ""}</article>`).join("");
    parts.splice(h.highlights || ctx.draft ? 1 : 0, 0, section(ctx, "services", `<p class="pm-crumb">合作方式<i aria-hidden="true"></i></p><h2 class="pm-h2">可以一起做的事</h2><div class="pm-svc">${cards || '<p class="s-empty">还没有写下服务。</p>'}</div>`, { id: "services", cls: "pm-block" }));
  } else {
    parts.splice(1, 0, section(ctx, "services", `<p class="pm-crumb">合作方式<i aria-hidden="true"></i></p>${ctx.pendingBlock("services")}`, { id: "services", cls: "pm-block", pending: true }));
  }
  if (p.highlights.length > 1) {
    const more = p.highlights.slice(1).map((item, i) => `<li data-reveal style="--i:${i}"><b>${esc(clause(item.title || item.description, 18))}</b>${item.description && item.description !== item.title ? `<p>${esc(item.description)}</p>` : ""}</li>`).join("");
    parts.push(`<section class="pm-block" aria-label="更多作品"><p class="pm-crumb">更多作品<i aria-hidden="true"></i></p><ul class="pm-more">${more}</ul></section>`);
  }
  if (want(ctx, "story", h.story) || want(ctx, "about", h.about)) {
    const body = [p.about, p.story].filter(Boolean).filter((text, i, list) => list.indexOf(text) === i).map((text) => `<p>${esc(text)}</p>`).join("");
    parts.push(section(ctx, "story", `<p class="pm-crumb">经历<i aria-hidden="true"></i></p>${body ? `<div class="pm-prose">${body}</div>` : ctx.pendingBlock("story")}`, { id: "exp", cls: "pm-block", pending: !body }));
  }
  const seek = seekingLine(p);
  const contactHtml = contactList(ctx, "pm-contact");
  parts.push(section(ctx, "contacts", `<p class="pm-crumb">联系<i aria-hidden="true"></i></p><h2 class="pm-h2">有个想法，想聊聊？</h2>
      ${contactHtml ? `<div class="pm-contacts">${contactHtml}</div>` : ctx.draft ? ctx.pendingBlock("contacts") : '<p class="s-empty">还没有留下联系方式。</p>'}
      ${seek ? `<p class="pm-seek" data-section="seeking">我也在找：${seek}</p>` : want(ctx, "seeking", false) ? `<div data-section="seeking" class="is-pending">${ctx.pendingBlock("seeking")}</div>` : ""}
      <a class="s-btn" href="#avatar" data-open-avatar>${ctx.icon("spark")}先问问 AI 分身</a>
      ${mtn(360, 120, seed + 9, 2, "pm-contact-mtn")}`, { id: "contact", cls: "pm-block pm-contact-sec", pending: !contactHtml && ctx.draft }));

  const links = navLinks(ctx, [
    (h.highlights || ctx.draft) && ["#works", "作品", "highlights"],
    ["#services", "合作", "services"],
    (h.story || h.about) && ["#exp", "经历", "story"],
    ["#contact", "联系", "contacts"],
  ]);

  return `<div class="pm-layout">
    <aside class="pm-side ${heroState(ctx)}" id="top" data-section="hero">
      <div class="pm-portrait">${portrait}</div>
      <div class="pm-id"><h1>${esc(ctx.displayName)}</h1>${p.title ? `<p class="pm-role">${esc(p.title)}</p>` : ctx.draft ? '<p class="pm-role pending-text">先说说你是谁</p>' : ""}${p.city ? `<p class="pm-city">${ctx.icon("map")}${esc(p.city)}</p>` : ""}<span class="pm-short" aria-hidden="true"></span></div>
      <nav class="pm-nav site-links" aria-label="页面导航">${links}</nav>
      ${mtn(250, 110, seed, 2, "pm-side-mtn")}
    </aside>
    <main class="pm-main">
      <header class="pm-band" data-section="hero">
        <p class="pm-headline">${esc(p.title || ctx.displayName)}</p>
        ${brush(120, 12, seed + 6, { kind: "wave", amp: 3.2, cls: "pm-band-line" })}
        ${p.tagline ? `<p class="pm-tagline">${esc(p.tagline)}</p>` : ""}
        ${mtn(520, 130, seed + 14, 3, "pm-band-mtn")}
      </header>
      ${parts.join("")}
    </main>
  </div>`;
}

/* ======================================================================== 贴纸 */
function sticker(ctx) {
  const p = ctx.profile;
  const seed = seedOf(ctx.slug || p.name);
  const h = has(ctx);
  const hero = p.media.hero;
  const gallery = p.media.gallery;
  const headline = p.tagline || ctx.displayName;
  // 大标题最好不超过 12 个字（两行）；更长就整段显示并缩小字号，不截断用户的话。
  const long = Array.from(headline).length > 12;
  const lines = long ? [headline] : (headline.match(/^(.{2,6}?[的事情人]|.{1,6})(.*)$/u) || [headline, headline, ""]).slice(1).filter(Boolean);
  const photo = hero ? img(hero, "st-photo-img", true) : `<div class="st-photo-art" aria-hidden="true"><span>${esc(glyph(p.name))}</span></div>`;
  const tag = p.tags[0] || p.city;

  const parts = [];
  if (h.services || !ctx.draft) {
    const rows = p.services.map((service, i) => `<div class="st-row" data-reveal style="--i:${i}"><span class="st-no">${String(i + 1).padStart(2, "0")}</span><h3>${esc(service.name)}</h3><p>${esc(sentence(service.description))}${service.for_whom ? `${service.description ? " " : ""}适合：${esc(sentence(service.for_whom))}` : ""}</p>${service.price ? `<p class="st-price">${esc(service.price)}</p>` : "<span></span>"}</div>`).join("");
    parts.push(section(ctx, "services", `<h2 class="st-h2">怎么合作</h2><div class="st-svc">${rows || '<p class="s-empty">还没有写下服务。</p>'}</div>`, { id: "services", cls: "st-sec" }));
  } else {
    parts.push(section(ctx, "services", `<h2 class="st-h2">怎么合作</h2>${ctx.pendingBlock("services")}`, { id: "services", cls: "st-sec", pending: true }));
  }
  if (want(ctx, "highlights", h.highlights)) {
    const cards = p.highlights.slice(0, 6).map((item, i) => {
      const pic = gallery[i] ? img(gallery[i], "", false) : `<span class="st-card-art st-art-${i % 3}" aria-hidden="true">${esc(item.title || glyph(p.name))}</span>`;
      return `<article class="st-card" data-reveal style="--i:${i}"><div class="st-pic">${pic}</div><div class="st-cap"><h3>${esc(clause(item.title || item.description, 16))}</h3>${item.description && item.description !== item.title ? `<p>${esc(item.description)}</p>` : ""}</div></article>`;
    }).join("");
    parts.push(section(ctx, "highlights", `<h2 class="st-h2">项目 <svg class="st-arrow" viewBox="0 0 92 24" aria-hidden="true" focusable="false"><path d="M2 13 C20 10 40 15 60 12 S80 12 88 12 M78 4 C83 8 87 10 90 12 C86 15 82 18 78 21"/></svg></h2>${cards ? `<div class="st-cards">${cards}</div>` : ctx.pendingBlock("highlights")}`, { cls: "st-sec", pending: !cards }));
  }
  if (want(ctx, "story", h.story) || want(ctx, "about", h.about)) {
    const quote = firstSentence(p.story || p.about, 26);
    const body = [p.about, p.story].filter(Boolean).filter((text, i, list) => list.indexOf(text) === i).map((text) => `<p>${esc(text)}</p>`).join("");
    const tags = p.tags.length ? `<ul class="st-tags">${p.tags.slice(0, 6).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "";
    parts.push(section(ctx, "story", body ? `<div class="st-about"><blockquote>${esc(quote)}</blockquote><div>${body}${tags}</div></div>` : `<h2 class="st-h2">关于我</h2>${ctx.pendingBlock("story")}`, { id: "about", cls: "st-sec", pending: !body }));
  }
  const seek = seekingLine(p);
  const contactHtml = contactList(ctx, "st-contact");
  parts.push(section(ctx, "contacts", `<div class="st-talk-in"><h2 class="st-talk-h">找我聊聊 →</h2>
      ${contactHtml ? `<div class="st-contacts">${contactHtml}</div>` : ctx.draft ? ctx.pendingBlock("contacts") : '<p class="s-empty">还没有留下联系方式。</p>'}
      ${seek ? `<p class="st-seek" data-section="seeking">我也在找：${seek}</p>` : want(ctx, "seeking", false) ? `<div data-section="seeking" class="is-pending">${ctx.pendingBlock("seeking")}</div>` : ""}
      <a class="s-btn s-btn-ink" href="#avatar" data-open-avatar>${ctx.icon("spark")}先问问 AI 分身</a></div>`, { id: "contact", cls: "st-talk", pending: !contactHtml && ctx.draft }));

  const links = navLinks(ctx, [
    ["#services", "合作", "services"],
    h.highlights && ["#sec-highlights", "项目", "highlights"],
    (h.story || h.about) && ["#about", "关于", "story"],
    ["#contact", "找我聊聊", "contacts"],
  ]);
  const meta = [p.title, p.city].filter(Boolean).map(esc).join(" · ");

  return `<header class="st-top ${heroState(ctx)}" id="top" data-section="hero">
    <div class="st-photo">${photo}
      <svg class="st-sparks" viewBox="0 0 76 54" aria-hidden="true" focusable="false"><path d="M8 44 L22 28 M30 20 L38 4 M48 24 L66 14"/></svg>
      ${tag ? `<p class="st-sticker" aria-hidden="true">#${esc(tag)}</p>` : ""}
    </div>
    <div class="st-block">
      <p class="st-me"><span class="st-name">${esc(ctx.displayName)}</span>${meta ? `<small>${meta}</small>` : ctx.draft ? '<small class="pending-text">先说说你是谁</small>' : ""}</p>
      <h1${long ? ' class="st-long"' : ""}>${lines.map((line, i) => `<span class="st-ln"><span style="--i:${i}">${esc(line)}</span></span>`).join("")}</h1>
      ${brush(250, 20, seed + 17, { kind: "wave", amp: 5, cls: "st-squig" })}
    </div>
    <nav class="st-nav site-links" aria-label="页面导航">${links}</nav>
  </header>
  <main>${parts.join("")}</main>`;
}

const LAYOUTS = Object.assign(Object.create(null), { slowhouse, papermountain, sticker });

function renderStyleBody(styleId, ctx) {
  const layout = LAYOUTS[styleId];
  return layout ? layout(ctx) : "";
}

module.exports = { renderStyleBody, STYLE_IDS: Object.keys(LAYOUTS), seedOf };
