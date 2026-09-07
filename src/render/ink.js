(function (SJ) {
  'use strict';

  // ── 水墨绘制原语 ────────────────────────────────────────────────
  // 全部是纯函数，不持有游戏状态。所有随机取自 SJ.hash / SJ.noise，
  // 同一 seed 每帧必须画出完全相同的结果（不许闪烁）。
  //
  // 依赖 src/core/const.js: SJ.C SJ.FONT SJ.noise SJ.hash SJ.lerp SJ.clamp SJ.ease

  var Ink = SJ.Ink = {};

  var TAU = Math.PI * 2;

  // ── 内部工具 ──────────────────────────────────────────────────

  // 把 [[x,y],..] / [{x,y},..] 统一成 {x,y} 数组
  function norm(pts) {
    var a = [], i, p;
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      if (p == null) continue;
      a.push(p.length ? { x: p[0], y: p[1] } : { x: p.x, y: p.y });
    }
    return a;
  }

  // Catmull-Rom 取点（端点复制，短路径也安全）
  function cr(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return {
      x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
    };
  }

  // 把控制点细分成密采样折线。采样密度随长度自适应，
  // 但所有形状量（宽度/抖动）都是归一化 t 的函数，所以密度变化不会抖。
  // sharp=true 时用折线插值，不做样条 —— 这样一条路径能一笔画完整条肢体
  // （只有一次填充，关节不会叠出黑盘），而膝、肘的折角又不会被磨圆。
  function resample(pts, sharp) {
    var n = pts.length, out = [], i, j, sub, segLen, a, b, p0, p3;
    if (n < 2) return pts.slice();
    for (i = 0; i < n - 1; i++) {
      a = pts[i]; b = pts[i + 1];
      segLen = Math.hypot(b.x - a.x, b.y - a.y);
      sub = Math.max(2, Math.min(10, Math.round(segLen / 8)));
      if (sharp) {
        for (j = 0; j < sub; j++) {
          out.push({ x: a.x + (b.x - a.x) * j / sub, y: a.y + (b.y - a.y) * j / sub });
        }
      } else {
        p0 = pts[i - 1] || a; p3 = pts[i + 2] || b;
        for (j = 0; j < sub; j++) out.push(cr(p0, a, b, p3, j / sub));
      }
    }
    out.push(pts[n - 1]);
    return out;
  }

  function pathLen(p) {
    var L = 0, i;
    for (i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    return L;
  }

  function ss(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }

  // 毛笔宽度曲线。t 0..1 沿路径归一化位置。
  //   起笔：落纸有一点钝头，随即按压鼓起（顿）
  //   行笔：保持 w0 到 28%，再平滑收到 w1（到 85%）——毛笔是「先扛住再放」，
  //         过早变细会变成一根矢量长矛
  //   收笔：最后 12% 收到 w1 的两成，剩下的交给飞白细丝去散
  // tailK 0..1 —— 收笔强度，短笔画自动减弱，免得小墨点长出长尾巴
  function brushW(t, w0, w1, tailK, press) {
    var w = w0 + (w1 - w0) * ss((t - 0.28) / 0.57);
    w *= 1 + press * Math.exp(-(t * t) / 0.0056);   // 起笔顿
    w *= 0.72 + 0.28 * ss(t / 0.045);               // 落纸钝头
    if (tailK > 0 && t > 0.88) w *= 1 - Math.pow((t - 0.88) / 0.12, 1.4) * tailK;
    return w > 0.10 ? w : 0.10;
  }

  // 把中心线 + 宽度展开成左右两侧点，填成一个多边形
  // caps: 0 不加端帽 / 1 只加起笔 / 2 两端都加
  function ribbon(g, sp, wf, jitterAmp, seed, caps) {
    var n = sp.length, i, t, tx, ty, L, w, cx, cy, off,
      left = [], right = [], a, b, sx = 0, sy = 0, ex = 0, ey = 0;
    for (i = 0; i < n; i++) {
      t = n > 1 ? i / (n - 1) : 0;
      a = sp[Math.max(0, i - 1)];
      b = sp[Math.min(n - 1, i + 1)];
      tx = b.x - a.x; ty = b.y - a.y;
      L = Math.hypot(tx, ty) || 1;
      tx /= L; ty /= L;
      w = wf(t) * 0.5;
      cx = sp[i].x; cy = sp[i].y;
      if (jitterAmp) {
        // 抖动键在归一化 t 上 —— 长度变化时不会重新洗牌
        off = SJ.noise(seed + t * 3.1) * jitterAmp;
        cx += -ty * off; cy += tx * off;
      }
      left.push(cx - ty * w, cy + tx * w);
      right.push(cx + ty * w, cy - tx * w);
      if (i === 0) { sx = cx; sy = cy; }
      if (i === n - 1) { ex = cx; ey = cy; }
    }
    g.beginPath();
    g.moveTo(left[0], left[1]);
    for (i = 1; i < n; i++) g.lineTo(left[i * 2], left[i * 2 + 1]);
    for (i = n - 1; i >= 0; i--) g.lineTo(right[i * 2], right[i * 2 + 1]);
    g.closePath();
    g.fill();
    if (caps) {
      w = wf(0) * 0.5;
      if (w > 0.35) { g.beginPath(); g.arc(sx, sy, w, 0, TAU); g.fill(); }
      if (caps === 2) {
        w = wf(1) * 0.5;
        if (w > 0.35) { g.beginPath(); g.arc(ex, ey, w, 0, TAU); g.fill(); }
      }
    }
  }

  // 沿采样线取归一化 t 处的点与切向
  function at(sp, t) {
    var n = sp.length, f = t * (n - 1), i = Math.floor(f), k = f - i, a, b;
    i = i < 0 ? 0 : (i > n - 2 ? n - 2 : i);
    a = sp[i]; b = sp[i + 1];
    var tx = b.x - a.x, ty = b.y - a.y, L = Math.hypot(tx, ty) || 1;
    return { x: a.x + tx * k, y: a.y + ty * k, tx: tx / L, ty: ty / L };
  }

  // ── SJ.Ink.stroke ─────────────────────────────────────────────
  // 核心毛笔线。o = {w0,w1,color,alpha,taper,wobble,seed,press,hairs,core}
  Ink.stroke = function (g, pts, o) {
    o = o || {};
    var p = norm(pts);
    if (p.length === 0) return;

    var w0 = o.w0 != null ? o.w0 : (o.w != null ? o.w : 3),
      w1 = o.w1 != null ? o.w1 : w0 * 0.55,
      color = o.color || SJ.C.ink,
      alpha = o.alpha != null ? o.alpha : 1,
      taper = o.taper !== false,
      wobble = o.wobble || 0,
      seed = o.seed || 0,
      press = o.press != null ? o.press : 0.30,
      hairs = o.hairs != null ? o.hairs : 3;

    if (alpha <= 0) return;

    // 单点 → 一个墨点
    if (p.length === 1) {
      g.save(); g.globalAlpha = alpha; g.fillStyle = color;
      g.beginPath(); g.arc(p[0].x, p[0].y, w0 * 0.5, 0, TAU); g.fill();
      g.restore();
      return;
    }

    var sp = resample(p, o.sharp), L = pathLen(sp);
    if (L < 0.4) {
      g.save(); g.globalAlpha = alpha; g.fillStyle = color;
      g.beginPath(); g.arc(p[0].x, p[0].y, w0 * 0.5, 0, TAU); g.fill();
      g.restore();
      return;
    }

    // 短笔画不该长出长尾巴 —— 收笔强度随长度衰减
    var tailK = taper ? 0.82 * Math.min(1, Math.max(0.30, L / 26)) : 0;

    // 边缘的不规则：两个八度的极轻噪声，让线不像矢量图
    var wf = function (t) {
      return brushW(t, w0, w1, tailK, press) *
        (1 + SJ.noise(seed + 41.7 + t * 11) * 0.085 + SJ.noise(seed + 7.3 + t * 27) * 0.045);
    };

    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = color;

    if (o.soft) {
      // 羽化边：由宽到窄叠三层，给远景大笔触一个化开的边缘
      var sN = 3, si, sk;
      for (si = 0; si < sN; si++) {
        sk = 1 + (sN - si) * 0.26 * o.soft;
        g.globalAlpha = alpha * (0.30 + si * 0.30);
        ribbon(g, sp, (function (m) {
          return function (t) { return wf(t) * m; };
        })(sk), wobble, seed, taper ? 1 : 2);
      }
      g.globalAlpha = alpha;
    } else {
      ribbon(g, sp, wf, wobble, seed, taper ? 1 : 2);
    }

    // 湿墨芯：只在浓墨粗笔上压一道，做出墨色厚度。
    // 淡墨大笔触（远山）不能加，否则会变成一根有边线的管子。
    if (o.core !== false && w0 > 3.5 && alpha >= 0.55) {
      g.globalAlpha = alpha * 0.26;
      ribbon(g, sp, function (t) { return wf(t) * 0.40; }, wobble, seed, taper ? 1 : 2);
      g.globalAlpha = alpha;
    }

    // 飞白：笔尖散开的几缕细丝。必须短、必须贴着笔画自己的走向，
    // 否则弧线上会散成一把扫帚。
    if (tailK > 0 && hairs > 0 && L > 14 && w0 >= 2.2) {
      var hl = Math.min(L * 0.18, w0 * 2.8), i, k, s0, spread, hw, e, dx, dy;
      for (i = 0; i < hairs; i++) {
        k = SJ.hash(seed * 7.13 + i * 3.7);
        s0 = 0.78 + k * 0.10;                        // 只从笔尖附近分叉
        spread = (i - (hairs - 1) / 2) * (0.34 + k * 0.42) * Math.max(1, w0 * 0.16);
        e = at(sp, s0);
        hw = Math.max(0.50, brushW(s0, w0, w1, 0, press) * (0.28 + k * 0.24));
        // 沿该点自身切向延出，只带很小的横向散开
        dx = e.tx * hl * (0.75 + k * 0.55);
        dy = e.ty * hl * (0.75 + k * 0.55);
        g.globalAlpha = alpha * (0.34 + k * 0.30);
        ribbon(g, resample([
          { x: e.x, y: e.y },
          { x: e.x + dx * 0.5 - e.ty * spread * 0.4, y: e.y + dy * 0.5 + e.tx * spread * 0.4 },
          { x: e.x + dx - e.ty * spread, y: e.y + dy + e.tx * spread }
        ]), function (t) { return hw * (1 - t * t * 0.97); }, 0, seed + i);
      }
    }

    g.restore();
  };

  Ink.line = function (g, x1, y1, x2, y2, w, o) {
    o = o || {};
    Ink.stroke(g, [[x1, y1], [x2, y2]], {
      w0: o.w0 != null ? o.w0 : w,
      w1: o.w1 != null ? o.w1 : w * 0.5,
      color: o.color, alpha: o.alpha, taper: o.taper, wobble: o.wobble,
      seed: o.seed, press: o.press, hairs: o.hairs, core: o.core
    });
  };

  Ink.arcStroke = function (g, cx, cy, r, a0, a1, w, o) {
    o = o || {};
    var n = Math.max(4, Math.min(28, Math.round(Math.abs(a1 - a0) * r / 7))),
      pts = [], i, a;
    for (i = 0; i <= n; i++) {
      a = a0 + (a1 - a0) * (i / n);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    Ink.stroke(g, pts, {
      w0: o.w0 != null ? o.w0 : w,
      w1: o.w1 != null ? o.w1 : w * 0.16,
      color: o.color, alpha: o.alpha,
      taper: o.taper !== false, wobble: o.wobble, seed: o.seed,
      press: o.press != null ? o.press : 0.12,
      hairs: o.hairs != null ? o.hairs : 3, core: o.core
    });
  };


  // ── 纸 ────────────────────────────────────────────────────────
  // 噪点预渲染到离屏 tile 后平铺；绝不每帧逐像素画。
  var paperTile = null, TILE = 128;

  function buildPaperTile() {
    var c = document.createElement('canvas'), x = c.getContext('2d'), i, n, d, v;
    c.width = c.height = TILE;
    x.fillStyle = SJ.C.paper; x.fillRect(0, 0, TILE, TILE);
    d = x.getImageData(0, 0, TILE, TILE); n = d.data;
    for (i = 0; i < n.length; i += 4) {
      // 3% 幅度的纸纹；用确定性 hash，每次加载完全一样
      v = (SJ.hash(i * 0.37 + 5.1) - 0.5) * 15;
      n[i] += v; n[i + 1] += v * 0.96; n[i + 2] += v * 0.84;
    }
    x.putImageData(d, 0, 0);
    // 注意：这里绝不能画横向「纸纤维」。tile 只有 128px，
    // 任何有方向的纹理都会平铺成整屏的横格线，像作业本。
    // 纸感全部交给上面的逐像素噪点。
    paperTile = c;
    return c;
  }

  var paperPat = null;
  Ink.paper = function (g, camX, camY) {
    var W = SJ.W, H = SJ.H, ox, oy;
    if (!paperTile) buildPaperTile();
    if (!paperPat) paperPat = g.createPattern(paperTile, 'repeat');
    // 视差极小，并且量化到整数像素 —— 否则纸纹会「爬」
    ox = ((-Math.round((camX || 0) * 0.04)) % TILE + TILE) % TILE;
    oy = ((-Math.round((camY || 0) * 0.04)) % TILE + TILE) % TILE;
    g.save();
    g.fillStyle = paperPat;
    g.translate(ox - TILE, oy - TILE);
    g.fillRect(0, 0, W + TILE * 2, H + TILE * 2);
    g.restore();

    // 四角做旧晕染：淡到几乎看不见
    var corners = [[0, 0], [W, 0], [0, H], [W, H]], i, c, gr;
    g.save();
    for (i = 0; i < 4; i++) {
      c = corners[i];
      gr = g.createRadialGradient(c[0], c[1], 0, c[0], c[1], H * 0.62);
      gr.addColorStop(0, 'rgba(150,128,92,0.075)');
      gr.addColorStop(0.55, 'rgba(150,128,92,0.022)');
      gr.addColorStop(1, 'rgba(150,128,92,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    g.restore();
  };

  // ── 墨团 / 飞溅 / 淡墨 ─────────────────────────────────────────

  // 1D 噪声做闭合形状会在 0/2π 处留缝，这里首尾交叉淡化掉
  function ringNoise(seed, a, k) {
    var t = a / TAU;
    return SJ.lerp(SJ.noise(seed + a * k), SJ.noise(seed + (a - TAU) * k), t);
  }

  function blobPath(g, x, y, r, seed, rough, squash) {
    var N = 26, i, a, rr, px, py, pts = [];
    for (i = 0; i < N; i++) {
      a = i / N * TAU;
      rr = r * (1 + ringNoise(seed, a, 1.7) * rough + ringNoise(seed + 31, a, 3.9) * rough * 0.45);
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * (squash || 1)]);
    }
    g.beginPath();
    var m = [(pts[N - 1][0] + pts[0][0]) / 2, (pts[N - 1][1] + pts[0][1]) / 2];
    g.moveTo(m[0], m[1]);
    for (i = 0; i < N; i++) {
      px = pts[i]; py = pts[(i + 1) % N];
      g.quadraticCurveTo(px[0], px[1], (px[0] + py[0]) / 2, (px[1] + py[1]) / 2);
    }
    g.closePath();
  }

  Ink.blob = function (g, x, y, r, seed, o) {
    o = o || {};
    var alpha = o.alpha != null ? o.alpha : 1;
    if (alpha <= 0 || r <= 0) return;
    g.save();
    g.fillStyle = o.color || SJ.C.ink;
    // 洇开的外圈
    if (o.bleed !== false) {
      g.globalAlpha = alpha * 0.16;
      blobPath(g, x, y, r * 1.16, seed + 5, (o.rough || 0.24) * 1.3, o.squash);
      g.fill();
    }
    g.globalAlpha = alpha;
    blobPath(g, x, y, r, seed, o.rough != null ? o.rough : 0.24, o.squash);
    g.fill();
    g.restore();
  };

  Ink.splat = function (g, x, y, r, seed, o) {
    o = o || {};
    var alpha = o.alpha != null ? o.alpha : 1,
      color = o.color || SJ.C.ink,
      n = o.n != null ? o.n : 6, i, k, k2, a, d, rr;
    if (alpha <= 0) return;
    Ink.blob(g, x, y, r, seed, { color: color, alpha: alpha, rough: 0.34 });
    g.save();
    g.fillStyle = color;
    for (i = 0; i < n; i++) {
      k = SJ.hash(seed * 3.1 + i * 7.7); k2 = SJ.hash(seed * 5.9 + i * 2.3);
      a = k * TAU;
      d = r * (1.3 + k2 * 2.4);
      rr = r * (0.10 + k2 * 0.26);
      g.globalAlpha = alpha * (0.55 + k * 0.45);
      blobPath(g, x + Math.cos(a) * d, y + Math.sin(a) * d, rr, seed + i * 13, 0.4);
      g.fill();
      // 细丝：主团甩向卫星点的一缕
      if (k2 > 0.55) {
        Ink.stroke(g, [[x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7],
        [x + Math.cos(a) * d * 0.85, y + Math.sin(a) * d * 0.85]],
          { w0: r * 0.24, w1: 0.3, color: color, alpha: alpha * 0.6, seed: seed + i, hairs: 0 });
      }
    }
    g.restore();
  };

  Ink.wash = function (g, x, y, w, h, o) {
    o = o || {};
    var color = o.color || SJ.C.ink,
      a0 = o.alpha != null ? o.alpha : 0.14,
      dir = o.dir || 'v', gr;
    gr = dir === 'v' ? g.createLinearGradient(x, y, x, y + h)
      : g.createLinearGradient(x, y, x + w, y);
    var c = hexA(color, a0), c0 = hexA(color, 0);
    if (o.both) { gr.addColorStop(0, c0); gr.addColorStop(0.5, c); gr.addColorStop(1, c0); }
    else if (o.flip) { gr.addColorStop(0, c0); gr.addColorStop(1, c); }
    else { gr.addColorStop(0, c); gr.addColorStop(1, c0); }
    g.save(); g.fillStyle = gr; g.fillRect(x, y, w, h); g.restore();
  };

  function hexA(hex, a) {
    if (hex.charAt(0) !== '#') return hex;
    var h = hex.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  Ink.rgba = hexA;

  // ── 视差层缓存 ────────────────────────────────────────────────
  // 远山与竹林每帧要画几百个笔触，逐帧重画到不了 60fps。
  // 这里把整层渲染到一张比屏幕宽 2*MARGIN 的离屏画布上，
  // 平时只做一次 drawImage；滚动超过 MARGIN*0.6 才重画一次。
  var layers = {}, MARGIN = 220;

  function layerBlit(g, key, ox, render) {
    var W = SJ.W, H = SJ.H, c = layers[key];
    if (!c) {
      c = layers[key] = { cv: document.createElement('canvas'), base: null };
      c.cv.width = W + MARGIN * 2; c.cv.height = H;
      c.g = c.cv.getContext('2d');
    }
    if (c.base === null || Math.abs(ox - c.base) > MARGIN * 0.6) {
      c.base = Math.round(ox);
      c.g.clearRect(0, 0, c.cv.width, c.cv.height);
      c.g.save(); c.g.translate(MARGIN, 0);
      render(c.g, c.base);
      c.g.restore();
    }
    g.drawImage(c.cv, -MARGIN - (ox - c.base), 0);
  }

  Ink.clearLayerCache = function () { layers = {}; };

  // ── 远景 ──────────────────────────────────────────────────────

  // band = 山脊往下渐隐的高度。远山绝不能填到屏幕底部：
  // 底下那片纸白就是构图的一半。
  var MT = [
    { par: 0.20, alpha: 0.205, amp: 58, base: 0.60, w: 5.0, band: 150 },
    { par: 0.12, alpha: 0.128, amp: 76, base: 0.54, w: 6.0, band: 195 },
    { par: 0.06, alpha: 0.078, amp: 94, base: 0.46, w: 7.0, band: 245 }
  ];

  Ink.mountains = function (g, camX, depth, o) {
    o = o || {};
    var d = MT[SJ.clamp(depth | 0, 0, 2)],
      W = SJ.W,
      ox = (camX || 0) * d.par,
      baseY = o.baseY != null ? o.baseY : SJ.H * d.base,
      alpha = o.alpha != null ? o.alpha : d.alpha,
      color = o.color || SJ.C.ink,
      seed = (o.seed || 0) + depth * 97.3,
      band = o.band != null ? o.band : d.band,
      step = 26;

    layerBlit(g, 'mt|' + depth + '|' + seed + '|' + baseY + '|' + alpha + '|' + band + '|' + color, ox, function (g, ox) {
      var i, x, wx, y, pts = [], top = 1e9, a, b;
      for (x = -MARGIN - step * 2; x <= W + MARGIN + step * 2; x += step) {
        wx = (x + ox) * 0.0042;
        y = baseY
          - (SJ.noise(seed + wx) * 0.62 + SJ.noise(seed + 11 + wx * 2.3) * 0.28
            + SJ.noise(seed + 23 + wx * 5.1) * 0.10) * d.amp
          - d.amp * 0.18;
        pts.push([x, y]);
        if (y < top) top = y;
      }

      g.save();
      // 山体：沿山脊向下一条带，用垂直渐变化开，底边完全透明
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (i = 1; i < pts.length; i++) {
        a = pts[i - 1]; b = pts[i];
        g.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
      for (i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][0], pts[i][1] + band);
      g.closePath();
      g.clip();
      var gr = g.createLinearGradient(0, top, 0, top + band);
      // 前三成不衰减，山体才有「块」的分量；再往下才化开
      gr.addColorStop(0, hexA(color, alpha));
      gr.addColorStop(0.30, hexA(color, alpha * 0.92));
      gr.addColorStop(0.62, hexA(color, alpha * 0.40));
      gr.addColorStop(1, hexA(color, 0));
      g.fillStyle = gr;
      g.fillRect(-MARGIN - step * 2, top - 4, W + MARGIN * 2 + step * 4, band + 8);
      g.restore();

      // 山脊：一道稍重的笔，给轮廓一点笔意（不要 soft，会糊成灰雾）
      Ink.stroke(g, pts, {
        w0: d.w, w1: d.w * 0.6, color: color,
        alpha: alpha * 0.55, taper: false, hairs: 0, seed: seed + 3, core: false
      });
    });
  };

  Ink.bamboo = function (g, camX, depth, o) {
    o = o || {};
    var d = SJ.clamp(depth | 0, 0, 2),
      par = [0.55, 0.34, 0.18][d],
      alpha = o.alpha != null ? o.alpha : [0.72, 0.40, 0.19][d],
      cw = [7.4, 5.0, 3.2][d],
      leafN = [3, 2, 1][d],          // 叶簇数
      leafLen = [36, 26, 17][d],
      W = SJ.W, H = SJ.H,
      ox = (camX || 0) * par,
      gap = o.gap || 132,
      seed = (o.seed || 0) + d * 53.1,
      baseY = o.baseY != null ? o.baseY : H + 12,
      hRef = o.h || H;

    layerBlit(g, 'bb|' + d + '|' + seed + '|' + baseY + '|' + hRef + '|' + gap + '|' + alpha, ox, function (g, ox) {
      var i0 = Math.floor((ox - MARGIN - 90) / gap), i1 = Math.ceil((ox + W + MARGIN + 90) / gap), i;
      g.save();
      for (i = i0; i <= i1; i++) {
        var k = SJ.hash(seed + i * 3.77),      // 位置抖动
          k2 = SJ.hash(seed + i * 9.13),       // 高度
          k3 = SJ.hash(seed + i * 1.31),       // 粗细
          k4 = SJ.hash(seed + i * 6.61),       // 倾斜
          x = i * gap + (k - 0.5) * gap * 0.8 - ox,
          // 高度差要拉得很开，否则一排等高竹子就是一道栅栏
          hgt = hRef * (0.34 + k2 * k2 * 0.72),
          top = baseY - hgt,
          lean = (k4 - 0.5) * 0.19 * hgt,
          w = cw * (0.60 + k3 * 0.80),
          aL = alpha * (0.72 + k3 * 0.42);

        // 竿：四点弧线，下粗上细
        var culm = [[x, baseY],
        [x + lean * 0.16, baseY - hgt * 0.34],
        [x + lean * 0.55, baseY - hgt * 0.72],
        [x + lean, top]];
        Ink.stroke(g, culm, {
          w0: w, w1: w * 0.42, color: SJ.C.ink, alpha: aL,
          taper: false, hairs: 0, seed: seed + i, wobble: 0.45, core: d === 0
        });

        // 沿竿取点（近似）
        function onCulm(t) {
          return { x: x + lean * (t * t * 0.55 + t * 0.45), y: baseY - hgt * t };
        }

        // 竹节
        var segs = 4 + Math.floor(k2 * 4), j, p2, nw;
        for (j = 1; j < segs; j++) {
          p2 = onCulm(j / segs);
          nw = w * (1 - j / segs * 0.5);
          Ink.stroke(g, [[p2.x - nw * 0.8, p2.y + nw * 0.12], [p2.x + nw * 0.8, p2.y]], {
            w0: nw * 0.46, w1: nw * 0.36, color: SJ.C.ink, alpha: aL * 0.9,
            taper: false, hairs: 0, seed: seed + i * 7 + j, core: false
          });
        }

        // 叶：成簇，只长在上半段。竹叶是下垂外张的，不是放射状。
        var c, ci, nLeaf, side, base, la, ll, pt, ctrl, tip, kk, kk2;
        for (c = 0; c < leafN; c++) {
          kk = SJ.hash(seed + i * 17.3 + c * 4.1);
          pt = onCulm(0.52 + kk * 0.46);
          side = SJ.hash(seed + i * 2.9 + c * 11.7) > 0.5 ? 1 : -1;
          nLeaf = 3 + Math.floor(SJ.hash(seed + i * 8.3 + c * 3.1) * 3);
          base = 0.30 + SJ.hash(seed + i * 4.7 + c * 6.9) * 0.42;   // 整体下垂
          var tBase = 0.52 + kk * 0.46, org;
          for (ci = 0; ci < nLeaf; ci++) {
            kk2 = SJ.hash(seed + i * 23.1 + c * 13.7 + ci * 5.9);
            // 叶子错开着生在一小截枝上，不是从同一点放射（否则是棕榈叶）
            org = onCulm(tBase + ci * 0.016 + kk2 * 0.008);
            la = base + (ci / Math.max(1, nLeaf - 1) - 0.5) * 0.82 + (kk2 - 0.5) * 0.18;
            ll = leafLen * (0.48 + kk2 * kk2 * 1.05);
            tip = { x: org.x + Math.cos(la) * ll * side, y: org.y + Math.sin(la) * ll };
            ctrl = {
              x: org.x + Math.cos(la) * ll * 0.52 * side,
              y: org.y + Math.sin(la) * ll * 0.52 - ll * 0.16
            };
            Ink.stroke(g, [[org.x, org.y], [ctrl.x, ctrl.y], [tip.x, tip.y]], {
              w0: w * 0.50, w1: 0.28, color: SJ.C.ink,
              alpha: aL * (0.78 + kk2 * 0.32),
              seed: seed + i * 31 + c * 7 + ci, hairs: d === 0 ? 2 : 0, core: false
            });
          }
        }
      }
      g.restore();
    });
  };

  Ink.pine = function (g, x, y, scale, seed) {
    var s = scale || 1, alpha = 0.72, i, k, k2, a, len, bx, by, j;
    seed = seed || 0;
    g.save();
    // 干：带两个折的曲线，上细下粗
    var tw = 7 * s,
      trunk = [[x, y], [x + SJ.noise(seed) * 8 * s, y - 26 * s],
      [x + SJ.noise(seed + 3) * 14 * s, y - 50 * s], [x + SJ.noise(seed + 6) * 18 * s, y - 70 * s]];
    Ink.stroke(g, trunk, {
      w0: tw, w1: tw * 0.32, color: SJ.C.ink, alpha: alpha,
      seed: seed, wobble: 0.8, hairs: 2
    });
    // 枝 + 松针团
    for (i = 0; i < 5; i++) {
      k = SJ.hash(seed * 2.7 + i * 5.3); k2 = SJ.hash(seed * 4.1 + i * 9.7);
      var ty = y - (28 + i * 12) * s;
      var dir = (i % 2 === 0) ? 1 : -1;
      len = (18 + k * 20) * s;
      bx = x + dir * len; by = ty - (4 + k2 * 12) * s;
      Ink.stroke(g, [[x + SJ.noise(seed + i) * 6 * s, ty],
      [x + dir * len * 0.55, ty - 3 * s], [bx, by]], {
        w0: 3.4 * s, w1: 0.6, color: SJ.C.ink, alpha: alpha * 0.9,
        seed: seed + i * 11, hairs: 2
      });
      // 针叶：从枝端放射的短线
      for (j = 0; j < 9; j++) {
        a = -Math.PI * 0.5 + (j / 8 - 0.5) * 2.5 + (SJ.hash(seed + i * 13 + j) - 0.5) * 0.4;
        var nl2 = (5 + SJ.hash(seed + i * 3 + j * 7) * 6) * s;
        Ink.stroke(g, [[bx, by], [bx + Math.cos(a) * nl2, by + Math.sin(a) * nl2]], {
          w0: 1.5 * s, w1: 0.25, color: SJ.C.ink, alpha: alpha * 0.66,
          seed: seed + i * 29 + j, hairs: 0, core: false
        });
      }
    }
    g.restore();
  };

  Ink.water = function (g, x, y, w, h, t, o) {
    o = o || {};
    var n = o.n || 7, i, j, k, yy, amp, ph, pts, len, color = o.color || SJ.C.stone,
      alpha = o.alpha != null ? o.alpha : 0.46;
    t = t || 0;
    g.save();
    for (i = 0; i < n; i++) {
      k = SJ.hash((o.seed || 0) + i * 6.13);
      yy = y + h * ((i + 0.5) / n) + SJ.noise(i * 2.1) * 4;
      amp = 1.6 + k * 3.2;
      ph = t * (0.35 + k * 0.5) + i * 1.7;
      len = w * (0.35 + k * 0.5);
      var sx = x + (w - len) * SJ.hash((o.seed || 0) + i * 11.7 + 3);
      pts = [];
      for (j = 0; j <= 9; j++) {
        pts.push([sx + len * (j / 9), yy + Math.sin(ph + j * 0.85) * amp]);
      }
      Ink.stroke(g, pts, {
        w0: 3.0 - i * 0.08, w1: 0.4, color: color,
        alpha: alpha * (0.55 + k * 0.6), seed: i * 3 + 1, hairs: 2, core: false
      });
    }
    g.restore();
  };

  // ── 天气 ──────────────────────────────────────────────────────

  Ink.rain = function (g, camX, t, intensity, wind) {
    intensity = intensity == null ? 1 : intensity;
    wind = wind == null ? -0.34 : wind;
    var W = SJ.W, H = SJ.H, n = Math.round(intensity * 62), i, k, k2, k3, x, y, len, sp2, wi;
    if (n <= 0) return;
    g.save();
    for (i = 0; i < n; i++) {
      k = SJ.hash(i * 1.37 + 0.5); k2 = SJ.hash(i * 4.71 + 9.1); k3 = SJ.hash(i * 8.09 + 2.7);
      sp2 = 560 + k2 * 620;
      wi = wind * (0.82 + k3 * 0.36);   // 每滴角度略有差别，避免整屏同一斜率
      // 视差：越快的雨越近
      x = ((k * W * 1.4 - (camX || 0) * (0.25 + k2 * 0.4) + t * sp2 * wind) % (W + 90) + W + 90) % (W + 90) - 45;
      y = ((k2 * H + t * sp2) % (H + 70)) - 35;
      len = 11 + k2 * k2 * 30;
      g.globalAlpha = (0.07 + k3 * k3 * 0.30) * intensity;
      Ink.stroke(g, [[x, y], [x + wi * len, y + len]], {
        w0: 0.9 + k2 * k2 * 1.7, w1: 0.25, color: SJ.C.ink,
        alpha: 1, seed: i, hairs: 0, core: false
      });
    }
    g.restore();
  };

  Ink.snow = function (g, camX, t, intensity, wind) {
    intensity = intensity == null ? 1 : intensity;
    wind = wind == null ? -0.22 : wind;
    var W = SJ.W, H = SJ.H, n = Math.round(intensity * 130), i, k, k2, x, y, r, sp2, sway;
    if (n <= 0) return;
    g.save();
    for (i = 0; i < n; i++) {
      k = SJ.hash(i * 2.11 + 1.7); k2 = SJ.hash(i * 5.33 + 4.3);
      sp2 = 42 + k2 * 78;
      sway = Math.sin(t * (0.7 + k * 1.1) + i) * (7 + k * 13);
      x = ((k * W * 1.3 - (camX || 0) * (0.18 + k2 * 0.35) + t * sp2 * wind * 3 + sway) % (W + 70) + W + 70) % (W + 70) - 35;
      y = ((k2 * H + t * sp2) % (H + 50)) - 25;
      r = 1.3 + k2 * 2.8;
      // 纸色雪点先压一圈极淡的石青，否则在米色纸上完全看不见
      g.globalAlpha = (0.16 + k * 0.20) * intensity;
      g.fillStyle = SJ.C.stone;
      g.beginPath(); g.arc(x, y, r * 1.5, 0, TAU); g.fill();
      g.globalAlpha = (0.55 + k * 0.45) * intensity;
      g.fillStyle = SJ.C.paper;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    g.restore();
  };

  // ── 灯 / 印 ───────────────────────────────────────────────────

  Ink.lantern = function (g, x, y, r, t) {
    t = t || 0;
    var br = 0.86 + Math.sin(t * 2.1) * 0.08 + Math.sin(t * 5.7) * 0.045, gr;
    g.save();
    // 光晕
    gr = g.createRadialGradient(x, y, 0, x, y, r * 4.6 * br);
    gr.addColorStop(0, hexA(SJ.C.gamboge, 0.42 * br));
    gr.addColorStop(0.32, hexA(SJ.C.gamboge, 0.15 * br));
    gr.addColorStop(1, hexA(SJ.C.gamboge, 0));
    g.fillStyle = gr;
    g.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
    // 灯身：竖长的灯笼，上下有墨色盖口
    g.globalAlpha = 0.9;
    g.fillStyle = hexA(SJ.C.gamboge, 0.5);
    blobPath(g, x, y, r, 7.3, 0.06, 1.30); g.fill();
    // 上下盖口
    Ink.stroke(g, [[x - r * 0.62, y - r * 1.24], [x + r * 0.62, y - r * 1.24]],
      { w0: 2.2, w1: 1.8, color: SJ.C.ink, alpha: 0.62, taper: false, hairs: 0, seed: 21, core: false });
    Ink.stroke(g, [[x - r * 0.55, y + r * 1.22], [x + r * 0.55, y + r * 1.22]],
      { w0: 2.0, w1: 1.6, color: SJ.C.ink, alpha: 0.58, taper: false, hairs: 0, seed: 22, core: false });
    // 竖骨
    Ink.stroke(g, [[x - r * 0.55, y - r * 1.1], [x - r * 0.72, y], [x - r * 0.5, y + r * 1.1]],
      { w0: 1.2, w1: 1.0, color: SJ.C.ink, alpha: 0.30, taper: false, hairs: 0, seed: 23, core: false });
    Ink.stroke(g, [[x + r * 0.55, y - r * 1.1], [x + r * 0.72, y], [x + r * 0.5, y + r * 1.1]],
      { w0: 1.2, w1: 1.0, color: SJ.C.ink, alpha: 0.30, taper: false, hairs: 0, seed: 24, core: false });
    Ink.stroke(g, [[x, y - r * 1.30], [x, y - r * 1.95]],
      { w0: 1.6, w1: 1, color: SJ.C.ink, alpha: 0.62, taper: false, hairs: 0, seed: 3, core: false });
    // 灯穗
    Ink.stroke(g, [[x, y + r * 1.24], [x + Math.sin(t * 1.6) * r * 0.3, y + r * 1.95]],
      { w0: 1.8, w1: 0.3, color: SJ.C.cinnabar, alpha: 0.62, seed: 4, hairs: 1, core: false });
    // 芯
    g.globalAlpha = 0.75 * br; g.fillStyle = SJ.C.gamboge;
    g.beginPath(); g.arc(x, y, r * 0.28, 0, TAU); g.fill();
    g.restore();
  };

  Ink.seal = function (g, x, y, size, text) {
    var i, n = (text || '印').length, cs;
    g.save();
    // 朱砂方印，边缘做出刻痕的不规则
    g.fillStyle = SJ.C.cinnabar;
    g.globalAlpha = 0.88;
    blobPath(g, x + size / 2, y + size / 2, size * 0.5, 19.7, 0.045);
    g.fill();
    // 斑驳：几点漏色
    g.globalAlpha = 0.5; g.fillStyle = SJ.C.paper;
    for (i = 0; i < 9; i++) {
      var k = SJ.hash(i * 7.1 + 2), k2 = SJ.hash(i * 3.3 + 8);
      g.beginPath();
      g.arc(x + k * size, y + k2 * size, size * (0.012 + k * 0.035), 0, TAU);
      g.fill();
    }
    // 字（阳文：纸色）
    g.globalAlpha = 1;
    g.fillStyle = SJ.C.paper;
    cs = n <= 2 ? size * 0.50 : size * 0.40;
    g.font = '600 ' + cs + 'px ' + SJ.FONT;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (n <= 2) {
      for (i = 0; i < n; i++) {
        g.fillText(text.charAt(i), x + size / 2, y + size * (n === 1 ? 0.5 : (i ? 0.735 : 0.275)));
      }
    } else {
      // 2×2 布局，右起竖读
      for (i = 0; i < Math.min(4, n); i++) {
        var col = i < 2 ? 1 : 0, row = i % 2;
        g.fillText(text.charAt(i), x + size * (0.27 + col * 0.46), y + size * (0.29 + row * 0.44));
      }
    }
    g.restore();
  };

  // ── 字 ────────────────────────────────────────────────────────

  function textSetup(g, size, o) {
    g.font = (o.weight || '500') + ' ' + size + 'px ' + SJ.FONT;
    g.fillStyle = o.color || SJ.C.ink;
    g.globalAlpha = o.alpha != null ? o.alpha : 1;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
  }

  // 竖排，从 (x,y) 起向下写；多列时右起（第二列在左边）
  Ink.vtext = function (g, text, x, y, size, o) {
    o = o || {};
    var cols = String(text).split('\n'), seed = o.seed || 0,
      lh = size * (o.lh || 1.14), cw = size * (o.cw || 1.34),
      ci, i, col, ch, jx, jy, ro, k;
    g.save();
    textSetup(g, size, o);
    for (ci = 0; ci < cols.length; ci++) {
      col = cols[ci];
      for (i = 0; i < col.length; i++) {
        ch = col.charAt(i);
        if (ch === ' ') continue;
        k = SJ.hash(seed + ci * 31.7 + i * 5.3);
        jx = (k - 0.5) * size * 0.055;
        jy = (SJ.hash(seed + ci * 13.1 + i * 9.7) - 0.5) * size * 0.05;
        ro = (k - 0.5) * 0.038;
        g.save();
        g.translate(x - ci * cw + jx, y + i * lh + jy);
        g.rotate(ro);
        g.fillText(ch, 0, 0);
        g.restore();
      }
    }
    g.restore();
  };

  Ink.htext = function (g, text, x, y, size, o) {
    o = o || {};
    var rows = String(text).split('\n'), seed = o.seed || 0,
      lh = size * (o.lh || 1.5), cw = size * (o.cw || 1.06),
      ri, i, row, ch, jx, jy, ro, k, wtot;
    g.save();
    textSetup(g, size, o);
    for (ri = 0; ri < rows.length; ri++) {
      row = rows[ri];
      wtot = (row.length - 1) * cw;
      for (i = 0; i < row.length; i++) {
        ch = row.charAt(i);
        if (ch === ' ') continue;
        k = SJ.hash(seed + ri * 27.3 + i * 4.9);
        jx = (k - 0.5) * size * 0.05;
        jy = (SJ.hash(seed + ri * 7.7 + i * 11.3) - 0.5) * size * 0.055;
        ro = (k - 0.5) * 0.034;
        g.save();
        g.translate(x - wtot / 2 + i * cw + jx, y + ri * lh + jy);
        g.rotate(ro);
        g.fillText(ch, 0, 0);
        g.restore();
      }
    }
    g.restore();
  };

  // 逐笔写出。p=0..1；每个字用一个自上而下推进的裁剪窗露出来，
  // 最后一个正在写的字带一点笔锋的斜切。
  Ink.brushReveal = function (g, text, x, y, size, p, o) {
    o = o || {};
    var vertical = o.vertical !== false,
      cols = String(text).split('\n'),
      total = 0, ci, i, done, cur, idx = 0,
      lh = size * (o.lh || (vertical ? 1.14 : 1.5)),
      cw = size * (o.cw || (vertical ? 1.34 : 1.06));
    for (ci = 0; ci < cols.length; ci++) total += cols[ci].length;
    if (total === 0) return;
    p = SJ.clamp(p, 0, 1);
    done = p * total;

    g.save();
    textSetup(g, size, o);
    for (ci = 0; ci < cols.length; ci++) {
      var col = cols[ci], wtot = (col.length - 1) * cw;
      for (i = 0; i < col.length; i++, idx++) {
        var ch = col.charAt(i);
        if (ch === ' ') continue;
        cur = done - idx;
        if (cur <= 0) continue;
        var px = vertical ? (x - ci * cw) : (x - wtot / 2 + i * cw),
          py = vertical ? (y + i * lh) : (y + ci * lh),
          k = SJ.hash((o.seed || 0) + ci * 31.7 + i * 5.3);
        g.save();
        g.translate(px + (k - 0.5) * size * 0.055, py);
        g.rotate((k - 0.5) * 0.038);
        if (cur < 1) {
          // 正在写的这个字：从上往下露出，切口略斜
          var hgt = size * 1.35, top = -size * 0.72;
          g.beginPath();
          g.moveTo(-size * 0.8, top);
          g.lineTo(size * 0.8, top);
          g.lineTo(size * 0.8, top + hgt * cur);
          g.lineTo(-size * 0.8, top + hgt * cur - size * 0.16);
          g.closePath();
          g.clip();
          g.globalAlpha = (o.alpha != null ? o.alpha : 1) * SJ.clamp(cur * 2.2, 0, 1);
        }
        g.fillText(ch, 0, 0);
        g.restore();
      }
    }
    g.restore();
  };

})(window.SJ = window.SJ || {});
