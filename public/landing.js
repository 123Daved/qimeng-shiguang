"use strict";

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
    });
  }
  const all = Array.from(document.querySelectorAll("[data-start]"));
  all.forEach((node) => { node.disabled = true; });
  const original = button.innerHTML;
  button.textContent = "正在创建";
  try {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, source, ref: params.get("ref") || "" }),
    });
    const data = await response.json();
    if (!response.ok) {
      window.alert(data.error || "没有创建成功，请再试一次。");
      button.innerHTML = original;
      all.forEach((node) => { node.disabled = false; });
      return;
    }
    location.href = data.workbenchUrl;
  } catch {
    window.alert("网络中断了，请再试一次。");
    button.innerHTML = original;
    all.forEach((node) => { node.disabled = false; });
  }
}

readConfig().catch(() => {});
document.querySelectorAll("[data-start]").forEach((node) => {
  node.addEventListener("click", (event) => start(node.dataset.start === "demo" ? "demo" : "interview", event.currentTarget));
});
if (new URLSearchParams(location.search).get("from") === "footer") {
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "landing_view", source: "footer", slug: new URLSearchParams(location.search).get("ref") || "" }),
  });
}
