"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { createStore } = require("./store");
const { createService } = require("./service");
const { renderSite, renderProfileJson, renderLlms, renderSitemap, absoluteUrl } = require("./render");
const { resolveInside, isSafeSlug } = require("./security");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const sessionQueues = new Map();

function gate(key, fn) {
  const previous = sessionQueues.get(key) || Promise.resolve();
  const run = previous.then(fn, fn);
  sessionQueues.set(key, run.then(() => {}, () => {}));
  return run;
}
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

function createServer(options = {}) {
  const config = {
    dataDir: options.dataDir || process.env.DATA_DIR || path.join(process.cwd(), "data"),
    demoMode: options.demoMode !== undefined ? !!options.demoMode : process.env.DEMO_MODE === "1",
    llmBaseUrl: options.llmBaseUrl !== undefined ? options.llmBaseUrl : process.env.LLM_BASE_URL || "",
    llmModel: options.llmModel !== undefined ? options.llmModel : process.env.LLM_MODEL || "deepseek-v4.1-flash-1017",
    llmApiKey: options.llmApiKey !== undefined ? options.llmApiKey : process.env.LLM_API_KEY || "",
    modelNotice: options.modelNotice || process.env.MODEL_NOTICE || "模型名称与备案号：上线前公示",
    publicBaseUrl: options.publicBaseUrl || process.env.PUBLIC_BASE_URL || "",
    fetchImpl: options.fetchImpl,
  };
  const store = createStore(config.dataDir);
  const service = createService(store, config);

  const server = http.createServer((req, res) => {
    handle(req, res, { config, service, store }).catch((error) => {
      const status = error.status || 500;
      const message = error.expose ? error.message : "刚才没完成，请再试一次。";
      sendJson(res, status, { error: message });
    });
  });
  server.appConfig = config;
  return server;
}

async function handle(req, res, ctx) {
  const url = new URL(req.url, "http://127.0.0.1");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendJson(res, 400, { error: "地址无法识别。" });
  }
  if (pathname.includes("\0")) return sendJson(res, 400, { error: "地址无法识别。" });
  const method = req.method || "GET";
  if (method === "GET" && pathname === "/api/health") return sendJson(res, 200, { ok: true });
  if (method === "GET" && pathname === "/api/config") {
    return sendJson(res, 200, {
      product: "憩梦时光",
      demoMode: ctx.config.demoMode || !ctx.config.llmApiKey,
      model: ctx.config.llmModel,
      modelNotice: ctx.config.modelNotice,
    });
  }
  if (method === "GET" && pathname === "/api/import/prompt") {
    return sendJson(res, 200, { prompt: ctx.service.importPrompt });
  }
  if (method === "POST" && pathname === "/api/sessions") {
    const body = await readBody(req);
    const created = ctx.service.createSession({ mode: body.mode, source: body.source, ref: body.ref });
    return sendJson(res, 201, created);
  }
  if (method === "POST" && pathname === "/api/events") {
    const body = await readBody(req);
    const type = String(body.type || "").slice(0, 40);
    if (!/^[a-z_]+$/.test(type)) return sendJson(res, 400, { error: "事件名称不正确。" });
    ctx.store.addEvent({ type, slug: String(body.slug || body.ref || "").slice(0, 80), source: String(body.source || "").slice(0, 40) });
    return sendJson(res, 202, { ok: true });
  }
  if (method === "GET" && pathname === "/api/discover") {
    const result = ctx.service.discover(url.searchParams.get("q") || "");
    ctx.store.addEvent({ type: "discover_search", q: result.query, result_count: result.results.length });
    return sendJson(res, 200, result);
  }
  if (method === "GET" && pathname === "/sitemap.xml") {
    const base = originOf(req, ctx.config);
    sendText(res, 200, renderSitemap(ctx.store.listSites(), base), "application/xml; charset=utf-8");
    return;
  }

  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "api" && parts[1] === "sessions" && parts[2]) {
    const id = parts[2];
    const token = req.headers["x-edit-token"] || url.searchParams.get("key") || "";
    if (method === "GET" && parts.length === 3) return sendJson(res, 200, ctx.service.ownerSession(ctx.service.requireSession(id, token)));
    if (method === "GET" && parts[3] === "preview") return sendPreview(req, res, ctx, id, token);
    const body = method === "POST" ? await readBody(req) : {};
    const auth = req.headers["x-edit-token"] || body.token || "";
    if (method === "POST" && parts[3] === "messages") return sendJson(res, 200, await gate(id, () => ctx.service.sendMessage(id, auth, body.text)));
    if (method === "POST" && parts[3] === "imports") return sendJson(res, 200, await gate(id, () => ctx.service.addImport(id, auth, body.text, body.kind)));
    if (method === "POST" && parts[3] === "profile") return sendJson(res, 200, await gate(id, () => ctx.service.generateProfile(id, auth)));
    if (method === "POST" && parts[3] === "edits") return sendJson(res, 200, await gate(id, () => ctx.service.editProfile(id, auth, body.instruction)));
    if (method === "POST" && parts[3] === "publish") return sendJson(res, 200, await gate(id, () => ctx.service.publish(id, auth, body.slug, originOf(req, ctx.config))));
    return sendJson(res, 404, { error: "没有这个接口。" });
  }
  if (parts[0] === "api" && parts[1] === "sites" && parts[2]) {
    const slug = parts[2];
    if (!isSafeSlug(slug)) return sendJson(res, 404, { error: "没有这个网站。" });
    if (method === "GET" && parts[3] === "stats") return sendJson(res, 200, ctx.service.stats(slug));
    if (method === "POST" && parts[3] === "ask") {
      const body = await readBody(req);
      return sendJson(res, 200, await ctx.service.ask(slug, body.question));
    }
    return sendJson(res, 404, { error: "没有这个接口。" });
  }
  if (parts[0] === "preview" && parts[1] && method === "GET") {
    return sendPreview(req, res, ctx, parts[1], url.searchParams.get("key") || "");
  }
  if (parts[0] === "u" && parts[1] && method === "GET") {
    const slug = parts[1];
    if (!isSafeSlug(slug) || parts.length > 3) return sendText(res, 404, "没有这个网站。", "text/plain; charset=utf-8");
    const site = ctx.service.getPublicSite(slug);
    if (!site) return sendText(res, 404, "没有这个网站。", "text/plain; charset=utf-8");
    const base = originOf(req, ctx.config);
    const pageUrl = absoluteUrl(base, slug);
    if (parts[2] === "profile.json") {
      ctx.store.addEvent({ type: "machine_file_fetch", slug, file: "profile.json" });
      return sendJson(res, 200, renderProfileJson(site.profile, { slug, absoluteUrl: pageUrl }));
    }
    if (parts[2] === "llms.txt") {
      ctx.store.addEvent({ type: "machine_file_fetch", slug, file: "llms.txt" });
      return sendText(res, 200, renderLlms(site.profile, { absoluteUrl: pageUrl }), "text/plain; charset=utf-8");
    }
    if (parts[2]) return sendText(res, 404, "没有这个文件。", "text/plain; charset=utf-8");
    ctx.service.recordVisit(slug);
    const html = renderSite({
      profile: site.profile,
      slug,
      pageUrl: `/u/${encodeURIComponent(slug)}`,
      absoluteUrl: pageUrl,
      modelNotice: ctx.config.modelNotice,
      example: site.example,
    });
    return sendText(res, 200, html, "text/html; charset=utf-8");
  }
  if (method !== "GET" && method !== "HEAD") return sendJson(res, 404, { error: "没有这个页面。" });
  return serveStatic(res, pathname);
}

