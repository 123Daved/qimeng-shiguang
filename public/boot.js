"use strict";
// 个人网站的启动数据放在 <script type="application/json" id="qd-site"> 里（不会被执行），
// 这样页面可以启用严格的内容安全策略（CSP：不允许内联脚本）。
(function () {
  const node = document.getElementById("qd-site");
  try {
    window.__QD_SITE__ = node ? JSON.parse(node.textContent || "{}") : {};
  } catch (error) {
    window.__QD_SITE__ = {};
  }
})();
