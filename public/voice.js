"use strict";

/*
 * 憩梦时光 · 语音层（voice.js）
 * - 语音识别：Web Speech API（SpeechRecognition / webkitSpeechRecognition），zh-CN，
 *   支持按住说话与连续对话、实时转写（interim）、静音自动提交。
 * - 声音电平：getUserMedia + Web Audio AnalyserNode，驱动声纹球与波形。
 * - 朗读：speechSynthesis，优先挑选中文音色，可随时打断。
 * - 按句朗读：createSpeaker 维护一个句子队列，采访官说一句就读一句，可随时打断。
 * - 打断：createBargeIn 在朗读时监听麦克风电平，用户一开口就停下来听。
 * - 断句：停顿多久算说完，会按已经说出的内容自适应（adaptiveSilence）。
 * - 服务端识别：createServerRecognizer 录音后交给 /api/asr（需要服务端已配置）。
 * 不支持的浏览器（如 Firefox）会返回 supported=false，由界面退回服务端识别或打字。
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

  /**
   * 自适应断句：停顿多久算「说完了」。
   * 刚开口、或者话停在「然后 / 还有 / 就是」这类没说完的地方，就多等一会儿；
   * 已经说了完整的一长句，就快一点提交，减少干等。
   */
  function adaptiveSilence(text, base) {
    const normal = base || 1400;
    const value = String(text || "").replace(/[\s，。！？、,.!?]+$/g, "");
    const length = Array.from(value).length;
    if (!length) return normal;
    if (/(然后|还有|就是|以及|而且|但是|不过|因为|所以|比如|或者|另外|那个|嗯|呃|和|跟|是|的)$/.test(value)) return Math.round(normal * 1.6);
    if (length < 6) return Math.round(normal * 1.35);
    if (length > 28) return Math.round(normal * 0.75);
    return normal;
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
      const wait = options.adaptive === false ? options.silenceMs : adaptiveSilence(finalText + interimText, options.silenceMs);
      silenceTimer = window.setTimeout(() => { stop(true); }, wait);
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
      get stream() { return stream; },
    };
  }

  /**
   * 打断检测：朗读期间盯着麦克风电平，用户一开口就回调。
   * 喇叭外放时麦克风会收到朗读本身的声音，所以先量一小段「朗读底噪」作基线，
   * 只有明显高过基线并持续约 0.25 秒才算有人说话。
   */
  function createBargeIn(meter, onBargeIn) {
    let timer = 0;
    let samples = 0;
    let baseline = 0;
    let hot = 0;
    function stop() { window.clearInterval(timer); timer = 0; }
    function start() {
      stop();
      if (!meter || !meter.active) return false;
      samples = 0; baseline = 0; hot = 0;
      timer = window.setInterval(() => {
        const level = meter.read().level;
        samples += 1;
        if (samples <= 7) { baseline = Math.max(baseline, level); return; }
        const threshold = Math.max(0.2, baseline * 2.4 + 0.08);
        hot = level > threshold ? hot + 1 : 0;
        if (hot >= 4) { stop(); onBargeIn(level); }
      }, 60);
      return true;
    }
    return { start, stop, get active() { return !!timer; } };
  }

  /**
   * 服务端识别：浏览器自带识别不可用时的替代通道。
   * 用 MediaRecorder 录音，靠电平判断说完（先听到声音，再安静一段时间），然后交给 /api/asr。
   * 没有实时字幕，识别期间由界面显示「正在识别」。
   */
  function createServerRecognizer(opts) {
    const options = Object.assign({ silenceMs: 1400, maxMs: 45000, autoCommit: true }, opts || {});
    let recorder = null;
    let chunks = [];
    let listening = false;
    let submit = true;
    let vad = 0;
    function emitState(state) { if (options.onState) options.onState(state); }
    async function start() {
      if (listening) return true;
      const meter = options.meter;
      if (!meter || !window.MediaRecorder || !(await meter.open())) {
        if (options.onError) options.onError("audio-capture", errorText("audio-capture"));
        return false;
      }
      chunks = [];
      submit = true;
      try {
        recorder = new MediaRecorder(meter.stream);
      } catch (error) {
        if (options.onError) options.onError("start", errorText("start"));
        return false;
      }
      recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        window.clearInterval(vad);
        listening = false;
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (!submit || blob.size < 800) { emitState("idle"); if (submit && options.onEmpty) options.onEmpty(); return; }
        emitState("recognizing");
        try {
          const text = await options.transcribe(blob);
          emitState("idle");
          if (text && options.onFinal) options.onFinal(text);
          else if (options.onEmpty) options.onEmpty();
        } catch (error) {
          emitState("idle");
          if (options.onError) options.onError("server", error.message || errorText("server"));
        }
      };
      recorder.start(250);
      listening = true;
      emitState("listening");
      const startedAt = performance.now();
      let spoke = false;
      let quietSince = 0;
      vad = window.setInterval(() => {
        const now = performance.now();
        const level = meter.read().level;
        if (level > 0.12) { spoke = true; quietSince = 0; if (options.onLevel) options.onLevel(level); }
        else if (spoke && !quietSince) quietSince = now;
        const waited = quietSince ? now - quietSince : 0;
        if (options.autoCommit && spoke && waited > options.silenceMs) stop(true);
        else if (options.autoCommit && !spoke && now - startedAt > 8000) stop(false);
        else if (now - startedAt > options.maxMs) stop(true);
      }, 80);
      return true;
    }
    function stop(send) {
      if (!recorder || recorder.state === "inactive") return;
      submit = send !== false;
      try { recorder.stop(); } catch (error) { /* already stopped */ }
    }
    return { start, stop, abort() { stop(false); }, get listening() { return listening; }, setOptions(next) { Object.assign(options, next || {}); }, kind: "server" };
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

  /**
   * 按句朗读队列：enqueue 一句读一句，cancel 立刻停。
   * - 浏览器朗读（speechSynthesis）：拿不到真实音频，电平按朗读进度估算；
   * - 服务端朗读（options.fetchAudio）：播放返回的音频，并用 AnalyserNode 读真实电平；
   *   任何一句失败就自动改回浏览器朗读，不中断对话。
   */
  function createSpeaker(opts) {
    const options = opts || {};
    const queue = [];
    let active = false;
    let generation = 0;
    let pulse = 0;
    let useServer = typeof options.fetchAudio === "function";
    let audioCtx = null;
    let analyser = null;
    let wave = null;
    let current = null;
    let idleWaiters = [];

    function settle() {
      active = false;
      if (options.onIdle) options.onIdle();
      const waiters = idleWaiters;
      idleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }

    function speakBrowser(text, token) {
      return new Promise((resolve) => {
        if (!synth) return resolve();
        const utter = new SpeechSynthesisUtterance(String(text).replace(/[「」]/g, ""));
        utter.lang = "zh-CN";
        if (voice || pickVoice()) utter.voice = voice;
        utter.rate = options.rate || 1.04;
        let done = false;
        const finish = () => { if (done) return; done = true; window.clearTimeout(guard); resolve(); };
        utter.onend = finish;
        utter.onerror = finish;
        utter.onboundary = () => { if (token === generation) pulse = 1; };
        // 没有中文音色时部分浏览器不触发 onend：按字数估一个上限兜底。
        const guard = window.setTimeout(finish, Math.max(2500, String(text).length * 330));
        synth.speak(utter);
      });
    }

    async function speakServer(text, token) {
      const blob = await options.fetchAudio(text);
      if (token !== generation) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      current = audio;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx && !audioCtx) audioCtx = new Ctx();
        if (audioCtx) {
          if (audioCtx.state === "suspended") await audioCtx.resume();
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          wave = new Uint8Array(analyser.fftSize);
          const source = audioCtx.createMediaElementSource(audio);
          source.connect(analyser);
          analyser.connect(audioCtx.destination);
        }
      } catch (error) { analyser = null; }
      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onerror = () => reject(new Error("audio"));
        audio.play().catch(reject);
      }).finally(() => { URL.revokeObjectURL(url); current = null; analyser = null; });
    }

    async function pump() {
      if (active) return;
      active = true;
      const token = generation;
      if (options.onStart) options.onStart();
      while (queue.length && token === generation) {
        const text = queue.shift();
        if (options.onSentence) options.onSentence(text);
        if (useServer) {
          try { await speakServer(text, token); continue; }
          catch (error) { useServer = false; if (options.onFallback) options.onFallback(); if (token !== generation) break; }
        }
        await speakBrowser(text, token);
      }
      if (token === generation) settle();
    }

    return {
      enqueue(text) {
        const value = String(text || "").trim();
        if (!value || (!synth && !useServer)) return false;
        queue.push(value);
        pump();
        return true;
      },
      cancel() {
        generation += 1;
        queue.length = 0;
        if (synth) synth.cancel();
        if (current) { try { current.pause(); } catch (error) { /* noop */ } current = null; }
        if (active) settle();
      },
      whenIdle() { return active ? new Promise((resolve) => idleWaiters.push(resolve)) : Promise.resolve(); },
      /** 0..1：服务端朗读是真实电平，浏览器朗读是按进度估算的脉冲。 */
      level() {
        if (!active) return 0;
        if (analyser && wave) {
          analyser.getByteTimeDomainData(wave);
          let sum = 0;
          for (let i = 0; i < wave.length; i += 1) { const v = (wave[i] - 128) / 128; sum += v * v; }
          return Math.min(1, Math.sqrt(sum / wave.length) * 4.2);
        }
        pulse *= 0.9;
        return 0.22 + pulse * 0.35;
      },
      get speaking() { return active; },
      get real() { return !!analyser; },
    };
  }

  window.QDVoice = {
    supported: !!Recognition,
    canSpeak: !!synth,
    hasMic,
    canRecord: hasMic && !!window.MediaRecorder,
    createRecognizer,
    createServerRecognizer,
    createMeter,
    createBargeIn,
    createSpeaker,
    adaptiveSilence,
    speak,
    cancelSpeak,
    errorText,
  };
})();
