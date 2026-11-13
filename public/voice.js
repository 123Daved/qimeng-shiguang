"use strict";

/*
 * 憩梦时光 · 语音层（voice.js）
 * - 语音识别：Web Speech API（SpeechRecognition / webkitSpeechRecognition），zh-CN，
 *   支持按住说话与连续对话、实时转写（interim）、静音自动提交。
 * - 声音电平：getUserMedia + Web Audio AnalyserNode，驱动声纹球与波形。
 * - 朗读：speechSynthesis，优先挑选中文音色，可随时打断。
 * 不支持的浏览器（如 Firefox）会返回 supported=false，由界面退回打字。
 */
(function () {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const synth = window.speechSynthesis || null;
  const hasMic = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  const ERRORS = {
    "not-allowed": "麦克风权限被拒绝了。请在地址栏左侧允许使用麦克风，或者先打字回答。",
    "service-not-allowed": "浏览器没有开放语音识别服务。可以换 Chrome / Edge / Safari，或者先打字回答。",
    "audio-capture": "没有找到可用的麦克风。请检查设备，或者先打字回答。",
    network: "语音识别服务连不上（浏览器的识别服务需要联网，部分网络环境下不可用）。可以换 Edge / Safari 试试，或者先打字回答。",
    "no-speech": "刚才没听到声音，再说一次试试。",
    aborted: "",
    "language-not-supported": "这个浏览器不支持中文语音识别，请先打字回答。",
  };

  function errorText(code) {
    return ERRORS[code] !== undefined ? ERRORS[code] : "语音识别出了点问题，可以再试一次，或者先打字回答。";
  }

  /** 统一的识别器：一次 start() 对应一段话；continuous 模式下按静音间隔切分并自动提交。 */
  function createRecognizer(opts) {
    const options = Object.assign({ lang: "zh-CN", silenceMs: 1600, continuous: false }, opts || {});
    let rec = null;
    let listening = false;
    let finalText = "";
    let interimText = "";
    let silenceTimer = 0;
    let wantStop = false;
    let committed = false;

    function emitState(state) { if (options.onState) options.onState(state); }

    function commit() {
      window.clearTimeout(silenceTimer);
      if (committed) return;
      const text = (finalText + interimText).trim();
      committed = true;
      if (text && options.onFinal) options.onFinal(text);
      else if (!text && options.onEmpty) options.onEmpty();
    }

    function armSilence() {
      if (!options.autoCommit) return;
      window.clearTimeout(silenceTimer);
      silenceTimer = window.setTimeout(() => { stop(true); }, options.silenceMs);
    }

    function start() {
      if (!Recognition) return false;
      if (listening) return true;
      finalText = "";
      interimText = "";
      wantStop = false;
      committed = false;
      rec = new Recognition();
      rec.lang = options.lang;
      rec.interimResults = true;
      rec.continuous = true;
      rec.maxAlternatives = 1;
      rec.onstart = () => { listening = true; emitState("listening"); };
      rec.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (result.isFinal) finalText += result[0].transcript;
          else interim += result[0].transcript;
        }
        interimText = interim;
        if (options.onInterim) options.onInterim(finalText, interimText);
        armSilence();
      };
      rec.onerror = (event) => {
        const code = event.error || "error";
        if (code === "no-speech" && options.autoCommit && !finalText) { emitState("idle"); }
        if (options.onError && code !== "aborted") options.onError(code, errorText(code));
      };
      rec.onend = () => {
        listening = false;
        window.clearTimeout(silenceTimer);
        if (wantStop) commit();
        else if ((finalText + interimText).trim()) commit();
        emitState("idle");
      };
      try {
        rec.start();
      } catch (error) {
        if (options.onError) options.onError("start", errorText("start"));
        return false;
      }
      return true;
    }

    function stop(submit) {
      if (!rec) return;
      wantStop = submit !== false;
      if (!wantStop) committed = true;
      try { rec.stop(); } catch (error) { /* already stopped */ }
    }

    function abort() {
      committed = true;
      wantStop = false;
      window.clearTimeout(silenceTimer);
      if (rec) { try { rec.abort(); } catch (error) { /* noop */ } }
      listening = false;
    }

    return {
      start,
      stop,
      abort,
      get listening() { return listening; },
      setOptions(next) { Object.assign(options, next || {}); },
    };
  }

  /** 麦克风电平表：返回 0..1 的音量和频谱，用于声纹球。 */
  function createMeter() {
    let ctx = null;
    let analyser = null;
    let stream = null;
    let data = null;
    let wave = null;
    return {
      async open() {
        if (!hasMic) return false;
        if (analyser) return true;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
          const Ctx = window.AudioContext || window.webkitAudioContext;
          ctx = new Ctx();
          const source = ctx.createMediaStreamSource(stream);
          analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.78;
          source.connect(analyser);
          data = new Uint8Array(analyser.frequencyBinCount);
          wave = new Uint8Array(analyser.fftSize);
          return true;
        } catch (error) {
          return false;
        }
      },
      read() {
        if (!analyser) return { level: 0, bands: null, wave: null };
        analyser.getByteFrequencyData(data);
        analyser.getByteTimeDomainData(wave);
        let sum = 0;
        for (let i = 0; i < wave.length; i += 1) { const v = (wave[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / wave.length);
        return { level: Math.min(1, rms * 4.2), bands: data, wave };
      },
      close() {
        if (stream) stream.getTracks().forEach((track) => track.stop());
        if (ctx && ctx.state !== "closed") ctx.close();
        ctx = null; analyser = null; stream = null;
      },
      get active() { return !!analyser; },
    };
  }

  let voice = null;
  function pickVoice() {
    if (!synth) return null;
    const voices = synth.getVoices();
    const zh = voices.filter((v) => /^zh(-|_)?(CN|Hans)?/i.test(v.lang) || /Chinese|中文|普通话|Xiaoxiao|Tingting|Yunxi/i.test(v.name));
    const preferred = zh.find((v) => /Xiaoxiao|Tingting|Yunxi|Natural|Google/i.test(v.name)) || zh[0] || null;
    voice = preferred;
    return voice;
  }
  if (synth) {
    pickVoice();
    if (typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", pickVoice);
  }

  function speak(text, opts) {
    const options = opts || {};
    if (!synth || !text) { if (options.onend) options.onend(); return false; }
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(String(text).replace(/[「」]/g, ""));
    utter.lang = "zh-CN";
    if (voice || pickVoice()) utter.voice = voice;
    utter.rate = options.rate || 1.04;
    utter.pitch = 1;
    let done = false;
    const finish = () => { if (done) return; done = true; if (options.onend) options.onend(); };
    utter.onend = finish;
    utter.onerror = finish;
    if (options.onboundary) utter.onboundary = options.onboundary;
    synth.speak(utter);
    // 一些浏览器没有中文音色时不会触发 onend，兜底按字数估算。
    window.setTimeout(finish, Math.max(2500, String(text).length * 320));
    return true;
  }

  function cancelSpeak() { if (synth) synth.cancel(); }

  window.QDVoice = {
    supported: !!Recognition,
    canSpeak: !!synth,
    hasMic,
    createRecognizer,
    createMeter,
    speak,
    cancelSpeak,
    errorText,
  };
})();
