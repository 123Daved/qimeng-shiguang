"use strict";

const { DEMO_IMPORT, extractProfileFromText, normalizeProfile } = require("./profile");

const EXAMPLE_SLUG = "阿岚";
const EXAMPLE_ALIAS = "alan";
const EXAMPLE_THEME = "editorial";

function exampleProfile() {
  const extracted = extractProfileFromText(DEMO_IMPORT);
  extracted.theme = EXAMPLE_THEME;
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
    // 旧版本种下的示例用的是简约主题；示例站点升级为杂志主题以展示新版式。
    if (existing.example && existing.sessionId === "example-alan" && existing.profile && existing.profile.theme !== EXAMPLE_THEME) {
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
