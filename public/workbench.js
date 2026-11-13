"use strict";

/*
 * 憩梦时光 · 语音工作室
 * 语音采访（识别 + 朗读 + 声纹球）→ 实时草稿预览逐段搭建 → AI 正式生成 → 换风格 / 一句话修改 → 发布。
 */

const TOPICS = [
  ["who", "你是谁", "user"],
  ["offer", "能提供什么", "offer"],
  ["work", "经历与作品", "work"],
  ["story", "你的故事", "story"],
  ["seek", "联系与寻找", "seek"],
  ["style", "网站风格", "style"],
];

const THEME_OPTIONS = [
  ["warm", "温暖", "风格换成温暖"],
  ["simple", "简约", "风格换成简约"],
  ["ink", "墨色", "风格换成墨色"],
  ["cinema", "光影", "风格换成光影"],
  ["editorial", "杂志", "风格换成杂志"],
];
const THEME_LABEL = Object.fromEntries(THEME_OPTIONS.map(([id, label]) => [id, label]));

const EDIT_CHIPS = ["换成光影风格", "换成杂志风格", "把价格写清楚", "简介写得更短一些"];

const SECTION_LABEL = {
  hero: "名字与身份",
  about: "关于我",
  services: "我能提供",
  highlights: "经历与作品",
  story: "我的故事",
  seeking: "我在寻找",
  contacts: "联系方式",
  theme: "网站风格",
};

const params = new URLSearchParams(location.search);
const sid = params.get("sid") || "";
const key = params.get("key") || "";
const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const Voice = window.QDVoice || { supported: false, canSpeak: false, speak: () => false, cancelSpeak() {}, createMeter: () => ({ open: async () => false, read: () => ({ level: 0 }), active: false }) };

const $ = (selector) => document.querySelector(selector);
const studio = $("#studio");
const stage = $(".stage");
const banner = $("#banner");
const voiceNotice = $("#voice-notice");
const progress = $("#progress");
const chat = $("#chat");
const questionEl = $("#question");
const tFinal = $("#t-final");
const tInterim = $("#t-interim");
const transcriptBox = $("#transcript");
const micButton = $("#mic");
const micLabel = $("#mic-label");
const statusText = $("#voice-status-text");
const ttsToggle = $("#tts-toggle");
const profileCards = $("#profile-cards");
const publishResult = $("#publish-result");
const themePicks = $("#theme-picks");
const editChips = $("#edit-chips");
const previewFrame = $("#preview-frame");
const previewEmpty = $("#preview-empty");
const frames = [$("#preview"), $("#preview-b")];
const buildLog = $("#build-log");
const readyCta = $("#ready-cta");

const state = {
  session: null,
  busy: false,
  input: "voice",
  talk: "tap",
  tts: localStorage.getItem("qd-tts") !== "0",
  loop: false,
  listening: false,
  speaking: false,
  filled: null,
  spoken: new Set(),
  typedId: "",
  holdStart: 0,
  wasListening: false,
  stage: "idle",
  level: 0,
};

/* ------------------------------------------------------------------ utilities */
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

function showNotice(text) {
  if (!text) { voiceNotice.classList.add("hidden"); return; }
  voiceNotice.textContent = text;
  voiceNotice.classList.remove("hidden");
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "没有完成，请再试一次。");
  return data;
}

function messageId(message, index) {
  return `${index}:${message.at || ""}`;
}

/* ------------------------------------------------------------------ stage state */
const STAGE_TEXT = {
  idle: "准备好了",
  listening: "正在听…",
  thinking: "正在想下一个问题…",
  speaking: "正在朗读问题…",
  building: "正在生成网站…",
  done: "完成",
};

function setStage(next, text) {
  state.stage = next;
  stage.dataset.state = next;
  statusText.textContent = text || STAGE_TEXT[next] || "";
  micButton.setAttribute("aria-pressed", next === "listening" || state.loop ? "true" : "false");
  if (next === "listening") micLabel.textContent = state.talk === "continuous" ? "连续对话中" : "正在听";
  else if (state.loop) micLabel.textContent = "暂停对话";
  else micLabel.textContent = Voice.supported ? (state.talk === "continuous" ? "开始对话" : "点按说话") : "仅支持打字";
  ttsToggle.classList.toggle("is-speaking", next === "speaking");
}

