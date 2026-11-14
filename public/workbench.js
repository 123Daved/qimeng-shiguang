"use strict";

/*
 * 憩梦时光 · 语音工作室
 * 语音采访（识别 + 按句朗读 + 声纹球）→ 实时草稿预览逐段搭建 → AI 正式生成 → 换风格 / 一句话修改 → 发布。
 *
 * 对话五个状态：idle 待命 / listening 在听 / thinking 思考 / speaking 在说 / error 出错。
 * 一轮对话走流式接口 /turns：采访官说一句、这里显示并朗读一句；用户一开口就打断。
 * 降级顺序：浏览器识别 → 服务端识别（已配置时）→ 打字；流式失败 → 普通接口；都不丢已记录的内容。
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
const Voice = window.QDVoice || {
  supported: false,
  canSpeak: false,
  canRecord: false,
  createMeter: () => ({ open: async () => false, read: () => ({ level: 0 }), close() {}, active: false }),
  createSpeaker: () => ({ enqueue: () => false, cancel() {}, whenIdle: () => Promise.resolve(), level: () => 0, speaking: false }),
  createBargeIn: () => ({ start: () => false, stop() {}, active: false }),
};

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
  picked: null,
  pendingListen: false,
  voiceConfig: { asr: { server: false }, tts: { server: false } },
  asr: "none",
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
  thinking: "正在想…",
  speaking: "正在说…",
  error: "出了点问题",
};
// 旧的 building / done 并入五个状态：生成中属于「思考」，完成后回到「待命」，文字单独说明。
const STAGE_ALIAS = { building: ["thinking", "正在生成网站…"], done: ["idle", "完成"] };

function setStage(next, text) {
  const alias = STAGE_ALIAS[next];
  const name = alias ? alias[0] : next;
  state.stage = name;
  stage.dataset.state = name;
  statusText.textContent = text || (alias ? alias[1] : STAGE_TEXT[name]) || "";
  micButton.setAttribute("aria-pressed", name === "listening" || state.loop ? "true" : "false");
  if (name === "listening") micLabel.textContent = state.talk === "continuous" ? "连续对话中" : "正在听";
  else if (name === "speaking" && voiceReady()) micLabel.textContent = "点按打断";
  else if (state.loop) micLabel.textContent = "暂停对话";
  else if (name === "error" && voiceReady()) micLabel.textContent = "再试一次";
  else micLabel.textContent = voiceReady() ? (state.talk === "continuous" ? "开始对话" : "点按说话") : "仅支持打字";
  ttsToggle.classList.toggle("is-speaking", name === "speaking");
  if (name === "idle" || name === "error") scheduleMicRelease();
}

function voiceReady() { return !!recognizer; }

// 麦克风用完就还：待命超过 45 秒且不在连续对话中，释放麦克风（浏览器标签上的录音标记会消失）。
let releaseTimer = 0;
function scheduleMicRelease() {
  window.clearTimeout(releaseTimer);
  releaseTimer = window.setTimeout(() => {
    if (!state.listening && !state.loop && !speaker.speaking && state.stage !== "thinking") meter.close();
  }, 45000);
}

function logEvent(type) {
  fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type }) }).catch(() => {});
}

function enterError(message, kind) {
  bargeIn.stop();
  speaker.cancel();
  setStage("error", kind || STAGE_TEXT.error);
  showNotice(message);
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
    else if (state.stage === "speaking") target = speaker.speaking ? speaker.level() : 0.1;
    else if (state.stage === "thinking") target = 0.12;
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
    if (state.stage === "thinking") {
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

/* ------------------------------------------------------------------ speaker + barge-in */
function makeSpeaker(serverTts) {
  return Voice.createSpeaker({
    fetchAudio: serverTts ? async (text) => {
      const response = await fetch(`/api/tts?sid=${encodeURIComponent(sid)}`, { method: "POST", headers: headers(), body: JSON.stringify({ text }) });
      if (!response.ok) throw new Error("tts");
      return response.blob();
    } : null,
    onStart() {
      state.speaking = true;
      if (state.stage !== "listening") setStage("speaking");
      if (state.input === "voice") bargeIn.start();
    },
    onIdle() {
      state.speaking = false;
      bargeIn.stop();
      if (state.stage === "speaking" && !state.busy) setStage("idle");
    },
  });
}
let speaker = makeSpeaker(false);

// 用户一开口就打断朗读，马上开始听。
const bargeIn = Voice.createBargeIn(meter, () => {
  if (!speaker.speaking) return;
  speaker.cancel();
  logEvent("voice_barge_in");
  if (state.busy) state.pendingListen = true;
  else startListening();
});

