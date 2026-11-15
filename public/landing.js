"use strict";

/*
 * 首页：开始制作 / 一键体验示例、滚入显现、手绘线书写、首屏「正在聊」小场景、
 * 机器可读文件演示（读取示例网站真实的 profile.json / llms.txt）、语音球五状态预览。
 * 所有动效在「减少动态效果」下关闭；脚本失败时页面内容照常可读。
 */

const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

async function readConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();
  const notice = document.querySelector("#model-notice");
  if (notice) notice.textContent = config.modelNotice || "";
  return config;
}

async function start(mode, button) {
  const params = new URLSearchParams(location.search);
  const source = params.get("from") === "footer" ? "footer" : "direct";
  if (source === "footer") {
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "footer_cta_click", slug: params.get("ref") || "" }),
    }).catch(() => {});
  }
  const all = Array.from(document.querySelectorAll("[data-start]"));
  all.forEach((node) => { node.disabled = true; });
  const original = button.innerHTML;
  button.textContent = "正在创建…";
  const restore = (message) => {
    button.innerHTML = original;
    all.forEach((node) => { node.disabled = false; });
    showError(button, message);
  };
  try {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, source, ref: params.get("ref") || "" }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return restore(data.error || "没有创建成功，请再试一次。");
    location.href = data.workbenchUrl;
  } catch {
    restore("网络中断了，请检查网络后再试一次。");
  }
  return undefined;
}

// 出错时在按钮旁边显示原因（不用弹窗打断）。
function showError(button, message) {
  const group = button.closest(".hero-cta, .final-cta, .nav") || button.parentElement;
  let note = group.querySelector(".start-error");
  if (!note) {
    note = document.createElement("p");
    note.className = "start-error";
    note.setAttribute("role", "alert");
    group.append(note);
  }
  note.textContent = message;
}

document.querySelectorAll("[data-start]").forEach((node) => {
  node.addEventListener("click", (event) => start(node.dataset.start === "demo" ? "demo" : "interview", event.currentTarget));
});
if (new URLSearchParams(location.search).get("from") === "footer") {
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "landing_view", source: "footer", slug: new URLSearchParams(location.search).get("ref") || "" }),
  }).catch(() => {});
}
readConfig().catch(() => {});

/* ---------------------------------------------------------------- 手绘线：进入视口时写出来 */
(function brushes() {
  const nodes = Array.from(document.querySelectorAll(".brush.draw"));
  if (reduceMotion || !("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("is-drawn"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      window.setTimeout(() => entry.target.classList.add("is-drawn"), 250);
      io.unobserve(entry.target);
    });
  }, { threshold: 0.4 });
  nodes.forEach((node) => io.observe(node));
})();

/* ---------------------------------------------------------------- 首屏「正在聊」 */
function whenIdle(fn) {
  const run = () => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 1500 }) : window.setTimeout(fn, 200));
  if (document.readyState === "complete") run(); else window.addEventListener("load", run, { once: true });
}

whenIdle(function miniChat() {
  const canvas = document.querySelector("#mini-orb");
  if (!canvas || !window.QMOrb) return;
  const orb = new window.QMOrb(canvas, { size: 46 });
  const stateEl = document.querySelector("#say-state");
  const textEl = document.querySelector("#say-text");
  const script = [
    ["listening", "正在听…", "我在惠州双月湾开了一家民宿……"],
    ["thinking", "在想…", "我在惠州双月湾开了一家民宿……"],
    ["speaking", "采访官", "记下了。民宿离海多远？"],
    ["listening", "正在听…", "走路五分钟就到沙滩。"],
  ];
  let step = 0;
  let typing = 0;
  function type(text) {
    window.clearInterval(typing);
    if (reduceMotion) { textEl.textContent = text; return; }
    let i = 0;
    const chars = Array.from(text);
    typing = window.setInterval(() => {
      i += 1;
      textEl.textContent = chars.slice(0, i).join("");
      if (i >= chars.length) window.clearInterval(typing);
    }, 70);
  }
  function next() {
    const [state, label, text] = script[step % script.length];
    orb.setState(state);
    stateEl.textContent = label;
    if (step === 0 || textEl.textContent !== text) type(text);
    step += 1;
  }
  next();
  if (!reduceMotion) {
    window.setInterval(next, 2800);
    (function level() {
      const now = Date.now();
      orb.setLevel(0.3 + 0.4 * Math.abs(Math.sin(now / 240) * Math.sin(now / 900)));
      window.requestAnimationFrame(level);
    })();
  }
});