/* ------------------------------------------------------------------ voice orb */
const orb = (() => {
  const canvas = $("#orb");
  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let dpr = 1;
  let t = 0;
  let smooth = 0;
  let synthetic = 0;
  let last = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function bump(amount) { synthetic = Math.min(1, synthetic + amount); }

  function draw(now) {
    const dt = Math.min(64, now - (last || now));
    last = now;
    t += dt / 1000;
    if (!width) resize();
    const meterData = meter.active ? meter.read() : { level: 0, bands: null };
    let target = 0;
    if (state.stage === "listening") target = meter.active ? meterData.level : synthetic;
    else if (state.stage === "speaking") target = 0.28 + 0.22 * Math.abs(Math.sin(t * 6.3)) * Math.abs(Math.sin(t * 2.1));
    else if (state.stage === "thinking" || state.stage === "building") target = 0.12;
    synthetic *= 0.94;
    smooth += (target - smooth) * 0.18;
    state.level = smooth;

    ctx.clearRect(0, 0, width, height);
    const cx = width / 2;
    const cy = height / 2;
    const base = Math.min(width, height) * 0.2;
    const lvl = reduceMotion ? 0 : smooth;

    // 光晕
    const glowR = base * (2.1 + lvl * 0.9);
    const glow = ctx.createRadialGradient(cx, cy, base * 0.6, cx, cy, glowR);
    const listening = state.stage === "listening";
    glow.addColorStop(0, listening ? "rgba(169, 83, 47, 0.30)" : "rgba(169, 83, 47, 0.16)");
    glow.addColorStop(1, "rgba(169, 83, 47, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

    // 外圈频谱条
    const bars = 72;
    const bands = meterData.bands;
    ctx.lineCap = "round";
    for (let i = 0; i < bars; i += 1) {
      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
      let v;
      if (bands && listening) {
        const idx = 2 + Math.floor((i < bars / 2 ? i : bars - i) / (bars / 2) * 90);
        v = (bands[idx] || 0) / 255;
      } else {
        v = lvl * (0.5 + 0.5 * Math.sin(i * 0.9 + t * 4)) + (reduceMotion ? 0 : 0.04 * (1 + Math.sin(i * 0.5 + t * 1.2)));
      }
      const inner = base * 1.42;
      const len = 4 + v * base * 0.75;
      ctx.strokeStyle = `rgba(169, 83, 47, ${0.18 + v * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * (inner + len), cy + Math.sin(angle) * (inner + len));
      ctx.stroke();
    }

    // 有机形态的声纹球
    const points = 96;
    const breathe = reduceMotion ? 0 : Math.sin(t * 1.4) * 0.025;
    ctx.beginPath();
    for (let i = 0; i <= points; i += 1) {
      const a = (i / points) * Math.PI * 2;
      const wobble = Math.sin(a * 3 + t * 2.2) * 0.5 + Math.sin(a * 5 - t * 1.7) * 0.3 + Math.sin(a * 7 + t * 3.1) * 0.2;
      const r = base * (1.18 + breathe + wobble * (0.03 + lvl * 0.22));
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const fill = ctx.createRadialGradient(cx - base * 0.4, cy - base * 0.5, base * 0.2, cx, cy, base * 1.4);
    fill.addColorStop(0, "rgba(255, 236, 222, 0.95)");
    fill.addColorStop(0.55, "rgba(233, 180, 150, 0.55)");
    fill.addColorStop(1, "rgba(169, 83, 47, 0.22)");
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = `rgba(169, 83, 47, ${0.25 + lvl * 0.5})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 思考中：旋转的三个点
    if (state.stage === "thinking" || state.stage === "building") {
      for (let k = 0; k < 3; k += 1) {
        const a = t * 2.4 + (k * Math.PI * 2) / 3;
        const r = base * 1.62;
        ctx.fillStyle = "rgba(169, 83, 47, 0.75)";
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  let timer = 0;
  function loop(now) {
    if (!document.hidden) draw(now);
    if (reduceMotion) timer = window.setTimeout(() => requestAnimationFrame(loop), 400);
    else requestAnimationFrame(loop);
  }
  window.addEventListener("resize", resize);
  return { start: () => requestAnimationFrame(loop), bump, resize, stop: () => window.clearTimeout(timer) };
})();

const meter = Voice.createMeter();

/* ------------------------------------------------------------------ progress + chat */
function renderProgress(coverage) {
  const prev = state.session ? state.session.coverage || {} : {};
  const done = TOPICS.filter(([id]) => coverage[id]).length;
  $("#progress-track").setAttribute("aria-valuenow", String(done));
  $("#progress-bar").style.width = `${(done / TOPICS.length) * 100}%`;
  $("#progress-count").textContent = `${done} / ${TOPICS.length}`;
  $("#ring-fill").style.strokeDashoffset = String(590.6 * (1 - done / TOPICS.length));
  progress.replaceChildren();
  const current = TOPICS.find(([id]) => !coverage[id]);
  TOPICS.forEach(([id, label, iconName], index) => {
    const item = document.createElement("li");
    let s = "todo";
    let stateText = "未覆盖";
    if (coverage[id]) { s = "done"; stateText = "已覆盖"; }
    else if (current && current[0] === id) { s = "current"; stateText = "进行中"; }
    item.dataset.state = s;
    item.style.setProperty("--a", `${index * 60 + 30}deg`);
    if (s === "current") item.setAttribute("aria-current", "step");
    if (coverage[id] && !prev[id] && state.session) item.classList.add("just-done");
    item.innerHTML = s === "done" ? icon("check") : icon(iconName);
    const name = document.createElement("strong");
    name.textContent = label;
    const status = document.createElement("span");
    status.className = "step-status";
    status.textContent = stateText;
    item.append(name, status);
    progress.append(item);
  });
  readyCta.classList.toggle("hidden", done < TOPICS.length || !!(state.session && state.session.profile));
}

function renderChat(messages) {
  chat.replaceChildren();
  $("#history-count").textContent = String((messages || []).length);
  if (!messages || !messages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty muted";
    empty.textContent = "还没有对话。";
    chat.append(empty);
    return;
  }
  for (const message of messages) {
    const bubble = document.createElement("div");
    bubble.className = `bubble ${message.role === "user" ? "user" : "assistant"}`;
    if (message.role === "user" && message.via === "voice") {
      const via = document.createElement("span");
      via.className = "via";
      via.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/></svg>语音`;
      bubble.append(via);
    }
    bubble.append(document.createTextNode(message.content));
    chat.append(bubble);
  }
  chat.scrollTop = chat.scrollHeight;
}

function lastAssistant(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") return { message: messages[i], id: messageId(messages[i], i) };
  }
  return null;
}

let typingToken = 0;
function typeQuestion(text) {
  const token = ++typingToken;
  if (reduceMotion) {
    questionEl.textContent = text;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const chars = Array.from(text);
    let i = 0;
    const caret = document.createElement("span");
    caret.className = "caret";
    function step() {
      if (token !== typingToken) return resolve();
      i += 1;
      questionEl.textContent = chars.slice(0, i).join("");
      questionEl.append(caret);
      if (i < chars.length) window.setTimeout(step, chars[i - 1].match(/[，。？！、]/) ? 140 : 34);
      else window.setTimeout(() => { caret.remove(); resolve(); }, 400);
    }
    step();
  });
}

function speakQuestion(text, id) {
  return new Promise((resolve) => {
    if (!state.tts || !Voice.canSpeak || state.input !== "voice") return resolve(false);
    state.spoken.add(id);
    state.speaking = true;
    setStage("speaking");
    Voice.speak(text, {
      onend() {
        state.speaking = false;
        if (state.stage === "speaking") setStage("idle");
        resolve(true);
      },
    });
  });
}

/* ------------------------------------------------------------------ transcript */
function setTranscript(finalText, interim) {
  tFinal.textContent = finalText || "";
  tInterim.textContent = interim || "";
  transcriptBox.classList.toggle("has-text", !!(finalText || interim));
}

/* ------------------------------------------------------------------ preview (double buffer) */
let frontIndex = 0;
let previewToken = 0;
function loadPreview(url) {
  const token = ++previewToken;
  const front = frames[frontIndex];
  const back = frames[1 - frontIndex];
  $("#open-preview").href = url;
  if (front.hidden) {
    front.hidden = false;
    front.src = url;
    previewEmpty.classList.add("hidden");
    return;
  }
  back.hidden = false;
  back.onload = () => {
    if (token !== previewToken) return;
    back.classList.add("is-front");
    back.removeAttribute("aria-hidden");
    back.removeAttribute("tabindex");
    back.title = "网站预览";
    front.classList.remove("is-front");
    front.setAttribute("aria-hidden", "true");
    front.setAttribute("tabindex", "-1");
    front.title = "网站预览（缓冲）";
    frontIndex = 1 - frontIndex;
    back.onload = null;
  };
  back.src = url;
}

function previewUrl(session, highlight) {
  const base = `/preview/${encodeURIComponent(sid)}?key=${encodeURIComponent(key)}&t=${Date.now()}`;
  const hl = encodeURIComponent((highlight || []).join(","));
  return session.profile ? `${base}&hl=${hl}` : `${base}&draft=1&hl=${hl}`;
}

function addBuild(sections) {
  buildLog.querySelectorAll(".is-new").forEach((node) => node.classList.remove("is-new"));
  for (const name of sections) {
    if (!SECTION_LABEL[name]) continue;
    const item = document.createElement("li");
    item.className = "is-new";
    item.innerHTML = `${icon("check")}<span></span>`;
    item.querySelector("span").textContent = `搭好了「${SECTION_LABEL[name]}」`;
    buildLog.append(item);
  }
  while (buildLog.children.length > 6) buildLog.firstElementChild.remove();
}

function setBadge(text, final) {
  $("#preview-badge-text").textContent = text;
  $("#preview-badge").classList.toggle("is-final", !!final);
}

function updatePreview(next, changed) {
  const filled = (next.draft && next.draft.filled) || [];
  if (next.profile) {
    setBadge(next.published ? "已发布 · 修改会同步" : "AI 已生成", true);
    loadPreview(previewUrl(next, changed || []));
    if (next.profile.name) $("#preview-url").textContent = `qimeng-shiguang.onrender.com/u/${next.slug || next.profile.name}`;
    state.filled = new Set(filled);
    return;
  }
  setBadge("实时草稿", false);
  $("#preview-url").textContent = `qimeng-shiguang.onrender.com/u/${(next.draft && next.draft.name) || "你的名字"}`;
  const before = state.filled;
  const fresh = before ? filled.filter((name) => !before.has(name)) : [];
  state.filled = new Set(filled);
  if (before && !fresh.length && frames[frontIndex].src) return;
  if (fresh.length) addBuild(fresh);
  loadPreview(previewUrl(next, fresh));
}

/* ------------------------------------------------------------------ profile + dock */
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
  profileCards.append(
    field("称呼 / 身份", [profile.name, profile.title, profile.city].filter(Boolean).join(" · ")),
    field("一句话", profile.tagline),
    field("关于我", profile.about),
    field("我能提供", services),
    field("我在寻找", seeking),
    field("故事", profile.story),
    field("主题", `${THEME_LABEL[profile.theme] || "温暖"} ${profile.accent || ""}`.trim()),
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
    button.setAttribute("aria-pressed", current === id ? "true" : "false");
    button.disabled = !profile || state.busy;
    const box = document.createElement("span");
    box.className = "theme-thumb-preview";
    const name = document.createElement("span");
    name.className = "label";
    name.textContent = label;
    button.append(box, name);
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
    chip.disabled = !profile || state.busy;
    chip.addEventListener("click", () => {
      $("#instruction").value = text;
      applyInstruction(text, chip);
    });
    editChips.append(chip);
  }
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

/* ------------------------------------------------------------------ session rendering */
function renderSession(next, opts) {
  const options = opts || {};
  renderProgress(next.coverage || {});
  state.session = next;
  renderChat(next.messages || []);
  renderProfile(next.profile);
  renderThemes(next.profile);
  renderChips(next.profile);
  if (next.demo) showBanner("示例 / 演示：这是预置的双月湾民宿主理人阿岚，不是已核验的真实用户。六个话题已齐，可以直接生成。", "warn");
  else if (next.fallback) showBanner("已切换离线模式：这次没有连上大模型，改用规则继续，流程不会中断。", "");
  else banner.classList.add("hidden");
  updatePreview(next, options.changed || next.changed || next.lastChanged || []);
  const slugInput = $("#slug");
  if (next.profile && slugInput && !slugInput.value && next.profile.name) slugInput.placeholder = next.profile.name;
  if (next.published && next.url) renderPublish(next);
  $("#edit-link").textContent = "编辑链接就是编辑密钥，已经在浏览器地址栏里。请只自己保存，不要发到公开场合。";
  const latest = lastAssistant(next.messages);
  if (latest && latest.id !== state.typedId) {
    state.typedId = latest.id;
    return typeQuestion(latest.message.content).then(() => latest);
  }
  return Promise.resolve(null);
}

function withBusy(button, pendingLabel, fn) {
  return async (event) => {
    if (event && event.preventDefault) event.preventDefault();
    if (state.busy) return;
    if (!sid || !key) {
      showBanner("还没有创作会话。请从首页「开始制作」。", "warn");
      return;
    }
    state.busy = true;
    const original = button ? button.innerHTML : "";
    if (button) {
      button.disabled = true;
      if (pendingLabel) button.textContent = pendingLabel;
    }
    renderThemes(state.session && state.session.profile);
    renderChips(state.session && state.session.profile);
    try {
      await fn();
    } catch (error) {
      showBanner(error.message, "warn");
      setStage("idle");
    } finally {
      state.busy = false;
      if (button) {
        button.disabled = false;
        if (pendingLabel) button.innerHTML = original;
      }
      renderThemes(state.session && state.session.profile);
      renderChips(state.session && state.session.profile);
    }
  };
}

/* ------------------------------------------------------------------ actions */
async function submitAnswer(text, via) {
  const value = String(text || "").trim();
  if (!value) return;
  await withBusy($("#send"), "发送中", async () => {
    setStage("thinking");
    const data = await api(`/api/sessions/${encodeURIComponent(sid)}/messages`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ text: value, via: via === "voice" ? "voice" : "text" }),
    });
    $("#answer").value = "";
    setTranscript("", "");
    const latest = await renderSession(data);
    await afterQuestion(latest);
  })();
  if (state.stage === "thinking") setStage("idle");
}

async function afterQuestion(latest) {
  if (latest && state.input === "voice") await speakQuestion(latest.message.content, latest.id);
  if (state.stage !== "listening") setStage("idle");
  if (state.loop && state.input === "voice" && !state.busy) {
    // 话题聊完后也继续听一句，方便直接说「生成网站」
    window.setTimeout(() => startListening(), 300);
  }
}

const runGenerate = withBusy($("#generate"), "生成中", async () => {
  stopLoop();
  setStage("building");
  previewFrame.classList.add("is-loading");
  previewEmpty.classList.add("hidden");
  if (window.innerWidth < 980) previewFrame.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(sid)}/profile`, { method: "POST", headers: headers() });
    addBuild(["hero", "services", "highlights", "story", "contacts"]);
    await renderSession(data, { changed: ["hero", "services"] });
    setStage("done", "网站已生成，可以换风格、修改或发布");
    typeQuestion("网站做好了。说「换成光影风格」改风格，说一句话修改内容，或者说「发布」。");
    if (state.tts && Voice.canSpeak && state.input === "voice") {
      Voice.speak(`网站生成好了。${data.profile && data.profile.name ? `${data.profile.name}，` : ""}你可以说换成光影风格，或者说发布。`);
    }
  } finally {
    previewFrame.classList.remove("is-loading");
  }
});

async function applyInstruction(instruction, button) {
  const text = String(instruction || "").trim();
  if (!text) return;
  await withBusy(button || $("#edit"), "修改中", async () => {
    const data = await api(`/api/sessions/${encodeURIComponent(sid)}/edits`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ instruction: text }),
    });
    const changed = (data.changed || []).map((name) => (name === "theme" || name === "accent" || name === "name" ? "hero" : name));
    await renderSession(data, { changed: [...new Set(changed)] });
    addBuild(changed.filter((name) => SECTION_LABEL[name]));
    setStage("done", `已修改：${text}`);
  })();
}

const runPublish = withBusy($("#publish"), "发布中", async () => {
  const data = await api(`/api/sessions/${encodeURIComponent(sid)}/publish`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ slug: $("#slug").value }),
  });
  await renderSession(data);
  renderPublish(data, true);
  publishResult.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  setStage("done", "已发布");
  typeQuestion("发布好了！链接和二维码在下面，之后说的修改会自动同步。");
  if (state.tts && Voice.canSpeak && state.input === "voice") Voice.speak("发布好了，链接和二维码在下面。");
});