function say(text) {
  if (!state.tts || state.input !== "voice" || !text) return false;
  return speaker.enqueue(text);
}

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
    if (message.retracted) bubble.classList.add("is-retracted");
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

async function speakQuestion(text, id) {
  if (id) state.spoken.add(id);
  if (!say(text)) return false;
  await speaker.whenIdle();
  return true;
}

// 流式回合：采访官的话一句一句地显示出来（复述用较浅的颜色，问句是主角）。
function beginLiveQuestion() {
  typingToken += 1;
  questionEl.replaceChildren();
}
function appendSentence(text, kind) {
  const span = document.createElement("span");
  span.className = `q-part q-${/^[a-z]+$/.test(kind || "") ? kind : "text"}`;
  span.textContent = text;
  questionEl.append(span);
}

function renderRecaps(session) {
  const list = $("#recaps");
  if (!list) return;
  list.replaceChildren();
  const recaps = session.recaps || {};
  const skipped = session.skipped || {};
  for (const [id, label] of TOPICS) {
    if (!session.coverage || !session.coverage[id]) continue;
    if (!recaps[id] && !skipped[id]) continue;
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = label;
    const body = document.createElement("span");
    body.textContent = skipped[id] ? "已跳过，之后可以补" : recaps[id];
    if (skipped[id]) item.dataset.state = "skipped";
    item.append(name, body);
    list.append(item);
  }
  list.classList.toggle("hidden", !list.children.length);
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
  renderRecaps(next);
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
    // quiet：这句话已经在流式过程中显示并朗读过了，不再重打一遍。
    if (options.quiet) { state.spoken.add(latest.id); return Promise.resolve(latest); }
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
// 读取 /turns 的 Server-Sent Events。鉴权或参数错误会以普通 JSON 返回，这里统一抛出。
async function streamTurn(payload, handlers) {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sid)}/turns`, { method: "POST", headers: headers(), body: JSON.stringify(payload) });
  const type = response.headers.get("content-type") || "";
  if (!/event-stream/.test(type)) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || "没有完成，请再试一次。"), { expose: true });
  }
  let done = null;
  let failure = null;
  const dispatch = (block) => {
    const event = (/^event: (.+)$/m.exec(block) || [])[1];
    const raw = (/^data: (.+)$/m.exec(block) || [])[1];
    if (!event || !raw) return;
    let data;
    try { data = JSON.parse(raw); } catch (error) { return; }
    if (event === "done") done = data;
    else if (event === "error") failure = data.error || "没有完成，请再试一次。";
    else if (handlers[event]) handlers[event](data);
  };
  if (response.body && response.body.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      pending += decoder.decode(value, { stream: true });
      let index;
      while ((index = pending.indexOf("\n\n")) >= 0) {
        dispatch(pending.slice(0, index));
        pending = pending.slice(index + 2);
      }
    }
    if (pending.trim()) dispatch(pending);
  } else {
    (await response.text()).split("\n\n").forEach(dispatch);
  }
  if (failure) throw Object.assign(new Error(failure), { expose: true });
  if (!done) throw new Error("stream-incomplete");
  return done;
}

function lockTurn(locked) {
  state.busy = locked;
  $("#send").disabled = locked;
  document.querySelectorAll(".talk-actions button").forEach((button) => { button.disabled = locked; });
  renderThemes(state.session && state.session.profile);
  renderChips(state.session && state.session.profile);
}

// 一轮对话：语音和打字都走这里。口令、修改、回答由服务端判断。
async function runTurn(text, via) {
  const value = String(text || "").trim();
  if (!value || state.busy) return;
  if (!sid || !key) {
    showBanner("还没有创作会话。请从首页「开始制作」。", "warn");
    return;
  }
  const channel = via === "voice" ? "voice" : "text";
  bargeIn.stop();
  speaker.cancel();
  showNotice("");
  setTranscript(value, "");
  lockTurn(true);
  setStage("thinking");
  let action = null;
  let started = false;
  let reached = false;
  let data = null;
  let failed = "";
  try {
    data = await streamTurn({ text: value, via: channel, section: state.picked ? state.picked.section : "" }, {
      intent() { reached = true; },
      sentence(item) {
        if (!started) { started = true; beginLiveQuestion(); setStage("speaking"); }
        appendSentence(item.text, item.kind);
        say(item.text);
      },
      action(item) { action = item; },
    });
  } catch (error) {
    if (error.expose) failed = error.message;
    else {
      // 流式通道断了。服务端如果已经收到这句话，这一轮会照常记完：只需重新读取会话，不能重发（否则会记两遍）。
      // 如果连请求都没到达，才退回普通接口再发一次。
      try {
        if (reached) {
          data = await api(`/api/sessions/${encodeURIComponent(sid)}`, { headers: headers() });
          action = null;
        } else {
          data = await api(`/api/sessions/${encodeURIComponent(sid)}/messages`, { method: "POST", headers: headers(), body: JSON.stringify({ text: value, via: channel }) });
        }
        started = false;
      } catch (second) {
        failed = second.message || "网络好像断了，请再试一次。";
      }
    }
  }
  lockTurn(false);
  if (failed) {
    // 把这句话放回输入框，重试时不用再说一遍。
    $("#answer").value = value;
    enterError(`${failed} 你刚才说的话已经放回输入框，可以直接再发一次。`);
    return;
  }
  $("#answer").value = "";
  if (action) {
    setTranscript("", "");
    return runAction(action);
  }
  const latest = await renderSession(data, { quiet: started });
  setTranscript("", "");
  if (!started && latest) await speakQuestion(latest.message.content, latest.id);
  await afterSpoken();
}

function submitAnswer(text, via) { return runTurn(text, via); }

async function runAction(action) {
  if (action.action === "generate") return runGenerate();
  if (action.action === "publish") return runPublish();
  if (action.action === "stop") {
    stopLoop();
    setStage("idle", "对话已暂停，点麦克风继续");
    return undefined;
  }
  if (action.action === "edit") {
    const spoken = action.instruction.replace(/^只修改「.+?」这一版块，其他版块保持原样：/, "");
    $("#instruction").value = spoken;
    const picked = state.picked;
    await applyInstruction(action.instruction, null, picked ? `「${picked.label}」${spoken}` : spoken);
    if (picked) { logEvent("block_pick_edit"); clearPick(); }
  }
  return undefined;
}

// 等采访官说完，再决定是否自动开始听。
async function afterSpoken() {
  await speaker.whenIdle();
  if (state.stage === "speaking" || state.stage === "thinking") setStage("idle");
  const wantListen = state.pendingListen || (state.loop && state.input === "voice");
  state.pendingListen = false;
  if (wantListen && !state.busy && voiceReady()) window.setTimeout(() => startListening(), 250);
}

async function afterQuestion(latest) {
  if (latest && state.input === "voice" && !state.spoken.has(latest.id)) await speakQuestion(latest.message.content, latest.id);
  await afterSpoken();
}

// 「跳过 / 返回 / 我说错了 / 再说一遍」按钮：和说出口令是同一套逻辑。
async function runCommand(name, button) {
  await withBusy(button, "", async () => {
    bargeIn.stop();
    speaker.cancel();
    setStage("thinking");
    const data = await api(`/api/sessions/${encodeURIComponent(sid)}/commands`, { method: "POST", headers: headers(), body: JSON.stringify({ command: name }) });
    beginLiveQuestion();
    setStage("speaking");
    (data.sentences || []).forEach((item) => { appendSentence(item.text, item.kind); say(item.text); });
    await renderSession(data, { quiet: true });
  })();
  await afterSpoken();
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
    typeQuestion("网站做好了。点预览里的任意一块，说一句话就能改；也可以说「换成光影风格」或「发布」。");
    say(`网站生成好了。${data.profile && data.profile.name ? `${data.profile.name}，` : ""}你可以点一下预览里的任意一块来修改，或者说发布。`);
  } finally {
    previewFrame.classList.remove("is-loading");
  }
});

async function applyInstruction(instruction, button, shown) {
  const text = String(instruction || "").trim();
  if (!text) return;
  const label = shown || text;
  await withBusy(button || $("#edit"), "修改中", async () => {
    const data = await api(`/api/sessions/${encodeURIComponent(sid)}/edits`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ instruction: text }),
    });
    const changed = (data.changed || []).map((name) => (name === "theme" || name === "accent" || name === "name" ? "hero" : name));
    await renderSession(data, { changed: [...new Set(changed)] });
    addBuild(changed.filter((name) => SECTION_LABEL[name]));
    setStage("done", `已修改：${label}`);
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
  say("发布好了，链接和二维码在下面。");
});

/* ------------------------------------------------------------------ utterance */
// 一句话进来（语音或打字）：交给服务端判断是口令、修改还是回答。
function handleUtterance(text, via) {
  return runTurn(text, via);
}

/* ------------------------------------------------------------------ pick a block in the preview */
const PICK_STYLE = "[data-section]{cursor:pointer}[data-section]:hover{outline:2px dashed rgba(169,83,47,.55);outline-offset:4px}[data-section].qd-picked{outline:2px solid #A9532F;outline-offset:4px}";

function hookPreview(frame) {
  let doc;
  try { doc = frame.contentDocument; } catch (error) { return; }
  if (!doc || !doc.body || doc.body.dataset.qdHooked) return;
  doc.body.dataset.qdHooked = "1";
  const style = doc.createElement("style");
  style.textContent = PICK_STYLE;
  doc.head.append(style);
  doc.addEventListener("click", (event) => {
    // 预览里的链接、按钮、输入框照常可用，只有点在版块空白处才算「选中」。
    if (event.target.closest("a,button,input,textarea,select,label,summary,[role=button]")) return;
    const section = event.target.closest("[data-section]");
    if (!section) return;
    event.preventDefault();
    pickSection(section.dataset.section);
  }, true);
  if (state.picked) markPicked();
}

function markPicked() {
  for (const frame of frames) {
    let doc;
    try { doc = frame.contentDocument; } catch (error) { continue; }
    if (!doc) continue;
    doc.querySelectorAll(".qd-picked").forEach((node) => node.classList.remove("qd-picked"));
    if (state.picked) doc.querySelectorAll(`[data-section="${state.picked.section}"]`).forEach((node) => node.classList.add("qd-picked"));
  }
}

function pickSection(name) {
  const label = SECTION_LABEL[name];
  if (!label || name === "theme") return;
  if (!state.session || !state.session.profile) {
    showNotice("生成网站之后，就可以点预览里的任意一块，用一句话修改它。");
    return;
  }
  if (state.busy) return;
  state.picked = { section: name, label };
  markPicked();
  $("#pick-text").textContent = `正在修改「${label}」：说一句话，或者在下面打字`;
  $("#pick-chip").classList.remove("hidden");
  speaker.cancel();
  beginLiveQuestion();
  appendSentence(`你选中了「${label}」。想怎么改？我只动这一块。`, "question");
  if (state.input === "voice" && voiceReady()) startListening();
  else $("#answer").focus();
}

function clearPick() {
  state.picked = null;
  markPicked();
  $("#pick-chip").classList.add("hidden");
}

/* ------------------------------------------------------------------ recognition */
let recognizer = null;
function fatal(code) {
  return ["not-allowed", "service-not-allowed", "audio-capture", "network", "language-not-supported", "start"].includes(code);
}

const recognizerHandlers = {
  onInterim(finalText, interim) {
    setTranscript(finalText, interim);
    orb.bump(0.5);
  },
  onLevel() { orb.bump(0.3); },
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
    } else if (s === "recognizing") {
      state.listening = false;
      setStage("thinking", "正在识别你说的话…");
    } else {
      state.listening = false;
      if (state.stage === "listening" || (state.stage === "thinking" && !state.busy)) setStage("idle");
      // 连续模式下没听到声音，安静地重新开始听
      window.setTimeout(() => {
        if (state.loop && !state.busy && !state.speaking && !state.listening && state.stage === "idle") startListening();
      }, 600);
    }
  },
  onError(code, message) {
    if (!fatal(code) && code !== "server") {
      if (message && code !== "no-speech") showNotice(message);
      return;
    }
    stopLoop();
    // 降级：浏览器识别不可用 → 服务端识别（已配置时）→ 打字。已记录的内容都还在。
    const serviceDown = ["network", "service-not-allowed", "language-not-supported"].includes(code);
    if (state.asr === "browser" && serviceDown && useServerAsr()) {
      setStage("idle");
      showNotice("浏览器的语音识别连不上，已经换成服务端识别。再点一下麦克风就能继续说。");
      return;
    }
    logEvent("voice_fallback_to_text");
    enterError(`${message} 已经为你切到打字，之前聊的内容都还在。`, "语音暂时用不了");
    setInput("text", true);
  },
};

function useServerAsr() {
  if (!state.voiceConfig.asr.server || !Voice.canRecord) return false;
  recognizer = Voice.createServerRecognizer(Object.assign({
    meter,
    silenceMs: 1400,
    autoCommit: true,
    async transcribe(blob) {
      const response = await fetch(`/api/asr?sid=${encodeURIComponent(sid)}`, { method: "POST", headers: { "X-Edit-Token": key, "Content-Type": blob.type || "audio/webm" }, body: blob });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "语音识别服务暂时不可用。");
      return data.text || "";
    },
  }, recognizerHandlers));
  state.asr = "server";
  return true;
}

function setupRecognizer() {
  if (Voice.supported) {
    recognizer = Voice.createRecognizer(Object.assign({ autoCommit: true, silenceMs: 1400 }, recognizerHandlers));
    state.asr = "browser";
    return true;
  }
  return useServerAsr();
}

async function startListening() {
  if (!recognizer || state.busy || state.listening) return;
  bargeIn.stop();
  speaker.cancel();
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
  if (speaker.speaking) {
    // 采访官还在说：这一下是打断。
    speaker.cancel();
  } else if (latest && state.tts && !state.spoken.has(latest.id)) {
    await speakQuestion(latest.message.content, latest.id);
  }
  await startListening();
}

/* mic: 点按 = 开始 / 结束；按住 = 按住说话；连续模式 = 开关对话循环 */
micButton.addEventListener("pointerdown", (event) => {
  if (!voiceReady() || event.button > 0) return;
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
  if (!voiceReady()) {
    showNotice(unsupportedText());
    $("#answer").focus();
    return;
  }
  if (state.talk === "continuous") {
    if (state.loop) {
      stopLoop();
      speaker.cancel();
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
  if (event.code !== "Space" || event.repeat || !voiceReady() || state.input !== "voice") return;
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
function setInput(mode, keepFocus) {
  state.input = mode;
  studio.dataset.input = mode;
  document.querySelectorAll("[data-input]").forEach((btn) => btn.setAttribute("aria-checked", btn.dataset.input === mode ? "true" : "false"));
  if (mode === "text") {
    stopLoop();
    bargeIn.stop();
    speaker.cancel();
    meter.close();
    if (!keepFocus) $("#answer").focus();
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
  if (!on) speaker.cancel();
}

document.querySelectorAll("[data-input]").forEach((btn) => btn.addEventListener("click", () => setInput(btn.dataset.input)));
document.querySelectorAll("[data-talk]").forEach((btn) => btn.addEventListener("click", () => setTalk(btn.dataset.talk)));
ttsToggle.addEventListener("click", () => setTts(!state.tts));
document.querySelectorAll("[data-device]").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll("[data-device]").forEach((b) => b.setAttribute("aria-checked", b === btn ? "true" : "false"));
  previewFrame.dataset.device = btn.dataset.device;
}));

function unsupportedText() {
  return "当前浏览器不支持语音识别（例如 Firefox）。请用 Chrome、Edge 或 Safari 打开，或者直接在下面打字回答——流程完全一样，「跳过」「返回」「我说错了」这些口令打字也有效。";
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
    else { speaker.cancel(); rec.start(); }
  });
})();

/* ------------------------------------------------------------------ boot */
async function boot() {
  orb.start();
  try {
    const voiceConfig = await fetch("/api/voice/config").then((response) => response.json());
    if (voiceConfig && voiceConfig.asr && voiceConfig.tts) state.voiceConfig = voiceConfig;
  } catch (error) { /* 读不到就按「只有浏览器能力」处理 */ }
  const canSpeak = Voice.canSpeak || state.voiceConfig.tts.server;
  if (state.voiceConfig.tts.server) speaker = makeSpeaker(true);
  setTts(state.tts && canSpeak);
  if (!canSpeak) {
    ttsToggle.disabled = true;
    ttsToggle.title = "这个浏览器不支持朗读";
  }
  if (!setupRecognizer()) {
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

frames.forEach((frame) => frame.addEventListener("load", () => hookPreview(frame)));
$("#pick-clear").addEventListener("click", () => { clearPick(); setStage("idle"); });
document.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => runCommand(button.dataset.command, button)));
window.addEventListener("pagehide", () => { bargeIn.stop(); speaker.cancel(); meter.close(); });
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (speaker.speaking) speaker.cancel();
  else if (state.picked) clearPick();
});

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
  pickSection,
  clearPick,
  runCommand,
  simulateRecognitionError(code) { recognizerHandlers.onError(code, (Voice.errorText && Voice.errorText(code)) || "语音识别出了点问题。"); },
  get state() {
    return {
      stage: state.stage, input: state.input, talk: state.talk, tts: state.tts, busy: state.busy,
      supported: Voice.supported, asr: state.asr, speaking: speaker.speaking,
      picked: state.picked ? state.picked.section : "", micOpen: meter.active,
      recaps: (state.session && state.session.recaps) || {},
      filled: state.filled ? [...state.filled] : [],
    };
  },
};

boot().catch((error) => showBanner(error.message, "warn"));
