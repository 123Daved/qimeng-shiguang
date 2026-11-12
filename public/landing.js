"use strict";

async function readConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();
  const notice = document.querySelector("#model-notice");
  if (notice) notice.textContent = config.modelNotice || "";
  return config;
}

async function start(mode) {
  const params = new URLSearchParams(location.search);
  const source = params.get("from") === "footer" ? "footer" : "direct";
  if (source === "footer") {
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "footer_cta_click", slug: params.get("ref") || "" }),
    });
  }
  const response = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, source, ref: params.get("ref") || "" }),
  });
  const data = await response.json();
  if (!response.ok) {
    window.alert(data.error || "没有创建成功，请再试一次。");
    return;
  }
  location.href = data.workbenchUrl;
}

readConfig().catch(() => {});
document.querySelector("#start").addEventListener("click", () => start("interview"));
document.querySelector("#demo").addEventListener("click", () => start("demo"));
if (new URLSearchParams(location.search).get("from") === "footer") {
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "landing_view", source: "footer", slug: new URLSearchParams(location.search).get("ref") || "" }),
  });
}
