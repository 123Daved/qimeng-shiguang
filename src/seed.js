"use strict";

const { DEMO_IMPORT, extractProfileFromText, normalizeProfile } = require("./profile");

const EXAMPLE_SLUG = "阿岚";
const EXAMPLE_ALIAS = "alan";
// 示例人物阿岚是民宿主理人，用「慢屋」风格；首图与图集用仓库自带的图片（不使用来源未确认的图）。
const EXAMPLE_THEME = "slowhouse";
const EXAMPLE_MEDIA = {
  hero: { url: "/img/hero-seaside.webp", alt: "傍晚的海边露台，桌上放着一杯茶和一本打开的笔记本" },
  gallery: [{ url: "/img/story-craft.webp", alt: "木桌上摆着手作陶器和纸笔", caption: "" }],
};

function exampleProfile() {
  const extracted = extractProfileFromText(DEMO_IMPORT);
  extracted.theme = EXAMPLE_THEME;
  extracted.media = EXAMPLE_MEDIA;
  const profile = normalizeProfile(extracted);
  if (profile.contacts && /风格/.test(profile.contacts.website || "")) {
    profile.contacts.website = "";
  }
  return profile;
}

function isExampleAlias(slug) {
  return String(slug || "").toLowerCase() === EXAMPLE_ALIAS;
}

function seedExampleIfEmpty(store) {
  const existing = store.getSite(EXAMPLE_SLUG);
  if (existing) {
    // 旧版本种下的示例（简约 / 杂志主题、没有图片）升级为当前的示例。
    if (existing.example && existing.sessionId === "example-alan" && existing.profile && (existing.profile.theme !== EXAMPLE_THEME || !existing.profile.media)) {
      existing.profile = exampleProfile();
      store.saveSite(existing);
    }
    return null;
  }
  const now = Date.parse("2026-11-12T00:00:00Z");
  const site = {
    slug: EXAMPLE_SLUG,
    sessionId: "example-alan",
    profile: exampleProfile(),
    example: true,
    publishedAt: now,
    updatedAt: now,
    visits: 0,
    avatarAsks: 0,
  };
  store.saveSite(site);
  return site;
}

module.exports = {
  seedExampleIfEmpty,
  exampleProfile,
  EXAMPLE_SLUG,
  EXAMPLE_ALIAS,
  EXAMPLE_THEME,
  isExampleAlias,
};
