"use strict";
// 放在 <head> 里同步执行：标记「脚本可用」，让滚入动画只在有脚本时才先隐藏内容。
// 没有脚本（或脚本被拦截）时，所有内容直接可见。
document.documentElement.classList.add("js");
