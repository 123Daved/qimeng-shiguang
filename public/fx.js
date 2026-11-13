"use strict";

/*
 * 憩梦时光 · 个人网站特效（fx.js）
 * 光标光晕、磁吸按钮、3D 倾斜卡片 + 跟随光斑、姓名字形解码、逐字随滚动点亮、
 * 滚动联动时间线、视差层、导航吸顶与滚动高亮。
 * 规则（参考 personal-homepage-skill 的 Motion Patterns 原则，独立实现）：
 * 只动 transform / opacity；倾斜 ≤ 5°，磁吸 ≤ 6px；尊重 prefers-reduced-motion；
 * 没有 JS 时所有内容照常可见。
 */
(function () {
  const root = document.documentElement;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const boot = window.__QD_SITE__ || {};
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function spotlight(scope) {
    (scope || document).querySelectorAll("[data-tilt], [data-spot]").forEach((node) => {
      if (node.__qdSpot) return;
      node.__qdSpot = true;
      node.addEventListener("pointermove", (event) => {
        const rect = node.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        node.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
        node.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
        if (!reduce && finePointer && node.hasAttribute("data-tilt")) {
          node.style.transform = `perspective(900px) rotateX(${((0.5 - y) * 8).toFixed(2)}deg) rotateY(${((x - 0.5) * 10).toFixed(2)}deg) translateZ(0)`;
        }
      });
      node.addEventListener("pointerleave", () => { node.style.transform = ""; });
    });
  }

  function magnetic(scope) {
    if (reduce || !finePointer) return;
    (scope || document).querySelectorAll("[data-magnetic]").forEach((node) => {
      if (node.__qdMag) return;
      node.__qdMag = true;
      node.addEventListener("pointermove", (event) => {
        const rect = node.getBoundingClientRect();
        const dx = clamp((event.clientX - (rect.left + rect.width / 2)) * 0.25, -6, 6);
        const dy = clamp((event.clientY - (rect.top + rect.height / 2)) * 0.35, -6, 6);
        node.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
      });
      node.addEventListener("pointerleave", () => { node.style.transform = ""; });
    });
  }

  function cursorGlow() {
    const glow = document.querySelector(".cursor-glow");
    if (!glow || reduce || !finePointer) return;
    let tx = -999; let ty = -999; let x = tx; let y = ty; let running = false;
    function frame() {
      x += (tx - x) * 0.14;
      y += (ty - y) * 0.14;
      glow.style.setProperty("--gx", `${x.toFixed(1)}px`);
      glow.style.setProperty("--gy", `${y.toFixed(1)}px`);
      if (Math.abs(tx - x) > 0.5 || Math.abs(ty - y) > 0.5) requestAnimationFrame(frame);
      else running = false;
    }
    window.addEventListener("pointermove", (event) => {
      if (x < -900) { x = event.clientX; y = event.clientY; }
      tx = event.clientX; ty = event.clientY;
      document.body.classList.add("fx-pointer");
      if (!running) { running = true; requestAnimationFrame(frame); }
    }, { passive: true });
    document.addEventListener("pointerleave", () => document.body.classList.remove("fx-pointer"));
  }

  const GLYPHS = "憩梦时光山海风月云星光影墨书茶灯岚潮汐ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
  function scramble() {
    if (reduce) return;
    document.querySelectorAll("[data-scramble]").forEach((node) => {
      const text = node.textContent || "";
      const chars = Array.from(text);
      if (!chars.length || chars.length > 24) return;
      node.setAttribute("aria-label", text);
      const start = performance.now();
      const per = 90;
      const total = 380 + chars.length * per;
      function frame(now) {
        const t = now - start;
        const out = chars.map((ch, i) => {
          if (ch === " " || t > 380 + i * per) return ch;
          return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }).join("");
        node.textContent = out;
        if (t < total) requestAnimationFrame(frame);
        else node.textContent = text;
      }
      requestAnimationFrame(frame);
    });
  }

  const wordNodes = [];
  function splitWords() {
    if (reduce) return;
    document.querySelectorAll("[data-words]").forEach((node) => {
      const text = node.textContent || "";
      if (text.length > 1200) return;
      node.setAttribute("aria-label", text);
      const frag = document.createDocumentFragment();
      const units = text.match(/[A-Za-z0-9'’\-]+|\s+|./gu) || [];
      const spans = [];
      units.forEach((unit) => {
        if (/^\s+$/.test(unit)) { frag.append(unit); return; }
        const span = document.createElement("span");
        span.className = "w";
        span.setAttribute("aria-hidden", "true");
        span.textContent = unit;
        frag.append(span);
        spans.push(span);
      });
      node.textContent = "";
      node.append(frag);
      wordNodes.push({ node, spans, lit: -1 });
    });
  }

  function updateWords(vh) {
    const dim = document.body.classList.contains("theme-cinema") ? 0.16 : 0.28;
    wordNodes.forEach((item) => {
      const rect = item.node.getBoundingClientRect();
      const progress = clamp((vh * 0.88 - rect.top) / (rect.height + vh * 0.38), 0, 1);
      const lit = rect.bottom < 0 ? item.spans.length : Math.round(progress * item.spans.length);
      if (lit === item.lit) return;
      item.lit = lit;
      item.spans.forEach((span, index) => { span.style.opacity = index < lit ? "1" : String(dim); });
    });
  }

  function updateTimelines(vh) {
    document.querySelectorAll("[data-timeline]").forEach((node) => {
      const rect = node.getBoundingClientRect();
      const progress = clamp((vh * 0.62 - rect.top) / Math.max(rect.height, 1), 0, 1);
      node.style.setProperty("--progress", progress.toFixed(3));
      node.querySelectorAll(".tl-item").forEach((item) => {
        item.classList.toggle("is-lit", item.getBoundingClientRect().top < vh * 0.62);
      });
    });
  }

  const parallax = Array.from(document.querySelectorAll("[data-parallax]"));
  function updateParallax() {
    if (reduce || window.innerWidth < 720) return;
    const y = window.scrollY;
    parallax.forEach((node) => {
      const factor = Number(node.dataset.parallax) || 0;
      const rect = node.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > window.innerHeight + 200) return;
      const base = node.closest(".hero") ? y : (rect.top - window.innerHeight / 2);
      node.style.transform = `translate3d(0, ${(base * factor).toFixed(1)}px, 0)`;
    });
  }

  const nav = document.querySelector(".site-nav");
  const links = Array.from(document.querySelectorAll(".site-links a"));
  function updateNav(vh) {
    if (nav) nav.classList.toggle("is-stuck", window.scrollY > 8);
    let active = "";
    links.forEach((link) => {
      const target = document.querySelector(link.getAttribute("href"));
      if (target && target.getBoundingClientRect().top < vh * 0.4) active = link.getAttribute("href");
    });
    links.forEach((link) => link.classList.toggle("is-active", link.getAttribute("href") === active));
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const vh = window.innerHeight;
      updateWords(vh);
      updateTimelines(vh);
      updateParallax();
      updateNav(vh);
      ticking = false;
    });
  }

  function focusBuilt() {
    if (!boot.preview) return;
    const target = document.querySelector("main .is-built");
    if (!target) return;
    // 只滚动预览自己的窗口，不要带动外层工作台页面
    window.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const top = window.scrollY + rect.top - Math.max(64, (window.innerHeight - rect.height) / 2);
      window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
    }, 250);
  }

  function init() {
    if (!reduce) root.classList.add("fx-on");
    spotlight();
    magnetic();
    cursorGlow();
    scramble();
    splitWords();
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    focusBuilt();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  window.QDFx = { reduce, bind(scope) { spotlight(scope); magnetic(scope); } };
})();
