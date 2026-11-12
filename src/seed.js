"use strict";

const { DEMO_IMPORT, THEMES, extractProfileFromText, normalizeProfile } = require("./profile");

const EXAMPLE_SLUG = "阿岚";

function exampleProfile() {
  const extracted = extractProfileFromText(DEMO_IMPORT);
  extracted.theme = "simple";
  return normalizeProfile(extracted);
}

function seedExampleIfEmpty(store) {
  if (store.listSites().length > 0) return null;
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

module.exports = { seedExampleIfEmpty, exampleProfile, EXAMPLE_SLUG };
