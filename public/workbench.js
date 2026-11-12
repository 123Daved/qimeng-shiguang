"use strict";

const TOPICS = [
  ["who", "你是谁"],
  ["offer", "能提供什么"],
  ["work", "经历与作品"],
  ["story", "你的故事"],
  ["seek", "联系与寻找"],
  ["style", "网站风格"],
];

const params = new URLSearchParams(location.search);
const sid = params.get("sid") || "";
const key = params.get("key") || "";
let session = null;

const banner = document.querySelector("#banner");
const progress = document.querySelector("#progress");
const chat = document.querySelector("#chat");
const profileCards = document.querySelector("#profile-cards");
const preview = document.querySelector("#preview");
const publishResult = document.querySelector("#publish-result");

function headers() {
  return { "Content-Type": "application/json", "X-Edit-Token": key };
}

function showBanner(text, kind) {
  banner.textContent = text;
  banner.className = `banner ${kind || ""}`;
  banner.classList.remove("hidden");
}

function field(title, value) {
  const box = document.createElement("div");
  box.className = "profile-card";
  const h = document.createElement("h3");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = value || "还没写";
  box.append(h, p);
  return box;
}

function renderProgress(coverage) {
  progress.replaceChildren();
  const current = TOPICS.find(([id]) => !coverage[id]);
  for (const [id, label] of TOPICS) {
    const item = document.createElement("li");
    let state = "todo";
    let stateText = "未覆盖";
    if (coverage[id]) {
      state = "done";
      stateText = "已覆盖";
    } else if (current && current[0] === id) {
      state = "current";
      stateText = "进行中";
    }
    item.dataset.state = state;
    const name = document.createElement("strong");
    name.textContent = label;
    const status = document.createElement("span");
    status.textContent = stateText;
    item.append(name, status);
    progress.append(item);
  }
}

function renderChat(messages) {
  chat.replaceChildren();
  for (const message of messages || []) {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${message.role === "user" ? "user" : "assistant"}`;
    bubble.textContent = message.content;
    chat.append(bubble);
  }
  chat.scrollTop = chat.scrollHeight;
}

function renderProfile(profile) {
  profileCards.replaceChildren();
  if (!profile) return;
  const services = (profile.services || []).map((item) => `${item.name} ${item.price || ""}`.trim()).join("；");
  const seeking = (profile.seeking || []).map((item) => item.who).join("；");
  profileCards.append(
    field("称呼 / 身份", [profile.name, profile.title, profile.city].filter(Boolean).join(" · ")),
    field("一句话", profile.tagline),
    field("关于我", profile.about),
    field("我能提供", services),
    field("我在寻找", seeking),
    field("故事", profile.story),
    field("主题", `${profile.theme === "simple" ? "简约" : profile.theme === "ink" ? "墨色" : "温暖"} ${profile.accent || ""}`),
  );
}

function renderSession(next) {
  session = next;
  renderProgress(next.coverage || {});
  renderChat(next.messages || []);
  renderProfile(next.profile);
  if (next.demo) showBanner("示例 / 演示：这是预置的双月湾民宿主理人阿岚，不是已核验的真实用户。", "warn");
  else if (next.fallback) showBanner("已切换离线模式。这次没有连上大模型，已改用规则继续，流程不会中断。", "");
  if (next.profile) {
    preview.hidden = false;
    const changed = (next.lastChanged || next.changed || []).join(",");
    preview.src = `/preview/${encodeURIComponent(sid)}?key=${encodeURIComponent(key)}&t=${Date.now()}&hl=${encodeURIComponent(changed)}`;
  }
  if (next.published && next.url) renderPublish(next);
  const link = document.querySelector("#edit-link");
  link.textContent = "编辑链接就是编辑密钥，已经在浏览器地址栏里。请只自己保存，不要发到公开场合。";
}

function renderPublish(data) {
  publishResult.classList.remove("hidden");
  publishResult.replaceChildren();
  const flag = document.createElement("p");
  flag.className = "banner ok";
  flag.textContent = "已发布";
  const link = document.createElement("a");
  link.className = "publish-link";
  link.id = "public-link";
  link.href = data.url;
  link.textContent = decodeURIComponent(data.url);
  const copy = document.createElement("button");
  copy.className = "secondary";
  copy.id = "copy-link";
  copy.type = "button";
  copy.textContent = "复制链接";
  copy.addEventListener("click", async () => {
    const absolute = new URL(data.url, location.origin).href;
    try {
      await navigator.clipboard.writeText(absolute);
      copy.textContent = "已复制";
    } catch {
      copy.textContent = absolute;
    }
    fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "share_copy", slug: data.slug }) });
  });
  publishResult.append(flag, link, copy);
  if (data.qr) {
    const image = document.createElement("img");
    image.className = "qr";
    image.alt = "网站二维码";
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.qr)}`;
    const download = document.createElement("a");
    download.className = "secondary";
    download.href = image.src;
    download.download = "qimeng-qr.svg";
    download.textContent = "下载二维码";
    publishResult.append(image, download);
  }
  const machine = document.createElement("p");
  machine.className = "machine";
  const profileLink = document.createElement("a");
  profileLink.href = data.profileUrl || `${data.url}/profile.json`;
  profileLink.textContent = "profile.json";
  const llms = document.createElement("a");
  llms.href = data.llmsUrl || `${data.url}/llms.txt`;
  llms.textContent = "llms.txt";
  machine.append(profileLink, llms);
  publishResult.append(machine);
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "没有完成，请再试一次。");
  return data;
}