/* ------------------------------------------------------------------ voice commands */
function normalizeCommand(text) {
  return String(text || "").replace(/[\s，。！？、,.!?]/g, "");
}

function matchCommand(text) {
  const t = normalizeCommand(text);
  const profile = state.session && state.session.profile;
  if (t.length > 16) return null;
  if (/^(请|帮我)?(开始)?生成(一下)?(网站|网页|我的网站)?(吧)?$/.test(t)) return { kind: "generate" };
  if (profile && /^(请|帮我)?(发布|上线)(网站|一下)?(吧)?$/.test(t)) return { kind: "publish" };
  const theme = t.match(/(?:换成|改成|切换到|切到|用)(温暖|简约|墨色|光影|杂志)/) || (profile ? t.match(/^(温暖|简约|墨色|光影|杂志)(风格|主题|风)?$/) : null);
  if (profile && theme) return { kind: "edit", instruction: `风格换成${theme[1]}` };
  return null;
}

async function handleUtterance(text, via) {
  const value = String(text || "").trim();
  if (!value) return;
  setTranscript(value, "");
  const command = matchCommand(value);
  const profile = state.session && state.session.profile;
  if (command && command.kind === "generate") return runGenerate();
  if (command && command.kind === "publish") return runPublish();
  if (command && command.kind === "edit") return applyInstruction(command.instruction);
  const coverage = (state.session && state.session.coverage) || {};
  if (profile && TOPICS.every(([id]) => coverage[id])) {
    // 已生成网站：自由说的话按「一句话修改」处理
    $("#instruction").value = value;
    return applyInstruction(value);
  }
  return submitAnswer(value, via);
}

