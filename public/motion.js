"use strict";

(function () {
  const root = document.documentElement;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canObserve = "IntersectionObserver" in window;
  let observer = null;

  function reveal(node) {
    node.classList.add("is-in");
    const delay = Number(node.style.getPropertyValue("--i") || 0) * 80;
    window.setTimeout(() => { node.removeAttribute("data-reveal"); node.classList.remove("is-in"); }, 700 + delay);
  }

  function observe(scope) {
    const nodes = (scope || document).querySelectorAll("[data-reveal]:not(.is-in)");
    nodes.forEach((node, index) => {
      if (!node.style.getPropertyValue("--i") && node.parentElement && node.parentElement.hasAttribute("data-stagger")) {
        node.style.setProperty("--i", String(Array.prototype.indexOf.call(node.parentElement.children, node)));
      } else if (!node.style.getPropertyValue("--i")) {
        node.style.setProperty("--i", "0");
      }
      if (observer) observer.observe(node);
      else reveal(node);
      void index;
    });
  }

  function revealAll() {
    document.querySelectorAll("[data-reveal]").forEach(reveal);
    document.querySelectorAll("[data-type]").forEach((node) => {
      node.textContent = node.dataset.type;
      node.classList.add("is-typed");
    });
  }

  function typeLines(container) {
    const lines = Array.from(container.querySelectorAll("[data-type]"));
    if (reduce) {
      lines.forEach((line) => line.classList.add("is-typed"));
      return;
    }
    lines.forEach((line) => { line.textContent = ""; });
    let lineIndex = 0;
    function nextLine() {
      if (lineIndex >= lines.length) {
        container.classList.add("is-done");
        return;
      }
      const line = lines[lineIndex];
      const text = line.dataset.type || "";
      let i = 0;
      line.classList.add("is-typing");
      const step = () => {
        i += 2;
        line.textContent = text.slice(0, i);
        if (i < text.length) {
          window.setTimeout(step, 18);
        } else {
          line.classList.remove("is-typing");
          line.classList.add("is-typed");
          lineIndex += 1;
          window.setTimeout(nextLine, 90);
        }
      };
      step();
    }
    nextLine();
  }

  function setupTyping() {
    document.querySelectorAll("[data-typing]").forEach((container) => {
      if (!canObserve || reduce) {
        container.querySelectorAll("[data-type]").forEach((line) => line.classList.add("is-typed"));
        return;
      }
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            io.disconnect();
            typeLines(container);
          }
        });
      }, { threshold: 0.35 });
      io.observe(container);
    });
  }

  function setupTopbar() {
    const bar = document.querySelector(".topbar--overlay");
    if (!bar) return;
    const update = () => bar.classList.toggle("is-solid", window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
  }

  if (!reduce && canObserve) {
    root.classList.add("motion-ready");
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          reveal(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  }

  function init() {
    observe(document);
    setupTyping();
    setupTopbar();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.QDMotion = { observe, revealAll, reduce };
})();
