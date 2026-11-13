"use strict";

const boot = window.__QD_SITE__ || { slug: "", faqs: [] };
const panel = document.querySelector("#avatar");
const log = document.querySelector("#avatar-log");
const input = document.querySelector("#avatar-input");

function addMessage(text, role) {
  const box = document.createElement("div");
  box.className = `avatar-msg ${role}`;
  if (role === "assistant") {
    const flag = document.createElement("p");
    flag.className = "ai-flag";
    flag.textContent = "AI 生成";
    box.append(flag);
  }
  const body = document.createElement("p");
  body.textContent = text;
  box.append(body);
  log.append(box);
  log.scrollTop = log.scrollHeight;
  if (role === "assistant" && speakToggle && speakToggle.checked && window.QDVoice) window.QDVoice.speak(text);
}

const speakToggle = document.querySelector("#avatar-speak");
const micButton = document.querySelector("#avatar-mic");
if (speakToggle) {
  if (!window.QDVoice || !window.QDVoice.canSpeak) speakToggle.closest("label").hidden = true;
  else speakToggle.checked = localStorage.getItem("qd-avatar-speak") === "1";
  speakToggle.addEventListener("change", () => {
    localStorage.setItem("qd-avatar-speak", speakToggle.checked ? "1" : "0");
    if (!speakToggle.checked && window.QDVoice) window.QDVoice.cancelSpeak();
  });
}
if (micButton && window.QDVoice && window.QDVoice.supported) {
  micButton.hidden = false;
  const recognizer = window.QDVoice.createRecognizer({
    autoCommit: true,
    silenceMs: 1400,
    onInterim(finalText, interim) { input.value = finalText + interim; },
    onFinal(text) {
      input.value = text;
      document.querySelector("#avatar-form").requestSubmit();
    },
    onState(state) {
      micButton.classList.toggle("is-on", state === "listening");
      micButton.setAttribute("aria-pressed", state === "listening" ? "true" : "false");
    },
    onError(code, message) { if (message) input.placeholder = message; },
  });
  micButton.addEventListener("click", () => {
    if (recognizer.listening) recognizer.stop(true);
    else {
      window.QDVoice.cancelSpeak();
      recognizer.start();
    }
  });
}

document.querySelector("#avatar-open").addEventListener("click", () => {
  panel.hidden = false;
  input.focus();
  fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "avatar_open", slug: boot.slug }),
  });
});
document.querySelector("#avatar-close").addEventListener("click", () => {
  panel.hidden = true;
});
document.querySelectorAll("#avatar-chips .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    input.value = chip.dataset.q || chip.textContent;
    input.focus();
  });
});
document.querySelector("#avatar-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = input.value.trim();
  if (!question) return;
  addMessage(question, "user");
  input.value = "";
  const button = event.submitter || document.querySelector("#avatar-form button");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "发送中";
  try {
    const response = await fetch(`/api/sites/${encodeURIComponent(boot.slug)}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const data = await response.json();
    addMessage(data.answer || data.error || "刚才没有答上来，请再试一次。", "assistant");
  } catch {
    addMessage("网络中断了。可以稍后再问，或直接联系本人。", "assistant");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});
document.querySelectorAll(".contact").forEach((node) => {
  node.addEventListener("click", () => {
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "contact_click", slug: boot.slug, source: node.dataset.channel || "" }),
    });
  });
});