/* ------------------------------------------------------------------ recognition */
let recognizer = null;
function fatal(code) {
  return ["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported", "start"].includes(code);
}

if (Voice.supported) {
  recognizer = Voice.createRecognizer({
    autoCommit: true,
    silenceMs: 1500,
    onInterim(finalText, interim) {
      setTranscript(finalText, interim);
      orb.bump(0.5);
    },
    onFinal(text) {
      state.listening = false;
      handleUtterance(text, "voice");
    },
    onEmpty() {
      state.listening = false;
    },
    onState(s) {
      if (s === "listening") {
        state.listening = true;
        setStage("listening");
      } else {
        state.listening = false;
        if (state.stage === "listening") setStage("idle");
        // 连续模式下没听到声音，安静地重新开始听
        window.setTimeout(() => {
          if (state.loop && !state.busy && !state.speaking && !state.listening && state.stage === "idle") startListening();
        }, 600);
      }
    },
    onError(code, message) {
      if (fatal(code)) {
        stopLoop();
        showNotice(message);
      } else if (message && code !== "no-speech") {
        showNotice(message);
      }
    },
  });
}

async function startListening() {
  if (!recognizer || state.busy || state.listening) return;
  Voice.cancelSpeak();
  state.speaking = false;
  showNotice("");
  setTranscript("", "");
  meter.open().then((ok) => { if (ok) orb.resize(); });
  recognizer.start();
}