async function boot() {
  const config = await fetch("/api/config").then((response) => response.json());
  document.querySelector("#model-notice").textContent = config.modelNotice || "";
  const prompt = await api("/api/import/prompt");
  document.querySelector("#import-prompt").value = prompt.prompt;
  if (!sid || !key) {
    showBanner("还没有创作会话。请从首页「开始制作」。", "warn");
    return;
  }
  const current = await api(`/api/sessions/${encodeURIComponent(sid)}`, { headers: headers() });
  renderSession(current);
  if (current.imports && current.imports[0]) document.querySelector("#import-text").value = current.imports[0].text;
}

document.querySelector("#answer-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#send");
  const input = document.querySelector("#answer");
  button.disabled = true;
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(sid)}/messages`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ text: input.value }),
    });
    input.value = "";
    renderSession(data);
  } catch (error) {
    showBanner(error.message, "warn");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#copy-prompt").addEventListener("click", async () => {
  const text = document.querySelector("#import-prompt").value;
  try {
    await navigator.clipboard.writeText(text);
    document.querySelector("#copy-state").textContent = "已复制";
  } catch {
    document.querySelector("#copy-state").textContent = "请手动选择提问词复制";
  }
  fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "import_prompt_copy" }) });
});

document.querySelector("#import-submit").addEventListener("click", async () => {
  const button = document.querySelector("#import-submit");
  button.disabled = true;
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(sid)}/imports`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ text: document.querySelector("#import-text").value, kind: "ai" }),
    });
    renderSession(data);
  } catch (error) {
    showBanner(error.message, "warn");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#generate").addEventListener("click", async () => {
  const button = document.querySelector("#generate");
  button.disabled = true;
  button.textContent = "生成中";
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(sid)}/profile`, { method: "POST", headers: headers() });
    renderSession(data);
  } catch (error) {
    showBanner(error.message, "warn");
  } finally {
    button.disabled = false;
    button.textContent = "生成网站";
  }
});

document.querySelector("#edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#edit");
  button.disabled = true;
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(sid)}/edits`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ instruction: document.querySelector("#instruction").value }),
    });
    renderSession(data);
  } catch (error) {
    showBanner(error.message, "warn");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#publish-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#publish");
  button.disabled = true;
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(sid)}/publish`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ slug: document.querySelector("#slug").value }),
    });
    renderSession(data);
    renderPublish(data);
    document.querySelector("#publish-result").scrollIntoView({ block: "center" });
  } catch (error) {
    showBanner(error.message, "warn");
  } finally {
    button.disabled = false;
  }
});

boot().catch((error) => showBanner(error.message, "warn"));
