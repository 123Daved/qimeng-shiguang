"use strict";

const TOPICS = [
  ["who", "你是谁"],
  ["offer", "能提供什么"],
  ["work", "经历与作品"],
  ["story", "你的故事"],
  ["seek", "联系与寻找"],
  ["style", "网站风格"],
];

const THEME_OPTIONS = [
  ["warm", "温暖", "风格换成温暖"],
  ["simple", "简约", "风格换成简约"],
  ["ink", "墨色", "风格换成墨色"],
];

const EDIT_CHIPS = [
  "换成简约风格",
  "把价格写清楚",
  "简介写得更短一些",
  "把联系方式写完整",
];

const params = new URLSearchParams(location.search);
const sid = params.get("sid") || "";
const key = params.get("key") || "";
let session = null;
let busy = false;

const banner = document.querySelector("#banner");
const progress = document.querySelector("#progress");
const chat = document.querySelector("#chat");
const profileCards = document.querySelector("#profile-cards");
const preview = document.querySelector("#preview");
const previewEmpty = document.querySelector("#preview-empty");
const publishResult = document.querySelector("#publish-result");
const themePicks = document.querySelector("#theme-picks");
const editChips = document.querySelector("#edit-chips");
const previewFrame = document.querySelector("#preview-frame");
const progressBar = document.querySelector("#progress-bar");
const progressTrack = document.querySelector("#progress-track");
const progressCount = document.querySelector("#progress-count");

preview.addEventListener("load", () => preview.classList.remove("is-swapping"));

function icon(name) {
  return (window.QDIcons && window.QDIcons.icon(name)) || "";
}

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
  const done = TOPICS.filter(([id]) => coverage[id]).length;
  if (progressBar) progressBar.style.width = `${(done / TOPICS.length) * 100}%`;
  if (progressTrack) progressTrack.setAttribute("aria-valuenow", String(done));
  if (progressCount) progressCount.textContent = `${done} / ${TOPICS.length}`;
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
    if (state === "current") item.setAttribute("aria-current", "step");
    const name = document.createElement("strong");
    name.textContent = label;
    const status = document.createElement("span");
    status.className = "step-status";
    status.textContent = stateText;
    item.append(name, status);
    progress.append(item);
  }
}