function stopListening(submit) {
  if (recognizer && state.listening) recognizer.stop(submit);
}

function stopLoop() {
  state.loop = false;
  if (recognizer && state.listening) recognizer.abort();
  state.listening = false;
  if (state.stage === "listening") setStage("idle");
}

async function beginTurn() {
  // 第一次点麦克风：先把还没读过的问题读出来，再开始听
  const latest = state.session && lastAssistant(state.session.messages);
  if (latest && state.tts && Voice.canSpeak && !state.spoken.has(latest.id)) {
    await speakQuestion(latest.message.content, latest.id);
  }
  await startListening();
}

/* mic: 点按 = 开始 / 结束；按住 = 按住说话；连续模式 = 开关对话循环 */
micButton.addEventListener("pointerdown", (event) => {
  if (!Voice.supported || event.button > 0) return;
  state.holdStart = performance.now();
  state.wasListening = state.listening;
  micButton.classList.add("is-holding");
  if (state.talk === "tap" && !state.listening) beginTurn();
});
function endPress() {
  if (!state.holdStart) return;
  const held = performance.now() - state.holdStart;
  state.holdStart = 0;
  micButton.classList.remove("is-holding");
  if (state.talk !== "tap") return;
  if (held > 450 && state.listening) stopListening(true);
  else if (state.wasListening) stopListening(true);
}
micButton.addEventListener("pointerup", endPress);
micButton.addEventListener("pointercancel", endPress);
micButton.addEventListener("pointerleave", () => { if (state.holdStart && performance.now() - state.holdStart > 450) endPress(); });
micButton.addEventListener("click", (event) => {
  if (!Voice.supported) {
    showNotice(unsupportedText());
    $("#answer").focus();
    return;
  }
  if (state.talk === "continuous") {
    if (state.loop) {
      stopLoop();
      Voice.cancelSpeak();
      setStage("idle", "对话已暂停");
    } else {
      state.loop = true;
      beginTurn();
    }
    return;
  }
  // 键盘触发（没有 pointerdown）时按点按逻辑处理
  if (event.detail === 0) {
    if (state.listening) stopListening(true);
    else beginTurn();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat || !Voice.supported || state.input !== "voice") return;
  const tag = (event.target && event.target.tagName) || "";
  if (/INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY/.test(tag)) return;
  event.preventDefault();
  if (state.talk === "tap" && !state.listening) {
    state.spaceHold = true;
    startListening();
  }
});
document.addEventListener("keyup", (event) => {
  if (event.code !== "Space" || !state.spaceHold) return;
  state.spaceHold = false;
  stopListening(true);
});

