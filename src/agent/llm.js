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

module.exports = { chatComplete, parseJsonLoose, textFromMessage };