function renderChat(messages) {
  chat.replaceChildren();
  if (!messages || !messages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty muted";
    empty.textContent = "还没有对话。从首页「开始制作」后，采访会从这里开始。";
    chat.append(empty);
    return;
  }
  for (const message of messages) {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${message.role === "user" ? "user" : "assistant"}`;
    bubble.textContent = message.content;
    chat.append(bubble);
  }
  chat.scrollTop = chat.scrollHeight;
}

function renderProfile(profile) {
  profileCards.replaceChildren();
  if (!profile) {
    const empty = document.createElement("p");
    empty.className = "muted profile-empty";
    empty.textContent = "生成之后，这里会按栏目显示档案。";
    profileCards.append(empty);
    return;
  }
  const services = (profile.services || []).map((item) => `${item.name} ${item.price || ""}`.trim()).join("；");
  const seeking = (profile.seeking || []).map((item) => item.who).join("；");
  const themeLabel = profile.theme === "simple" ? "简约" : profile.theme === "ink" ? "墨色" : "温暖";
  profileCards.append(
    field("称呼 / 身份", [profile.name, profile.title, profile.city].filter(Boolean).join(" · ")),
    field("一句话", profile.tagline),
    field("关于我", profile.about),
    field("我能提供", services),
    field("我在寻找", seeking),
    field("故事", profile.story),
    field("主题", `${themeLabel} ${profile.accent || ""}`.trim()),
  );
}

function renderThemes(profile) {
  themePicks.replaceChildren();
  const current = profile && profile.theme;
  for (const [id, label, instruction] of THEME_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `theme-thumb theme-thumb-${id}`;
    button.dataset.theme = id;
    button.dataset.instruction = instruction;
    button.setAttribute("aria-pressed", current === id ? "true" : "false");
    button.disabled = !profile || busy;
    const previewBox = document.createElement("span");
    previewBox.className = "theme-thumb-preview";
    const name = document.createElement("span");
    name.className = "label";
    name.textContent = label;
    button.append(previewBox, name);
    button.addEventListener("click", () => applyInstruction(instruction, button));
    themePicks.append(button);
  }
}

function renderChips(profile) {
  editChips.replaceChildren();
  for (const text of EDIT_CHIPS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = text;
    chip.disabled = !profile || busy;
    chip.addEventListener("click", () => {
      document.querySelector("#instruction").value = text;
      applyInstruction(text, chip);
    });
    editChips.append(chip);
  }
}

function renderSession(next) {
  session = next;
  renderProgress(next.coverage || {});
  renderChat(next.messages || []);
  renderProfile(next.profile);
  renderThemes(next.profile);
  renderChips(next.profile);
  if (next.demo) showBanner("示例 / 演示：这是预置的双月湾民宿主理人阿岚，不是已核验的真实用户。", "warn");
  else if (next.fallback) showBanner("已切换离线模式。这次没有连上大模型，已改用规则继续，流程不会中断。", "");
  if (next.profile) {
    if (!preview.hidden) preview.classList.add("is-swapping");
    preview.hidden = false;
    if (previewEmpty) previewEmpty.classList.add("hidden");
    const changed = (next.lastChanged || next.changed || []).join(",");
    preview.src = `/preview/${encodeURIComponent(sid)}?key=${encodeURIComponent(key)}&t=${Date.now()}&hl=${encodeURIComponent(changed)}`;
    const slugInput = document.querySelector("#slug");
    if (slugInput && !slugInput.value && next.profile.name) slugInput.placeholder = next.profile.name;
  }
  if (next.published && next.url) renderPublish(next);
  const link = document.querySelector("#edit-link");
  link.textContent = "编辑链接就是编辑密钥，已经在浏览器地址栏里。请只自己保存，不要发到公开场合。";
}

function renderPublish(data, fresh) {
  publishResult.classList.remove("hidden");
  publishResult.classList.toggle("is-new", !!fresh);
  publishResult.replaceChildren();
  const flag = document.createElement("div");
  flag.className = "publish-head";
  flag.innerHTML = '<span class="success-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7.5"/></svg></span>';
  const flagText = document.createElement("div");
  const flagTitle = document.createElement("strong");
  flagTitle.textContent = "已发布";
  const flagNote = document.createElement("span");
  flagNote.className = "caption";
  flagNote.textContent = "之后的修改会自动同步到这个网址。";
  flagText.append(flagTitle, flagNote);
  flag.append(flagText);
  const link = document.createElement("a");
  link.className = "publish-link";
  link.id = "public-link";
  link.href = data.url;
  link.textContent = decodeURIComponent(data.url);
  const copy = document.createElement("button");
  copy.className = "secondary";
  copy.id = "copy-link";
  copy.type = "button";
  copy.innerHTML = `${icon("copy")}复制链接`;
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
    download.innerHTML = `${icon("download")}下载二维码`;
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

function withBusy(button, pendingLabel, fn) {
  return async (event) => {
    if (event) event.preventDefault();
    if (busy) return;
    if (!sid || !key) {
      showBanner("还没有创作会话。请从首页「开始制作」。", "warn");
      return;
    }
    busy = true;
    const original = button ? button.innerHTML : "";
    if (button) {
      button.disabled = true;
      if (pendingLabel) button.textContent = pendingLabel;
    }
    renderThemes(session && session.profile);
    renderChips(session && session.profile);
    try {
      await fn();
    } catch (error) {
      showBanner(error.message, "warn");
    } finally {
      busy = false;
      if (button) {
        button.disabled = false;
        if (pendingLabel) button.innerHTML = original;
      }
      renderThemes(session && session.profile);
      renderChips(session && session.profile);
    }
  };
}

async function applyInstruction(instruction, button) {
  const text = String(instruction || "").trim();
  if (!text) return;
  const runner = withBusy(button, "修改中", async () => {
    const data = await api(`/api/sessions/${encodeURIComponent(sid)}/edits`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ instruction: text }),
    });
    renderSession(data);
  });
  await runner();
}

async function boot() {
  const config = await fetch("/api/config").then((response) => response.json());
  document.querySelector("#model-notice").textContent = config.modelNotice || "";
  const prompt = await api("/api/import/prompt");
  document.querySelector("#import-prompt").value = prompt.prompt;
  renderThemes(null);
  renderChips(null);
  if (!sid || !key) {
    showBanner("还没有创作会话。请从首页「开始制作」。", "warn");
    return;
  }
  const current = await api(`/api/sessions/${encodeURIComponent(sid)}`, { headers: headers() });
  renderSession(current);
  if (current.imports && current.imports[0]) document.querySelector("#import-text").value = current.imports[0].text;
}

document.querySelector("#answer-form").addEventListener("submit", withBusy(document.querySelector("#send"), "发送中", async () => {
  const input = document.querySelector("#answer");
  const data = await api(`/api/sessions/${encodeURIComponent(sid)}/messages`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ text: input.value }),
  });
  input.value = "";
  renderSession(data);
}));

document.querySelector("#copy-prompt").addEventListener("click", async () => {
  const text = document.querySelector("#import-prompt").value;
  const state = document.querySelector("#copy-state");
  try {
    await navigator.clipboard.writeText(text);
    state.textContent = "已复制";
  } catch {
    state.textContent = "请手动选择提问词复制";
  }
  fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "import_prompt_copy" }) });
});

document.querySelector("#import-submit").addEventListener("click", withBusy(document.querySelector("#import-submit"), "导入中", async () => {
  const data = await api(`/api/sessions/${encodeURIComponent(sid)}/imports`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ text: document.querySelector("#import-text").value, kind: "ai" }),
  });
  renderSession(data);
}));

document.querySelector("#generate").addEventListener("click", withBusy(document.querySelector("#generate"), "生成中", async () => {
  previewFrame.classList.add("is-loading");
  if (previewEmpty) previewEmpty.classList.add("hidden");
  if (window.innerWidth < 960) previewFrame.scrollIntoView({ block: "nearest" });
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(sid)}/profile`, { method: "POST", headers: headers() });
    renderSession(data);
  } finally {
    previewFrame.classList.remove("is-loading");
    if (preview.hidden && previewEmpty) previewEmpty.classList.remove("hidden");
  }
}));

document.querySelector("#edit-form").addEventListener("submit", (event) => {
  event.preventDefault();
  applyInstruction(document.querySelector("#instruction").value, document.querySelector("#edit"));
});

document.querySelector("#publish-form").addEventListener("submit", withBusy(document.querySelector("#publish"), "发布中", async () => {
  const data = await api(`/api/sessions/${encodeURIComponent(sid)}/publish`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ slug: document.querySelector("#slug").value }),
  });
  renderSession(data);
  renderPublish(data, true);
  document.querySelector("#publish-result").scrollIntoView({ block: "center" });
}));

boot().catch((error) => showBanner(error.message, "warn"));
