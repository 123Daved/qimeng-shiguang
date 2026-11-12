"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { isSafeSlug, resolveInside } = require("./security");

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function createStore(dataDir) {
  const root = path.resolve(dataDir);
  const sessionsDir = resolveInside(root, "sessions");
  const sitesDir = resolveInside(root, "sites");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(sitesDir, { recursive: true });
  const eventsFile = resolveInside(root, "events.json");

  function sessionFile(id) {
    if (!/^[A-Za-z0-9_-]{8,32}$/.test(id)) {
      const error = new Error("session");
      error.status = 404;
      throw error;
    }
    return resolveInside(sessionsDir, `${id}.json`);
  }

  function siteFile(slug) {
    if (!isSafeSlug(slug)) {
      const error = new Error("slug");
      error.status = 404;
      throw error;
    }
    return resolveInside(sitesDir, `${slug}.json`);
  }

  function saveSession(session) {
    writeJson(sessionFile(session.id), session);
    return session;
  }

  function getSession(id) {
    return readJson(sessionFile(id), null);
  }

  function saveSite(site) {
    writeJson(siteFile(site.slug), site);
    return site;
  }

  function getSite(slug) {
    if (!isSafeSlug(slug)) return null;
    return readJson(siteFile(slug), null);
  }

  function listSites() {
    const names = fs.readdirSync(sitesDir).filter((name) => name.endsWith(".json"));
    return names
      .map((name) => readJson(path.join(sitesDir, name), null))
      .filter(Boolean);
  }

  function addEvent(event) {
    const events = readJson(eventsFile, []);
    events.push({ ...event, at: Date.now() });
    writeJson(eventsFile, events.slice(-5000));
  }

  function newId(bytes = 9) {
    return crypto.randomBytes(bytes).toString("base64url");
  }

  return { root, saveSession, getSession, saveSite, getSite, listSites, addEvent, newId };
}

module.exports = { createStore };