function sendPreview(req, res, ctx, id, token) {
  const session = ctx.service.requireSession(id, token);
  if (!session.profile) {
    sendText(res, 404, "还没有生成网站。", "text/plain; charset=utf-8");
    return;
  }
  const base = originOf(req, ctx.config);
  const html = renderSite({
    profile: session.profile,
    slug: session.slug || "",
    pageUrl: session.slug ? absoluteUrl(base, session.slug) : "",
    absoluteUrl: session.slug ? absoluteUrl(base, session.slug) : "",
    modelNotice: ctx.config.modelNotice,
    preview: true,
    published: !!session.published,
    changed: session.lastChanged || [],
    example: !!session.demo,
  });
  sendText(res, 200, html, "text/html; charset=utf-8");
}

function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let file;
  try {
    file = resolveInside(PUBLIC_DIR, rel);
  } catch {
    sendText(res, 404, "没有这个页面。", "text/plain; charset=utf-8");
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    sendText(res, 404, "没有这个页面。", "text/plain; charset=utf-8");
    return;
  }
  const type = TYPES[path.extname(file)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
  fs.createReadStream(file).pipe(res);
}

function originOf(req, config) {
  if (config.publicBaseUrl) return config.publicBaseUrl.replace(/\/$/, "");
  const host = req.headers.host || "127.0.0.1";
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0];
  return `${proto}://${host}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 200000) {
        reject(Object.assign(new Error("内容太长了。"), { status: 413, expose: true }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("请求格式不对。"), { status: 400, expose: true }));
      }
    });
    req.on("error", () => reject(Object.assign(new Error("请求中断了。"), { status: 400, expose: true })));
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

if (require.main === module) {
  loadEnv(path.join(process.cwd(), ".env"));
  const server = createServer();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  server.listen(port, host, () => {
    const shown = host === "0.0.0.0" ? "127.0.0.1" : host;
    const mode = server.appConfig.demoMode || !server.appConfig.llmApiKey ? "离线规则智能体" : "大模型（出错自动降级）";
    console.log(`憩梦时光已启动 http://${shown}:${port}`);
    console.log(`当前：${mode}`);
  });
}

module.exports = { createServer, loadEnv };