/* ------------------------------------------------------------------ toggles */
function setInput(mode) {
  state.input = mode;
  studio.dataset.input = mode;
  document.querySelectorAll("[data-input]").forEach((btn) => btn.setAttribute("aria-checked", btn.dataset.input === mode ? "true" : "false"));
  if (mode === "text") {
    stopLoop();
    Voice.cancelSpeak();
    $("#answer").focus();
  }
  localStorage.setItem("qd-input", mode);
}

function setTalk(mode) {
  state.talk = mode;
  document.querySelectorAll("[data-talk]").forEach((btn) => btn.setAttribute("aria-checked", btn.dataset.talk === mode ? "true" : "false"));
  $("#voice-hint").textContent = mode === "continuous"
    ? "点一下麦克风开始连续对话：AI 读完问题会自动开始听，你说完停顿片刻就自动发送。再点一下暂停。"
    : "点一下开始，说完停顿片刻会自动发送；也可以按住麦克风或空格键说话，松开即发送。";
  if (mode === "tap") stopLoop();
  setStage(state.stage === "listening" ? "listening" : "idle");
}

function setTts(on) {
  state.tts = !!on;
  ttsToggle.setAttribute("aria-pressed", on ? "true" : "false");
  ttsToggle.title = on ? "朗读已开启（点击关闭）" : "朗读已关闭（点击开启）";
  localStorage.setItem("qd-tts", on ? "1" : "0");
  if (!on) Voice.cancelSpeak();
}

