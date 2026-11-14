"use strict";

// 把流式文本切成句子：大模型一边吐字，这里一边在句末标点处切开，
// 让前端可以「说一句、读一句」，不用等整段回复。

const TERMINATORS = "。！？!?；;\n";
const CLOSERS = "」』”’\"')）】";

function createSentenceSplitter(onSentence) {
  let buffer = "";

  function emit(raw) {
    const text = raw.replace(/\s+/g, " ").trim();
    if (text) onSentence(text);
  }

  function push(chunk) {
    buffer += String(chunk || "");
    let start = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      if (!TERMINATORS.includes(buffer[i])) continue;
      // 句末标点后面紧跟的引号、括号属于这一句；如果它们还没到，先等下一段。
      let end = i + 1;
      while (end < buffer.length && (CLOSERS.includes(buffer[end]) || TERMINATORS.includes(buffer[end]))) end += 1;
      if (end === buffer.length && buffer[i] !== "\n") {
        // 可能还有收尾引号在路上：只在缓冲区后面确实有内容时才切。
        break;
      }
      emit(buffer.slice(start, end));
      start = end;
      i = end - 1;
    }
    buffer = buffer.slice(start);
  }

  function flush() {
    const rest = buffer;
    buffer = "";
    emit(rest);
  }

  return { push, flush };
}

function splitSentences(text) {
  const out = [];
  const splitter = createSentenceSplitter((sentence) => out.push(sentence));
  splitter.push(text);
  splitter.flush();
  return out;
}

function isQuestion(sentence) {
  return /[？?][」』”’"')）】]*$/.test(String(sentence || "").trim());
}

module.exports = { createSentenceSplitter, splitSentences, isQuestion };
