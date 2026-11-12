"use strict";

const path = require("path");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  }[ch]));
}

function sanitizeUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 500) return "";
  if (/[\u0000-\u001F\s]/.test(raw)) return "";
  const lower = raw.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) return "";
  if (lower.startsWith("//")) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:" && protocol !== "mailto:" && protocol !== "tel:") return "";
  return url.toString();
}

function safeHexColor(value, fallback) {
  const raw = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : fallback;
}

function isSafeSlug(slug) {
  if (typeof slug !== "string") return false;
  if (!slug || slug.length > 48) return false;
  if (slug === "." || slug === "..") return false;
  if (slug.includes("..") || slug.includes("/") || slug.includes("\\") || slug.includes("%") || slug.includes("\0")) return false;
  if (/[?#&\s]/.test(slug)) return false;
  return /^[\p{L}\p{N}_-]+$/u.test(slug);
}

function slugFromName(name) {
  const chars = Array.from(String(name ?? "").trim()).filter((ch) => /^[\p{L}\p{N}_-]$/u.test(ch));
  let slug = chars.join("");
  if ([...slug].length > 24) slug = [...slug].slice(0, 24).join("");
  if (!isSafeSlug(slug)) return "site";
  return slug;
}

function resolveInside(root, ...parts) {
  const base = path.resolve(root);
  const target = path.resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + path.sep)) {
    const error = new Error("path");
    error.status = 404;
    throw error;
  }
  return target;
}

function tokenEquals(a, b) {
  const crypto = require("crypto");
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

module.exports = {
  escapeHtml,
  escapeXml,
  sanitizeUrl,
  safeHexColor,
  isSafeSlug,
  slugFromName,
  resolveInside,
  tokenEquals,
  jsonForScript,
};
