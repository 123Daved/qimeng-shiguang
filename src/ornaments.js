/* 手绘装饰生成器：确定性（同 seed 同形）、零依赖、纯函数。
   render.js 在服务端把结果内联为 SVG，所以关掉脚本也能看到手绘线、撕边和剪纸山。 */
(function (root) {
  function rng(seed) { var s = (seed >>> 0) || 1; return function () { s = (Math.imul(s ^ (s >>> 15), 2246822519) + 1013904223) >>> 0; return s / 4294967296; }; }
  function vnoise(r, n) { var a = []; for (var i = 0; i <= n + 2; i++) a.push(r()); return function (x) { var i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return a[i] * (1 - u) + a[i + 1] * u; }; }
  function f(n) { return +n.toFixed(1); }

  /* 撕边：返回「撕边以下」的闭合区域 path，viewBox = 0 0 w h；edge 位于 h*base 附近 */
  function torn(w, h, o) {
    o = o || {}; var r = rng(o.seed || 7), amp = o.amp == null ? 7 : o.amp, base = o.base == null ? 0.5 : o.base;
    var n1 = vnoise(r, Math.ceil(w / 90) + 3), n2 = vnoise(r, Math.ceil(w / 17) + 3), d = 'M0 ' + h + ' L0 ';
    var pts = []; for (var x = 0; x <= w + 6; x += 6) pts.push([x, h * base + amp * ((n1(x / 90) - .5) * 1.4 + (n2(x / 17) - .5) * .9)]);
    d += f(pts[0][1]); pts.forEach(function (p) { d += ' L' + f(p[0]) + ' ' + f(p[1]); }); return d + ' L' + w + ' ' + h + ' Z';
  }
  /* 剪纸山：peaks 个山峰，粗糙度 rough；返回闭合 path（贴底） */
  function mountain(w, h, o) {
    o = o || {}; var r = rng(o.seed || 3), peaks = o.peaks || 3, rough = o.rough == null ? .25 : o.rough, pts = [[0, h]];
    var xs = [0]; for (var i = 1; i <= peaks; i++) xs.push(w * (i - .5 + (r() - .5) * .5) / peaks); xs.push(w);
    var ys = xs.map(function (_, i) { return i === 0 || i === xs.length - 1 ? h * (.55 + r() * .25) : h * (.1 + r() * .3); });
    function seg(x0, y0, x1, y1, depth) { if (depth === 0) { pts.push([x1, y1]); return; } var mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + (r() - .5) * (x1 - x0) * rough; seg(x0, y0, mx, my, depth - 1); seg(mx, my, x1, y1, depth - 1); }
    for (var k = 0; k < xs.length - 1; k++) seg(xs[k], ys[k], xs[k + 1], ys[k + 1], 3);
    pts.push([w, h]); return 'M' + pts.map(function (p) { return f(p[0]) + ' ' + f(Math.min(h, p[1])); }).join(' L') + ' Z';
  }
  /* 手绘笔触：从左到右的起伏线（用于下划线）；kind: 'wave' | 'flat' */
  function brush(w, o) {
    o = o || {}; var r = rng(o.seed || 5), amp = o.amp == null ? 3 : o.amp, n = o.kind === 'wave' ? Math.max(4, Math.round(w / 26)) : Math.max(3, Math.round(w / 50)), y0 = o.h ? o.h / 2 : 8;
    var d = 'M2 ' + f(y0 + (r() - .5) * amp), px = 2, py = y0; for (var i = 1; i <= n; i++) {
      var x = 2 + (w - 4) * i / n, y = o.kind === 'wave' ? y0 + (i % 2 ? -1 : 1) * amp * (.7 + r() * .6) : y0 + (r() - .5) * amp * 1.6;
      var cx1 = px + (x - px) * .4, cx2 = px + (x - px) * .7; d += ' C' + f(cx1) + ' ' + f(py + (r() - .5) * amp) + ' ' + f(cx2) + ' ' + f(y + (r() - .5) * amp) + ' ' + f(x) + ' ' + f(y); px = x; py = y;
    } return d;
  }
  /* 把 path 包成 <svg>；draw=true 时带书写动画所需的 pathLength */
  function svg(vbW, vbH, path, cls, extra) { return '<svg class="' + (cls || '') + '" viewBox="0 0 ' + vbW + ' ' + vbH + '" preserveAspectRatio="none" aria-hidden="true" focusable="false"' + (extra || '') + '><path d="' + path + '" pathLength="1"/></svg>'; }
  var api = { rng: rng, torn: torn, mountain: mountain, brush: brush, svg: svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QMOrn = api;
})(typeof window !== 'undefined' ? window : globalThis);
