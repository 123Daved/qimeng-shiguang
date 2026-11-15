"use strict";

/*
 * 语音球：五个状态 idle / listening / thinking / speaking / error。
 * 平面半透明叠层，不用光晕和渐变（品牌规范禁止用装饰光晕替代识别）。
 * 每个状态除了颜色还有不同的形状标记（话筒、三点、声波、感叹号），不只靠颜色区分。
 * 幅度由调用方用 setLevel(0..1) 喂进来：工作台用真实麦克风 / 朗读电平，首页用示意值。
 * 系统开启「减少动态效果」时不做持续动画，只在状态变化时重画一帧。
 */
(function (root) {
  const COLORS = {
    idle: ["#A9532F", "#E3A283"],
    listening: ["#A9532F", "#C9784F"],
    thinking: ["#6B5E55", "#B9AB9C"],
    speaking: ["#924526", "#E3A283"],
    error: ["#B33C35", "#F2AAA3"],
  };
  const TAU = Math.PI * 2;

  function Orb(canvas, opts) {
    this.c = canvas;
    this.g = canvas.getContext("2d");
    this.state = "idle";
    this.level = 0;
    this.smooth = 0;
    this.t = 0;
    this.reduce = !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.visible = true;
    this.resize((opts && opts.size) || canvas.clientWidth || 240);
    const self = this;
    let last = 0;
    // 约 30 帧每秒就足够平滑；不在屏幕上、标签页在后台时不画，省电也不占主线程。
    this._loop = function (ts) {
      if (self.stopped) return;
      self.raf = root.requestAnimationFrame(self._loop);
      if (!self.visible || document.hidden || ts - last < 32) return;
      last = ts;
      self.t = ts / 1000;
      self.draw();
    };
    if ("IntersectionObserver" in root) {
      this.io = new root.IntersectionObserver((entries) => { self.visible = entries[entries.length - 1].isIntersecting; });
      this.io.observe(canvas);
    }
    // 先画一帧：即使创建时不在屏幕上，滚到这里也不会看到空白。
    this.draw();
    if (!this.reduce) this.raf = root.requestAnimationFrame(this._loop);
  }

  Orb.prototype.resize = function (size) {
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    this.size = Math.max(32, Math.round(size));
    this.c.width = this.size * dpr;
    this.c.height = this.size * dpr;
    this.c.style.width = `${this.size}px`;
    this.c.style.height = `${this.size}px`;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.reduce) this.draw();
  };
  Orb.prototype.setState = function (state) {
    if (!COLORS[state] || state === this.state) return;
    this.state = state;
    if (this.reduce) this.draw();
  };
  Orb.prototype.setLevel = function (value) { this.level = Math.max(0, Math.min(1, value || 0)); };
  Orb.prototype.destroy = function () { this.stopped = true; root.cancelAnimationFrame(this.raf); if (this.io) this.io.disconnect(); };

  Orb.prototype.draw = function () {
    const g = this.g;
    const S = this.size;
    const cx = S / 2;
    const cy = S / 2;
    const st = this.state;
    const col = COLORS[st];
    const t = this.reduce ? 0 : this.t;
    const target = st === "listening" || st === "speaking" ? this.level : st === "thinking" ? 0.1 : st === "idle" ? 0.06 : 0.04;
    this.smooth += (target - this.smooth) * (this.reduce ? 1 : 0.18);
    const lv = this.reduce ? 0 : this.smooth;
    const base = S * 0.24;
    g.clearRect(0, 0, S, S);

    // 外环：思考时是转动的虚线
    g.lineWidth = Math.max(1, S / 160);
    g.strokeStyle = "rgba(133, 118, 106, .55)";
    if (st === "thinking") { g.setLineDash([3, 9]); g.lineDashOffset = -t * 18; } else g.setLineDash([]);
    g.beginPath(); g.arc(cx, cy, S * 0.46, 0, TAU); g.stroke(); g.setLineDash([]);

    // 三层有机形体
    const layers = [{ k: 5, a: 0.55, p: 0, s: 0.9 }, { k: 4, a: 0.38, p: 2.1, s: 1.15 }, { k: 6, a: 0.28, p: 4.3, s: 0.7 }];
    layers.forEach((L, i) => {
      const amp = base * (st === "error" ? 0.025 : 0.03 + lv * 0.2) * (1 + i * 0.12);
      const speed = st === "thinking" ? 0.6 : st === "error" ? 6 : 1;
      const grow = 1 + (st === "listening" ? lv * 0.35 : 0) + (st === "speaking" ? lv * 0.25 : 0) + (st === "idle" ? Math.sin(t * 0.9) * 0.035 : 0);
      g.beginPath();
      for (let a = 0; a <= TAU + 0.08; a += 0.08) {
        const r = base * grow + amp * Math.sin(L.k * a + t * L.s * 1.6 * speed + L.p) + amp * 0.5 * Math.sin((L.k + 2) * a - t * L.s * 1.1 * speed);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      g.globalAlpha = L.a;
      g.fillStyle = i === 0 ? col[0] : col[1];
      g.fill();
      g.globalAlpha = 1;
    });

    // 中心核
    g.beginPath(); g.arc(cx, cy, base * 0.52, 0, TAU);
    g.globalAlpha = 0.94; g.fillStyle = col[0]; g.fill(); g.globalAlpha = 1;

    // 中心符号（形状冗余）
    const u = base / 46;
    g.strokeStyle = "#FFFFFF"; g.fillStyle = "#FFFFFF"; g.lineWidth = Math.max(1.6, 2.4 * u); g.lineCap = "round";
    if (st === "thinking") {
      for (let d = 0; d < 3; d += 1) {
        const ph = this.reduce ? 0.4 : Math.max(0, Math.sin(t * 4 - d * 0.9));
        g.beginPath(); g.arc(cx + (d - 1) * 14 * u, cy - ph * 4 * u, (3.2 + ph) * u, 0, TAU); g.fill();
      }
    } else if (st === "error") {
      g.beginPath(); g.moveTo(cx, cy - 11 * u); g.lineTo(cx, cy + 2 * u); g.stroke();
      g.beginPath(); g.arc(cx, cy + 10 * u, 1.8 * u, 0, TAU); g.fill();
    } else if (st === "speaking") {
      for (let b = -2; b <= 2; b += 1) {
        const h = (6 + (this.reduce ? 6 : Math.abs(Math.sin(t * 7 + b * 1.3)) * (8 + lv * 18))) * u;
        g.beginPath(); g.moveTo(cx + b * 9 * u, cy - h / 2); g.lineTo(cx + b * 9 * u, cy + h / 2); g.stroke();
      }
    } else if (st === "listening") {
      g.beginPath();
      if (g.roundRect) g.roundRect(cx - 6 * u, cy - 14 * u, 12 * u, 20 * u, 6 * u); else g.rect(cx - 6 * u, cy - 14 * u, 12 * u, 20 * u);
      g.stroke();
      g.beginPath(); g.arc(cx, cy - u, 12 * u, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
      g.beginPath(); g.moveTo(cx, cy + 11 * u); g.lineTo(cx, cy + 16 * u); g.stroke();
    } else {
      g.beginPath(); g.arc(cx, cy, 5 * u, 0, TAU); g.fill();
    }
  };

  root.QMOrb = Orb;
})(window);
