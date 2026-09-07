(function (SJ) {
  'use strict';

  // ── 特效粒子 ──────────────────────────────────────────────────
  //
  // draw(g)       世界坐标（场景在 camera 变换里调）
  // drawScreen(g) 屏幕坐标（Game 在 camera 外调）
  // 粒子的 screen 标志决定它进哪一层。伤害数字默认世界，
  //「悟」和招名默认屏幕。
  //
  // 颜色一律默认焦墨。朱砂是奢侈品，要用得显式传 color。

  var FX = SJ.FX = {};
  var MAX = 600, ps = [], TAU = Math.PI * 2;

  FX.list = ps;

  function push(o) {
    if (ps.length >= MAX) ps.shift();     // 超上限丢最老的
    o.age = 0;
    if (o.life == null) o.life = 0.5;
    ps.push(o);
    return o;
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  // ── 通用迸发 ──────────────────────────────────────────────────
  FX.burst = function (x, y, o) {
    o = o || {};
    var n = o.n || 8,
      color = o.color || SJ.C.ink,
      speed = o.speed != null ? o.speed : 220,
      spread = o.spread != null ? o.spread : TAU,
      ang = o.angle != null ? o.angle : 0,
      life = o.life != null ? o.life : 0.5,
      size = o.size != null ? o.size : 3,
      grav = o.gravity != null ? o.gravity : 900,
      drag = o.drag != null ? o.drag : 1.6,
      i, a, sp;
    for (i = 0; i < n; i++) {
      a = ang + (Math.random() - 0.5) * spread;
      sp = speed * rnd(0.45, 1.15);
      push({
        k: 'dot', x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: size * rnd(0.5, 1.25), color: color,
        life: life * rnd(0.7, 1.3), grav: grav, drag: drag,
        seed: Math.random() * 1000, screen: !!o.screen, alpha: o.alpha != null ? o.alpha : 1
      });
    }
  };

  // ── 命中墨溅 ──────────────────────────────────────────────────
  // 飞出去 → 落地 → 晕开成一个不规则墨点，留 2s 再淡出
  FX.splash = function (x, y, dir, o) {
    o = o || {};
    var n = o.n || 6,
      color = o.color || SJ.C.ink,          // 默认焦墨，朱砂要显式传
      speed = o.speed != null ? o.speed : 260,
      spread = o.spread != null ? o.spread : 1.5,
      base = (dir == null ? -Math.PI / 2 : dir),
      i, a, sp;
    for (i = 0; i < n; i++) {
      a = base + (Math.random() - 0.5) * spread;
      sp = speed * rnd(0.35, 1.25);
      push({
        k: 'drop', x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rnd(20, 90),
        r: rnd(1.6, 4.2), color: color,
        // 给了地面就别让通用的寿命检查在半空把它删掉，
        // 要一直飞到地面才晕开（update 里有 1.5s 保险丝）
        life: o.groundY != null ? 1.6 : rnd(0.18, 0.42),
        grav: o.gravity != null ? o.gravity : 1500,
        drag: 1.1, seed: Math.random() * 1000,
        groundY: o.groundY,                 // 给了就落到这条线上
        stain: o.stain !== false, screen: false, alpha: 1
      });
    }
  };

  // ── 挥毫弧线 ──────────────────────────────────────────────────
  FX.slash = function (x, y, a0, a1, r, o) {
    o = o || {};
    return push({
      k: 'slash', x: x, y: y, a0: a0, a1: a1, r: r,
      w: o.w != null ? o.w : 13,
      color: o.color || SJ.C.ink,           // 默认焦墨
      life: o.life != null ? o.life : 0.12, // 0.12s 内消散
      alpha: o.alpha != null ? o.alpha : 0.92,
      seed: Math.random() * 1000, screen: !!o.screen
    });
  };

  FX.ring = function (x, y, o) {
    o = o || {};
    return push({
      k: 'ring', x: x, y: y,
      r0: o.r0 != null ? o.r0 : 6,
      r1: o.r1 != null ? o.r1 : 54,
      w: o.w != null ? o.w : 4,
      color: o.color || SJ.C.ink,
      life: o.life != null ? o.life : 0.28,
      alpha: o.alpha != null ? o.alpha : 0.78,
      seed: Math.random() * 1000, screen: !!o.screen
    });
  };

  // ── 残影 ──────────────────────────────────────────────────────
  // 优先读 ent.figOpts（实体每帧传给 Figure.draw 的那个对象），
  // 没有就读 ent 上的同名字段。存的是姿势快照，不是引用。
  FX.trail = function (ent, o) {
    o = o || {};
    var s = ent.figOpts || ent;
    return push({
      k: 'trail',
      x: s.x, y: s.y,
      facing: s.facing || 1,
      scale: s.scale != null ? s.scale : 1,
      // pose 若是对象必须深拷贝：F 的 boss 用 blend() 产出对象并可能逐帧原地改写，
      // 存引用的话所有残影都会跟着变成当前姿势。blend(x,x,0) 正好是一次深拷贝。
      pose: (s.pose && typeof s.pose === 'object') ? SJ.Figure.blend(s.pose, s.pose, 0) : s.pose,
      p: s.p || 0, t: s.t || 0,
      weapon: s.weapon, cloth: s.cloth,
      color: o.color || SJ.C.ink,
      life: o.life != null ? o.life : 0.26,
      alpha: o.alpha != null ? o.alpha : 0.38,
      screen: false
    });
  };

  // ── 浮字 ──────────────────────────────────────────────────────
  FX.word = function (x, y, str, o) {
    o = o || {};
    return push({
      k: 'word', x: x, y: y, s: String(str),
      size: o.size != null ? o.size : 18,
      color: o.color || SJ.C.ink,
      vy: o.vy != null ? o.vy : -34,
      vertical: !!o.vertical,
      life: o.life != null ? o.life : 0.9,
      alpha: o.alpha != null ? o.alpha : 1,
      hold: o.hold != null ? o.hold : 0.25,   // 前段不淡出，先站住
      seed: Math.random() * 1000,
      screen: o.screen != null ? !!o.screen : false
    });
  };

  FX.dust = function (x, y, dir) {
    var i, a, sp;
    for (i = 0; i < 5; i++) {
      a = (dir == null ? 0 : dir) + (Math.random() - 0.5) * 1.1 - Math.PI * 0.5 * 0.35;
      sp = rnd(30, 95);
      push({
        k: 'dust', x: x + rnd(-4, 4), y: y,
        vx: Math.cos(a) * sp * (dir == null ? rnd(-1, 1) : 1), vy: -Math.abs(Math.sin(a)) * sp * 0.5,
        r: rnd(3, 8), color: SJ.C.inkLight,
        life: rnd(0.3, 0.6), grav: -20, drag: 2.6,
        seed: Math.random() * 1000, screen: false, alpha: 0.30
      });
    }
  };

  // kind: 'bamboo' | 'snow' | 'paper'
  FX.leaf = function (x, y, n, kind) {
    var i, col = kind === 'snow' ? SJ.C.paper : SJ.C.ink,
      al = kind === 'snow' ? 0.85 : kind === 'paper' ? 0.5 : 0.7;
    for (i = 0; i < (n || 4); i++) {
      push({
        k: 'leaf', kind: kind || 'bamboo',
        x: x + rnd(-10, 10), y: y + rnd(-8, 8),
        vx: rnd(-40, 40), vy: rnd(-30, 20),
        r: rnd(7, 16), color: col, alpha: al,
        rot: Math.random() * TAU, vr: rnd(-2.2, 2.2),
        life: rnd(0.9, 2.0), grav: kind === 'snow' ? 26 : 66, drag: 1.5,
        seed: Math.random() * 1000, screen: false
      });
    }
  };

  // ── 更新 ──────────────────────────────────────────────────────
  FX.update = function (dt) {
    var i, p, d;
    for (i = ps.length - 1; i >= 0; i--) {
      p = ps[i];
      p.age += dt;

      if (p.k === 'dot' || p.k === 'drop' || p.k === 'dust' || p.k === 'leaf') {
        d = Math.exp(-(p.drag || 0) * dt);
        p.vx *= d; p.vy *= d;
        p.vy += (p.grav || 0) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.rot != null) p.rot += (p.vr || 0) * dt;
        // 墨滴落地 → 晕开成留在地上的墨点
        if (p.k === 'drop') {
          var hitGround = p.groundY != null && p.y >= p.groundY;
          // 有地面就飞到地面再晕开（1.5s 保险丝）；没有地面就原地溅在什么东西上
          if (hitGround || (p.groundY == null && p.age >= p.life) || p.age > 1.5) {
            if (p.stain) {
              p.k = 'stain';
              if (hitGround) p.y = p.groundY;
              p.age = 0; p.life = 2.0;      // 留 2s
              p.r *= 1.35;
            } else { ps.splice(i, 1); continue; }
          }
        }
      }

      if (p.age >= p.life) ps.splice(i, 1);
    }
  };

  // ── 绘制 ──────────────────────────────────────────────────────

  function one(g, p) {
    var u = p.age / p.life, a, r, w, ang;

    switch (p.k) {

      case 'dot':
        g.globalAlpha = p.alpha * (1 - u * u);
        SJ.Ink.blob(g, p.x, p.y, p.r * (1 - u * 0.35), p.seed, {
          color: p.color, alpha: 1, bleed: false, rough: 0.3
        });
        break;

      case 'drop':
        g.globalAlpha = p.alpha;
        SJ.Ink.blob(g, p.x, p.y, p.r, p.seed, { color: p.color, alpha: 1, bleed: false, rough: 0.28 });
        break;

      case 'stain':
        // 落地后先晕开，最后 35% 才淡出
        r = p.r * (1 + Math.min(1, p.age / 0.22) * 0.55);
        g.globalAlpha = p.alpha * (u < 0.65 ? 1 : 1 - (u - 0.65) / 0.35);
        SJ.Ink.blob(g, p.x, p.y, r, p.seed, {
          color: p.color, alpha: 1, rough: 0.36, squash: 0.55
        });
        break;

      case 'slash':
        // 前 35% 扫出来，之后整条由粗到细散掉
        a = Math.min(1, p.age / (p.life * 0.35));
        w = p.w * (1 - u * 0.72);
        g.globalAlpha = 1;
        SJ.Ink.arcStroke(g, p.x, p.y, p.r, p.a0, p.a0 + (p.a1 - p.a0) * a, Math.max(0.4, w), {
          color: p.color, alpha: p.alpha * (1 - u * u * u), seed: p.seed, hairs: 4
        });
        break;

      case 'ring':
        r = SJ.lerp(p.r0, p.r1, 1 - Math.pow(1 - u, 3));
        g.globalAlpha = 1;
        SJ.Ink.arcStroke(g, p.x, p.y, r, 0, TAU, Math.max(0.4, p.w * (1 - u)), {
          color: p.color, alpha: p.alpha * Math.pow(1 - u, 1.5), seed: p.seed, taper: false, hairs: 0
        });
        break;

      case 'trail':
        SJ.Figure.draw(g, {
          x: p.x, y: p.y, facing: p.facing, scale: p.scale,
          pose: p.pose, p: p.p, t: p.t, weapon: p.weapon,
          cloth: p.cloth, color: p.color,
          alpha: p.alpha * (1 - u), ribbon: false
        });
        break;

      case 'word':
        g.globalAlpha = 1;
        var fade = u < p.hold ? 1 : 1 - (u - p.hold) / (1 - p.hold),
          ry = p.y + p.vy * p.age * (1 - u * 0.45),
          pop = 1 + Math.max(0, 1 - p.age / 0.09) * 0.28;   // 冒出来时轻微放大
        g.save();
        g.translate(p.x, ry); g.scale(pop, pop);
        if (p.vertical) {
          SJ.Ink.vtext(g, p.s, 0, 0, p.size, { color: p.color, alpha: p.alpha * fade, seed: p.seed });
        } else {
          SJ.Ink.htext(g, p.s, 0, 0, p.size, { color: p.color, alpha: p.alpha * fade, seed: p.seed });
        }
        g.restore();
        break;

      case 'dust':
        g.globalAlpha = p.alpha * (1 - u) * 0.8;
        SJ.Ink.blob(g, p.x, p.y, p.r * (1 + u * 0.9), p.seed, {
          color: p.color, alpha: 1, bleed: false, rough: 0.42
        });
        break;

      case 'leaf':
        g.globalAlpha = p.alpha * (u > 0.7 ? (1 - u) / 0.3 : 1);
        ang = p.rot;
        if (p.kind === 'snow') {
          g.fillStyle = p.color;
          g.beginPath(); g.arc(p.x, p.y, p.r * 0.28, 0, TAU); g.fill();
        } else if (p.kind === 'paper') {
          g.fillStyle = p.color;
          g.save(); g.translate(p.x, p.y); g.rotate(ang);
          g.fillRect(-p.r * 0.45, -p.r * 0.32, p.r * 0.9, p.r * 0.64);
          g.restore();
        } else {
          // 竹叶：一小笔
          SJ.Ink.stroke(g, [
            [p.x - Math.cos(ang) * p.r * 0.8, p.y - Math.sin(ang) * p.r * 0.8],
            [p.x + Math.cos(ang) * p.r * 0.2, p.y + Math.sin(ang) * p.r * 0.2 - p.r * 0.22],
            [p.x + Math.cos(ang) * p.r * 0.8, p.y + Math.sin(ang) * p.r * 0.8]
          ], { w0: p.r * 0.34, w1: 0.3, color: p.color, alpha: 1, seed: p.seed, hairs: 0, core: false });
        }
        break;
    }
  }

  function render(g, wantScreen) {
    var i, p;
    g.save();
    for (i = 0; i < ps.length; i++) {
      p = ps[i];
      if (!!p.screen !== wantScreen) continue;
      one(g, p);
    }
    g.restore();
  }

  FX.draw = function (g) { render(g, false); };
  FX.drawScreen = function (g) { render(g, true); };
  FX.clear = function () { ps.length = 0; };
  FX.count = function () { return ps.length; };

})(window.SJ = window.SJ || {});
