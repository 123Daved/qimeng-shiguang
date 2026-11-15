"use strict";

// 内存限流（令牌桶）：按「客户端 + 类别」计数，单实例部署够用；多实例需要换成共享存储。
// 目的：防止有人刷接口把大模型额度、语音额度和磁盘写满，不是精确计费。

const DEFAULT_RULES = {
  session: { capacity: 20, perMinute: 4 },     // 新建创作会话
  llm: { capacity: 40, perMinute: 20 },        // 采访、导入、生成、修改：每次都会调用大模型
  ask: { capacity: 15, perMinute: 10 },        // 访客问 AI 分身
  voice: { capacity: 30, perMinute: 20 },      // 服务端识别 / 朗读
  event: { capacity: 120, perMinute: 120 },    // 埋点
};

function createRateLimiter(rules = DEFAULT_RULES, now = () => Date.now()) {
  const buckets = new Map();

  function sweep(time) {
    if (buckets.size < 5000) return;
    for (const [key, bucket] of buckets) {
      if (time - bucket.at > 10 * 60 * 1000) buckets.delete(key);
    }
  }

  /** @returns {{ok:true}|{ok:false, retryAfter:number}} */
  function take(kind, client) {
    const rule = rules[kind];
    if (!rule) return { ok: true };
    const time = now();
    sweep(time);
    const key = `${kind}:${client}`;
    const bucket = buckets.get(key) || { tokens: rule.capacity, at: time };
    const refill = ((time - bucket.at) / 60000) * rule.perMinute;
    bucket.tokens = Math.min(rule.capacity, bucket.tokens + refill);
    bucket.at = time;
    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      return { ok: false, retryAfter: Math.max(1, Math.ceil(((1 - bucket.tokens) / rule.perMinute) * 60)) };
    }
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return { ok: true };
  }

  return { take, rules };
}

// 只在明确部署在反向代理后面时才信任 X-Forwarded-For（否则任何人都能伪造 IP 绕过限流）。
function clientOf(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || "unknown";
}

module.exports = { createRateLimiter, clientOf, DEFAULT_RULES };
