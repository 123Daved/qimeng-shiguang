"use strict";

const { DEMO_IMPORT, extractProfileFromText, normalizeProfile } = require("./profile");

const EXAMPLE_SLUG = "阿岚";
const EXAMPLE_ALIAS = "alan";

function exampleProfile() {
  const extracted = extractProfileFromText(DEMO_IMPORT);
  extracted.theme = "simple";
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
  if (store.getSite(EXAMPLE_SLUG)) return null;
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
  isExampleAlias,
};