/* ---------------------------------------------------------------- 机器可读文件：读真实输出 */
(function machineFiles() {
  const out = document.querySelector("#term-out");
  const tabs = Array.from(document.querySelectorAll(".term-tabs [role=tab]"));
  if (!out || !tabs.length) return;
  const cache = {};
  let timer = 0;

  function render(text) {
    window.clearInterval(timer);
    if (reduceMotion) { out.textContent = text; return; }
    let shown = 0;
    timer = window.setInterval(() => {
      shown = Math.min(text.length, shown + 8);
      out.textContent = text.slice(0, shown);
      if (shown >= text.length) window.clearInterval(timer);
    }, 16);
  }

  async function load(tab) {
    const file = tab.dataset.file;
    if (!cache[file]) {
      try {
        const response = await fetch(file);
        if (!response.ok) throw new Error(String(response.status));
        const raw = await response.text();
        cache[file] = /\.json$/.test(file) ? JSON.stringify(JSON.parse(raw), null, 2) : raw;
      } catch {
        cache[file] = "示例网站暂时打不开，稍后再试。";
      }
    }
    // 只展示开头一段，避免太长。
    const lines = cache[file].split("\n");
    render(lines.slice(0, 18).join("\n") + (lines.length > 18 ? "\n…" : ""));
  }

  function select(tab, focus) {
    tabs.forEach((item) => {
      const on = item === tab;
      item.setAttribute("aria-selected", on ? "true" : "false");
      item.tabIndex = on ? 0 : -1;
    });
    out.setAttribute("aria-labelledby", tab.id);
    if (focus) tab.focus();
    load(tab);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      select(tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length], true);
    });
  });

  // 进入视口再加载，不抢首屏带宽。
  const section = document.querySelector("#find");
  if ("IntersectionObserver" in window && section) {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      io.disconnect();
      select(tabs[0]);
    }, { rootMargin: "200px" });
    io.observe(section);
  } else {
    select(tabs[0]);
  }
})();

/* ---------------------------------------------------------------- 语音球五状态预览 */
whenIdle(function voiceDemo() {
  const canvas = document.querySelector("#demo-orb");
  if (!canvas || !window.QMOrb) return;
  const orb = new window.QMOrb(canvas, { size: Math.min(240, canvas.parentElement.clientWidth - 40) });
  const stateEl = document.querySelector("#demo-state");
  const qEl = document.querySelector("#demo-q");
  const pills = Array.from(document.querySelectorAll(".state-pills [data-state]"));
  const LINES = {
    idle: ["待命", "你好，我是采访官。先说说，你是谁？"],
    listening: ["在听", "「我在惠州开一家民宿……」"],
    thinking: ["思考中", "嗯，让我想想怎么问你……"],
    speaking: ["在说", "记下了。那民宿离海有多远？"],
    error: ["出错了", "刚才没听清，可以再说一遍，或者改用打字。"],
  };
  const order = Object.keys(LINES);
  let index = 0;
  let manual = false;
  function set(state) {
    orb.setState(state);
    stateEl.textContent = LINES[state][0];
    qEl.textContent = LINES[state][1];
    pills.forEach((pill) => pill.setAttribute("aria-pressed", pill.dataset.state === state ? "true" : "false"));
  }
  pills.forEach((pill) => pill.addEventListener("click", () => { manual = true; set(pill.dataset.state); }));
  set("idle");
  if (reduceMotion) return;
  window.setInterval(() => { if (!manual) set(order[(index += 1) % order.length]); }, 3000);
  (function level() {
    const now = Date.now();
    const s = orb.state;
    orb.setLevel(s === "listening" || s === "speaking" ? 0.3 + 0.5 * Math.abs(Math.sin(now / 210) * Math.sin(now / 730)) : 0);
    window.requestAnimationFrame(level);
  })();
  window.addEventListener("resize", () => orb.resize(Math.min(240, canvas.parentElement.clientWidth - 40)));
});