document.querySelectorAll("[data-input]").forEach((btn) => btn.addEventListener("click", () => setInput(btn.dataset.input)));
document.querySelectorAll("[data-talk]").forEach((btn) => btn.addEventListener("click", () => setTalk(btn.dataset.talk)));
ttsToggle.addEventListener("click", () => setTts(!state.tts));
document.querySelectorAll("[data-device]").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll("[data-device]").forEach((b) => b.setAttribute("aria-checked", b === btn ? "true" : "false"));
  previewFrame.dataset.device = btn.dataset.device;
}));

function unsupportedText() {
  return "当前浏览器不支持语音识别（例如 Firefox）。请用 Chrome、Edge 或 Safari 打开，或者直接在下面打字回答——流程完全一样。";
}

/* ------------------------------------------------------------------ forms */
$("#answer-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitAnswer($("#answer").value, "text");
});
$("#answer").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submitAnswer($("#answer").value, "text");
  }
});
$("#generate").addEventListener("click", runGenerate);
$("#generate-cta").addEventListener("click", runGenerate);
$("#edit-form").addEventListener("submit", (event) => {
  event.preventDefault();
  applyInstruction($("#instruction").value, $("#edit"));
});
$("#publish-form").addEventListener("submit", runPublish);
$("#copy-prompt").addEventListener("click", async () => {
  const text = $("#import-prompt").value;
  const copyState = $("#copy-state");
  try {
    await navigator.clipboard.writeText(text);
    copyState.textContent = "已复制";
  } catch {
    copyState.textContent = "请手动选择提问词复制";
  }
  fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "import_prompt_copy" }) });
});
$("#import-submit").addEventListener("click", withBusy($("#import-submit"), "导入中", async () => {
  const data = await api(`/api/sessions/${encodeURIComponent(sid)}/imports`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ text: $("#import-text").value, kind: "ai" }),
  });
  const latest = await renderSession(data);
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  await afterQuestion(latest);
}));

