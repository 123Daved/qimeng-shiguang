"use strict";

// 意图识别：一句话进来，先判断它是「口令」「修改」还是「回答」。
// 全部用规则，不调用大模型：口令要零延迟，也不能因为模型出错而失灵。
// 口令只在整句很短、且整句就是口令时才命中，避免把正常回答里的「跳过」「发布」误判。

const THEME_WORDS = "温暖|简约|墨色|光影|杂志";
const COMMAND_MAX = 14;

function normalize(text) {
  return String(text || "").replace(/[\s，。！？、,.!?~～…「」"'“”]/g, "");
}

const COMMANDS = [
  ["redo", /^(不对|哎呀|啊|抱歉|对不起)?(我)?(刚才|刚刚|上一句)?(那句)?(说错了?|讲错了?|口误)(重新?说|重来|重说)?(一遍|一下)?$/],
  ["redo", /^(我)?(重新?说|重来|重讲|重新回答)(一遍|一下|一次)?(吧)?$/],
  ["redo", /^(刚才|刚刚|上一句)(那句)?(不算|作废|删掉|去掉)(吧)?$/],
  ["skip", /^(这个|这题|这一题|这个问题|这个话题|先)?(先)?(跳过|略过|pass|过)(吧|这个|这题|这一题|这个问题)?$/i],
  ["skip", /^(下一个|下一题|下个问题|下一个问题|下一个话题)(吧)?$/],
  ["skip", /^(这个)?(先)?(不想说|不说了|先不说|不方便说|以后再说)(吧|了)?$/],
  ["back", /^(返回|回到|回去|退回|退回到)?(上一个|上一题|上个问题|上一个问题|上一个话题|上一步)(吧)?$/],
  ["back", /^(返回|回去|退回去|往回)(吧|一下)?$/],
  ["repeat", /^(请)?(你)?(再说一遍|再说一次|再讲一遍|重复一下|重复一遍|再问一遍|没听清|没听清楚|你说什么|什么)(吧)?$/],
  ["stop", /^(先)?(停|暂停|停一下|等一下|等等|别说了|安静|先停一下)(吧)?$/],
  ["generate", /^(请|帮我|可以|好了)?(开始)?生成(一下)?(网站|网页|我的网站)?(吧|了)?$/],
];

const EDIT_HINT = /^(请|帮我|麻烦)?(把|将)|改成|改为|换成|换一|加一个|加上|添加|新增|删掉|删除|去掉|写得|改短|改长|更短|更长|活泼|正式一点|简洁一点/;

function themeOf(text) {
  const matched = text.match(new RegExp(`(?:换成|改成|切换到|切到|换|用)(${THEME_WORDS})`)) || text.match(new RegExp(`^(${THEME_WORDS})(风格|主题|风)?$`));
  return matched ? matched[1] : "";
}

/**
 * @param {string} raw 用户这句话
 * @param {{hasProfile?:boolean, complete?:boolean, topic?:string, section?:string, sectionLabel?:string}} ctx
 * @returns {{kind:"command",command:string}|{kind:"edit",instruction:string,section?:string}|{kind:"answer"}}
 */
function classifyUtterance(raw, ctx = {}) {
  const text = normalize(raw);
  if (!text) return { kind: "answer" };

  if (text.length <= COMMAND_MAX) {
    for (const [command, pattern] of COMMANDS) {
      if (pattern.test(text)) return { kind: "command", command };
    }
    if (ctx.hasProfile && /^(请|帮我)?(发布|上线)(网站|一下)?(吧)?$/.test(text)) return { kind: "command", command: "publish" };
  }

  // 已经生成网站：点选了区块、或六个话题已聊完、或这句话明显是修改 → 一句话修改
  if (ctx.hasProfile) {
    const theme = text.length <= COMMAND_MAX ? themeOf(text) : "";
    if (theme && !ctx.section) return { kind: "edit", instruction: `风格换成${theme}` };
    const original = String(raw || "").trim();
    if (ctx.section) {
      const label = ctx.sectionLabel || ctx.section;
      return { kind: "edit", section: ctx.section, instruction: `只修改「${label}」这一版块，其他版块保持原样：${original}` };
    }
    if (ctx.complete || EDIT_HINT.test(text)) return { kind: "edit", instruction: original };
  }

  return { kind: "answer" };
}

module.exports = { classifyUtterance, normalize, THEME_WORDS };
