"use strict";

function parseJsonLoose(text) {
  const trimmed = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("parse");
  }
}

function textFromMessage(message) {
  const content = typeof message?.content === "string" ? message.content.trim() : "";
  if (content) return { text: content, via: "content" };
  const reasoning = message?.reasoning_content || message?.reasoning || "";
  const fallback = String(reasoning || "").trim();
  if (!fallback) return { text: "", via: "empty" };
  const jsonStart = fallback.indexOf("{");
  const jsonEnd = fallback.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) return { text: fallback.slice(jsonStart, jsonEnd + 1), via: "reasoning" };
  const lines = fallback.split(/\n/).map((line) => line.trim()).filter(Boolean);
  return { text: lines[lines.length - 1] || "", via: "reasoning" };
}

async function chatComplete({ baseUrl, apiKey, model, messages, maxTokens, fetchImpl }) {
  const endpoint = `${String(baseUrl || "").replace(/\/$/, "")}/chat/completions`;
  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.2,
    thinking: { type: "disabled" },
    chat_template_kwargs: { enable_thinking: false },
  };
  const doFetch = fetchImpl || fetch;
  let response;
  try {
    response = await doFetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(50000),
    });
  } catch {
    const error = new Error("network");
    error.code = "network";
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`http_${response.status}`);
    error.code = "http";
    throw error;
  }
  const payload = await response.json();
  const message = payload.choices?.[0]?.message || {};
  const extracted = textFromMessage(message);
  if (!extracted.text) {
    const error = new Error("empty");
    error.code = "empty";
    throw error;
  }
  return extracted.text;
}

/**
 * 流式对话：每收到一段正文就回调 onDelta，返回完整正文。
 * - 思考开关与 chatComplete 一致（模型默认开思考，必须显式关闭）；推理字段不当作正文。
 * - 首包超时与总超时分开算：采访要快，首包迟迟不来就尽早放弃去降级。
 * - 调用方可以用 signal 中途停止（例如已经拿到了那一个问句）。
 */
async function chatStream({ baseUrl, apiKey, model, messages, maxTokens, fetchImpl, onDelta, signal, firstTokenMs = 15000, totalMs = 40000 }) {
  const endpoint = `${String(baseUrl || "").replace(/\/$/, "")}/chat/completions`;
  const body = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.3,
    stream: true,
    thinking: { type: "disabled" },
    chat_template_kwargs: { enable_thinking: false },
  };
  const controller = new AbortController();
  const fail = (code) => Object.assign(new Error(code), { code });
  let timedOut = false;
  let firstTimer = setTimeout(() => { timedOut = true; controller.abort(); }, firstTokenMs);
  const totalTimer = setTimeout(() => { timedOut = true; controller.abort(); }, totalMs);
  const onOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }
  let full = "";
  const take = (text) => {
    if (!text) return;
    if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; }
    full += text;
    if (onDelta) onDelta(text);
  };
  try {
    let response;
    try {
      response = await (fetchImpl || fetch)(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw fail(signal && signal.aborted ? "aborted" : timedOut ? "timeout" : "network");
    }
    if (!response.ok) throw fail("http");
    const type = response.headers.get("content-type") || "";
    if (/application\/json/.test(type)) {
      // 有些网关不支持流式，会直接返回整段 JSON：照常处理。
      const payload = await response.json();
      take(textFromMessage(payload.choices?.[0]?.message || {}).text);
    } else {
      const decoder = new TextDecoder();
      let pending = "";
      let done = false;
      try {
        for await (const chunk of response.body) {
          pending += decoder.decode(chunk, { stream: true });
          let index;
          while ((index = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, index).trim();
            pending = pending.slice(index + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") { done = true; break; }
            try {
              take(JSON.parse(data).choices?.[0]?.delta?.content || "");
            } catch { /* 忽略不完整或非 JSON 的行 */ }
          }
          if (done) break;
        }
      } catch {
        if (signal && signal.aborted) return full;
        throw fail(timedOut ? "timeout" : "network");
      }
    }
    if (!full.trim()) throw fail("empty");
    return full;
  } finally {
    clearTimeout(firstTimer);
    clearTimeout(totalTimer);
    if (signal) signal.removeEventListener("abort", onOuterAbort);
    if (!controller.signal.aborted) controller.abort();
  }
}

module.exports = { chatComplete, chatStream, parseJsonLoose, textFromMessage };
