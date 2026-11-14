"use strict";

// 服务端语音接口（ASR 语音识别 / TTS 语音合成）的可插拔层。
//
// 默认什么都不接：/api/asr 与 /api/tts 返回 501，前端自动退回浏览器自带的识别与朗读，
// 再不行就退回打字。要接入服务端语音，有两种办法：
//   1) 配环境变量，使用任何兼容 OpenAI 语音接口的服务（/audio/transcriptions、/audio/speech）：
//        ASR_BASE_URL  ASR_API_KEY  ASR_MODEL
//        TTS_BASE_URL  TTS_API_KEY  TTS_MODEL  TTS_VOICE
//   2) 在 createServer({ asrProvider, ttsProvider }) 里传入自己的实现（讯飞、阿里、腾讯等）。
//
// 约定：
//   asrProvider.transcribe(buffer, { mime, lang }) -> Promise<{ text }>
//   ttsProvider.synthesize(text, { voice })        -> Promise<{ audio: Buffer, mime }>
// 密钥只从环境变量读取，不写进代码、日志和返回值。

function trimSlash(url) {
  return String(url || "").replace(/\/$/, "");
}

function providerError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function openAiAsr({ baseUrl, apiKey, model, fetchImpl }) {
  return {
    name: "openai-compatible",
    async transcribe(buffer, { mime = "audio/webm", lang = "zh" } = {}) {
      const form = new FormData();
      const ext = /mp4|m4a|aac/.test(mime) ? "m4a" : /ogg/.test(mime) ? "ogg" : /wav/.test(mime) ? "wav" : "webm";
      form.append("file", new Blob([buffer], { type: mime }), `speech.${ext}`);
      form.append("model", model);
      form.append("language", lang);
      let response;
      try {
        response = await (fetchImpl || fetch)(`${trimSlash(baseUrl)}/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: AbortSignal.timeout(30000),
        });
      } catch {
        throw providerError("network");
      }
      if (!response.ok) throw providerError(`http_${response.status}`);
      const payload = await response.json();
      return { text: String(payload.text || "").trim() };
    },
  };
}

function openAiTts({ baseUrl, apiKey, model, voice, fetchImpl }) {
  return {
    name: "openai-compatible",
    async synthesize(text, options = {}) {
      let response;
      try {
        response = await (fetchImpl || fetch)(`${trimSlash(baseUrl)}/audio/speech`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, voice: options.voice || voice || "alloy", input: text, response_format: "mp3" }),
          signal: AbortSignal.timeout(30000),
        });
      } catch {
        throw providerError("network");
      }
      if (!response.ok) throw providerError(`http_${response.status}`);
      return { audio: Buffer.from(await response.arrayBuffer()), mime: response.headers.get("content-type") || "audio/mpeg" };
    },
  };
}

function providersFromEnv(env, fetchImpl) {
  const out = { asr: null, tts: null };
  if (env.ASR_BASE_URL && env.ASR_API_KEY && env.ASR_MODEL) {
    out.asr = openAiAsr({ baseUrl: env.ASR_BASE_URL, apiKey: env.ASR_API_KEY, model: env.ASR_MODEL, fetchImpl });
  }
  if (env.TTS_BASE_URL && env.TTS_API_KEY && env.TTS_MODEL) {
    out.tts = openAiTts({ baseUrl: env.TTS_BASE_URL, apiKey: env.TTS_API_KEY, model: env.TTS_MODEL, voice: env.TTS_VOICE, fetchImpl });
  }
  return out;
}

module.exports = { providersFromEnv, openAiAsr, openAiTts };