/* 修改指令也能用语音说 */
(function setupInstructionMic() {
  const button = $("#instruction-mic");
  if (!Voice.supported || !button) return;
  button.hidden = false;
  const rec = Voice.createRecognizer({
    autoCommit: true,
    silenceMs: 1300,
    onInterim(finalText, interim) { $("#instruction").value = finalText + interim; },
    onFinal(text) {
      $("#instruction").value = text;
      applyInstruction(text, $("#edit"));
    },
    onState(s) {
      button.classList.toggle("is-on", s === "listening");
      button.setAttribute("aria-pressed", s === "listening" ? "true" : "false");
    },
    onError(code, message) { if (message) showBanner(message, "warn"); },
  });
  button.addEventListener("click", () => {
    if (button.classList.contains("is-on")) rec.stop(true);
    else { Voice.cancelSpeak(); rec.start(); }
  });
})();

/* ------------------------------------------------------------------ boot */
async function boot() {
  orb.start();
  setTts(state.tts && Voice.canSpeak);
  if (!Voice.canSpeak) {
    ttsToggle.disabled = true;
    ttsToggle.title = "这个浏览器不支持朗读";
  }
  if (!Voice.supported) {
    document.body.classList.add("no-voice");
    $("#mode-voice").disabled = true;
    showNotice(unsupportedText());
    setInput("text");
  } else {
    setInput(localStorage.getItem("qd-input") === "text" ? "text" : "voice");
  }
  setTalk("tap");
  setStage("idle");
  const config = await fetch("/api/config").then((response) => response.json());
  $("#model-notice").textContent = config.modelNotice || "";
  const prompt = await api("/api/import/prompt");
  $("#import-prompt").value = prompt.prompt;
  renderThemes(null);
  renderChips(null);
  if (!sid || !key) {
    showBanner("还没有创作会话。请从首页「开始制作」。", "warn");
    questionEl.textContent = "从首页点「开始制作」，就可以用说话的方式做网站。";
    return;
  }
  const current = await api(`/api/sessions/${encodeURIComponent(sid)}`, { headers: headers() });
  await renderSession(current);
  if (current.imports && current.imports[0]) $("#import-text").value = current.imports[0].text;
}

/* 自动化测试用：模拟一段语音识别结果（与真实识别走同一条路径） */
window.QDStudio = {
  simulateTranscript(text, opts) {
    const options = opts || {};
    if (options.interim) {
      setStage("listening");
      setTranscript("", text);
      orb.bump(0.8);
      return Promise.resolve();
    }
    return handleUtterance(text, "voice");
  },
  setStage,
  get state() { return { stage: state.stage, input: state.input, talk: state.talk, tts: state.tts, supported: Voice.supported, filled: state.filled ? [...state.filled] : [] }; },
};

boot().catch((error) => showBanner(error.message, "warn"));
