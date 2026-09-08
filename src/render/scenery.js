/* src/render/scenery.js  【T4 · 呈现】一关一景
 *
 * 决议 015：level.js 的 drawBackground 在 SJ.Ink.paper() 之后调一次
 *     SJ.Scenery.draw(def.bg, g, camX, camY, t, def)
 * 取代原来 switch (def.bg) 里的远景；近景 solids / deco / pickups 仍归 level.js。
 * 全部在**屏幕坐标**里画（camera 变换之外），视差自己用 camX/camY 算。
 * def.env / def.weather 只读，一个字段都不写。
 *
 * ── 笔墨规矩（Lead 第一轮返工定的数字标准，动手前先读这三条）────────
 * 1. 任何建筑 / 结构线一律走 SJ.Ink.stroke：**起笔收笔宽度差 ≥ 40%**，
 *    路径带 **±1.5px** 抖动，墨色 **alpha 0.25–0.5**。
 *    不许等宽灰线，不许 strokeRect —— 那是 CAD 图，不是水墨。
 * 2. **转角不许交合**：两笔在角上错开 2–6px（过头或不到头），永远没有精确接头。
 * 3. **满宽的横线必须被飞白打断**：一条横梁至少 1–2 处 8–20px 的断口。
 * 推论：元素只能更少、更重。第一版满屏细格子的教训是「画得多」不等于「画得够」。
 *
 * ── 另两条铁律（DESIGN §1）──────────────────────────────────────
 * 「任何一屏纸色留白 ≥ 50%」：这里只有线和洗，没有一块实心填充。
 * 「一屏最多一处彩色」：藤黄只给灯与火，石青只给水与雪，
 *   朱砂在这一层**一次都不用**（留给主角的发带与致命预警）。
 *
 * ── 八景各自的构图主体 ─────────────────────────────────────────
 *   p  楔子   檐与灯（街上一道翘檐；进了茶馆换成一梁二柱）
 *   c1 竹林   疏密节奏（泊松间距，成丛成空）
 *   c2 客栈   三层的梁（三道断开的横梁 + 至多三根柱）
 *   c3 长河   倒影与岸线（山影压扁落进水里，切成横条错开）
 *   c4 雪山   天空洗色与留白（沿地平线一条冷灰带；雪是留出来的）
 *   c5 藏经阁 火光与飞灰（每屏至多四架书的剪影，其中一架是倒的）
 *   c6 城楼   月与旗（留白月：月是纸，只画外圈的淡墨）
 *   f  终章   空（全屏至多两个元素）
 */
(function (SJ) {
  'use strict';

  var Sc = SJ.Scenery = {};
  var TAU = Math.PI * 2, DEG = Math.PI / 180;

  function C() { return SJ.C; }
  function hex(c, a) { return SJ.Ink.rgba(c, a); }
  function hs(i) { return SJ.hash(i); }
  function nz(x) { return SJ.noise(x); }
  function fmod(v, m) { return ((v % m) + m) % m; }

  // 结构线的 alpha 只能落在 0.25–0.5（规矩 1）
  function inkA(a) { return a < 0.25 ? 0.25 : (a > 0.5 ? 0.5 : a); }
  // 转角错开量 2–6px（规矩 2）
  function off(seed) { return 2 + hs(seed) * 4; }
  function sgn(seed) { return hs(seed) > 0.5 ? 1 : -1; }

  // 沿世界横轴每 gap 一个模块，只画进屏幕的那几个。
  function repeatX(ox, gap, pad, fn) {
    var i0 = Math.floor((ox - pad) / gap), i1 = Math.ceil((ox + SJ.W + pad) / gap), i;
    for (i = i0; i <= i1; i++) fn(i, i * gap - ox);
  }

  // 关卡的主地面 y（solids 里最宽的那一块）。背景的柱子要落到地上。
  var gyCache = {};
  function groundY(def) {
    if (gyCache[def.id] != null) return gyCache[def.id];
    var s = def.solids, i, best = null;
    for (i = 0; i < s.length; i++) if (!best || s[i][2] > best[2]) best = s[i];
    return (gyCache[def.id] = best ? best[1] : SJ.H * 0.86);
  }

  // ── 一笔「木」：规矩 1 的唯一出口，结构线全从这儿走 ──────────────
  // w 是起笔宽，收笔收到 0.5w（差 50%）；wobble 1.5 = ±1.5px 抖动；hairs 给飞白。
  function bar(g, pts, w, alpha, seed, o) {
    o = o || {};
    SJ.Ink.stroke(g, pts, {
      w0: w, w1: w * (o.w1k || 0.5),
      color: o.color || C().ink,
      alpha: o.raw ? alpha : inkA(alpha),
      taper: o.taper !== false,
      hairs: o.hairs != null ? o.hairs : 1,
      core: false,
      wobble: o.wobble != null ? o.wobble : 1.5,
      seed: seed
    });
  }

  // ── 断开的横梁（规矩 3）────────────────────────────────────────
  // 切成 2–3 段，段与段之间留 8–20px 的口子，每段各自起笔收笔、各自略有高低。
  function beamBroken(g, x0, x1, y, w, alpha, seed) {
    var L = x1 - x0, n = 2 + (hs(seed * 1.73) > 0.45 ? 1 : 0),
      cuts = [], i, sx, ex, gw, yy, mid;
    if (L < 60) { bar(g, [[x0, y], [x1, y]], w, alpha, seed); return; }
    for (i = 1; i < n; i++) cuts.push(x0 + L * (i / n + (hs(seed + i * 3.11) - 0.5) * 0.18));
    sx = x0;
    for (i = 0; i <= cuts.length; i++) {
      gw = 8 + hs(seed + i * 7.77) * 12;                    // 8–20px 的断口
      ex = (i < cuts.length) ? cuts[i] - gw * 0.5 : x1;
      yy = y + (hs(seed + i * 5.31) - 0.5) * 2.2;
      mid = (sx + ex) / 2;
      bar(g, [[sx, yy], [mid, yy + Math.min(4, (ex - sx) * 0.012)], [ex, yy - 0.6]], w, alpha, seed + i * 13);
      if (i < cuts.length) sx = cuts[i] + gw * 0.5;
    }
  }

  // ── 一根柱：一笔，略倾 0.5–2°，柱头与梁错开 2–6px（规矩 1+2）────
  // taperK = 下粗 / 上细 的比（缺省 1.45）。柱是上细下粗，所以 w1 > w0。
  function column(g, x, yTop, yBot, w, alpha, seed, taperK) {
    var tilt = (0.5 + hs(seed * 2.31) * 1.5) * DEG * sgn(seed * 9.7),
      dx = (yBot - yTop) * Math.tan(tilt),
      over = off(seed * 5.11) * sgn(seed * 3.3);            // 过头或不到头
    bar(g, [
      [x, yTop + over],
      [x + dx * 0.45, (yTop + yBot) / 2 + 2],
      [x + dx, yBot]
    ], w, alpha, seed + 3, { w1k: taperK || 1.45, taper: false, hairs: 0 });
  }

  // ── 翘檐：一笔压下去、末端挑起来；檐下几根椽，都不碰到檐线 ───────
  function eave(g, x0, x1, y, curl, alpha, seed) {
    var L = x1 - x0, i, rx, ry;
    bar(g, [
      [x0, y - curl * 0.55],
      [(x0 + x1) / 2, y + L * 0.020],
      [x1 - L * 0.10, y + L * 0.016],
      [x1, y - curl]
    ], 7.0, alpha, seed, { w1k: 0.42, taper: false, hairs: 2 });
    ry = y + L * 0.017;
    for (i = 1; i < 5; i++) {                               // 椽只留四根，且不与檐线相接
      rx = x0 + L * (i / 5);
      bar(g, [[rx, ry + off(seed + i)], [rx + 1.6, ry + 26 + hs(seed + i) * 10]],
        3.0, alpha * 0.8, seed + i * 3);
    }
  }

  // ── 0 · 楔子「醒木」：檐与灯 ───────────────────────────────────
  // 街上（camX 中心 < 1300）是一道翘檐挑在左上；进了茶馆换成一梁二柱。
  // 同一个 bg:'tea'，两处地方。画面下半（街面）一律不碰，灯笼桌椅是 level.js 的 deco。
  function tea(g, cx, cy, t, def, k) {
    var W = SJ.W, inner = (cx + W * 0.5) > 1300;
    k = k == null ? 1 : k;

    if (!inner) {
      // 对街：一屏至多两间房，每间**两笔**（左右坡各一笔），屋脊处两笔错开不交合
      repeatX(cx * 0.16, 430, 160, function (i, sx) {
        var y2 = 250 - cy * 0.05, hgt = 42 + hs(i * 3.1) * 28, hw = 82 + hs(i * 5.9) * 26,
          o1 = off(i * 2.7), o2 = off(i * 4.3);
        bar(g, [[sx - hw, y2], [sx - hw * 0.42, y2 - hgt * 0.72], [sx + o1, y2 - hgt]],
          3.4, 0.26 * k, i * 7 + 2);
        bar(g, [[sx + hw, y2 + 3], [sx + hw * 0.42, y2 - hgt * 0.70], [sx - o2, y2 - hgt + 3]],
          3.2, 0.26 * k, i * 7 + 5);
      });
      // 近处的翘檐：只占画面左上，右边一大片天空留给雨
      repeatX(cx * 0.42, 640, 280, function (i, sx) {
        var y = 56 - cy * 0.12 + hs(i * 5.7) * 10;
        eave(g, sx - 300, sx + 240, y, 26, 0.40 * k, i * 13 + 5);
        if (k > 0.5) {                                      // 檐下两盏（全屏唯一的彩色）
          SJ.Ink.lantern(g, sx - 150, y + 52, 8.5, t + i);
          SJ.Ink.lantern(g, sx + 90, y + 48, 7.5, t * 0.8 + i * 2);
        }
      });
    } else {
      // 茶馆内：一道断开的横梁 + 至多三根柱 + 一块淡洗当窗（不画窗框）
      var yb = 74 - cy * 0.10, gy = groundY(def) - cy - 4;
      beamBroken(g, -40, W + 40, yb, 8.0, 0.30 * k, 3);
      repeatX(cx * 0.5, 520, 120, function (i, sx) {
        // 起笔 3.6 收笔 7.6（差 111%，原来只有 45%）：顶上收得住，落地才压得下去。
        // 平均笔宽比原来窄两成，所以 alpha 抬到 0.30 之后整根反而更轻。
        column(g, sx, yb, gy, 3.6, 0.30 * k, i * 17 + 7, 2.1);
        if (hs(i * 9.7) > 0.5) {
          SJ.Ink.wash(g, sx + 120, yb + 46, 128, 104,
            { color: C().stone, alpha: 0.075 * k, dir: 'v', both: true });
        }
      });
    }
  }

  // ── 1 · 竹林听雨：疏密节奏（Lead 通过，未改）────────────────────
  function bamboo(g, cx, cy, t, def) {
    g.save(); g.translate(0, -cy * 0.06);
    SJ.Ink.mountains(g, cx, 2, { alpha: 0.085, baseY: SJ.H * 0.42, seed: 12 });
    g.restore();
    SJ.Ink.bamboo(g, cx, 2, { alpha: 0.15, gap: 235, poisson: 0.9, seed: 4, baseY: SJ.H + 8, h: SJ.H * 0.92 });
    SJ.Ink.bamboo(g, cx, 1, { alpha: 0.30, gap: 235, poisson: 1.0, seed: 21, baseY: SJ.H + 12 });
    SJ.Ink.bamboo(g, cx, 0, { alpha: 0.52, gap: 620, poisson: 1.0, seed: 37, baseY: SJ.H + 16, h: SJ.H * 1.12 });
  }

  // ── 2 · 断桥客栈：三层的梁 ─────────────────────────────────────
  // 三层楼板（世界 y = 820 / 600 / 380）各一道**断开**的梁；柱一屏至多三根。
  // 上一版那两排细柱 + 满屏雀替 + 一排屋檐是 CAD 图，全删了。
  function inn(g, cx, cy, t, def) {
    var W = SJ.W, FL = [820, 600, 380], f, y;

    for (f = 0; f < FL.length; f++) {
      y = FL[f] - cy;
      if (y < -80 || y > SJ.H + 120) continue;
      beamBroken(g, -40, W + 40, y - 6, 5.6, 0.28, f * 31 + 5);
      // 楼板下一道很浅的洗，只往下 34px，绝不填死
      SJ.Ink.wash(g, 0, y - 4, W, 34, { color: C().ink, alpha: 0.055, dir: 'v' });
    }

    repeatX(cx * 0.62, 560, 120, function (i, sx) {
      var jit = (hs(i * 4.3) - 0.5) * 40;
      column(g, sx + jit, 330 - cy, 860 - cy, 6.4, 0.26, i * 7 + 9);
    });
  }

  // ── 3 · 长河渡：倒影与岸线（Lead 通过，未改）────────────────────
  function river(g, cx, cy, t, def) {
    var W = SJ.W, H = SJ.H, i, wat = null;
    for (i = 0; i < def.hazards.length; i++) {
      if (def.hazards[i].kind === 'water') { wat = def.hazards[i]; break; }
    }

    // 倒影要复用同一层缓存，参数必须与正画时逐字相同（alpha 也在缓存 key 里）
    function farHills(gg) {
      SJ.Ink.mountains(gg, cx, 2, { alpha: 0.090, baseY: H * 0.40, seed: 5 });
      SJ.Ink.mountains(gg, cx, 1, { alpha: 0.125, baseY: H * 0.50, seed: 19 });
    }

    g.save(); g.translate(0, -cy * 0.10);
    farHills(g);
    g.restore();

    // 对岸：一道横贯的岸线，带几处凹进去的小湾 + 岸边苔点
    var shoreY = (wat ? wat.y - 26 : H * 0.72) - cy;
    var ox = cx * 0.30, pts = [], x, k;
    for (x = -60; x <= W + 60; x += 46) {
      k = nz(7.1 + (x + ox) * 0.0055) * 7 + nz(2.3 + (x + ox) * 0.017) * 3;
      pts.push([x, shoreY + k]);
    }
    SJ.Ink.stroke(g, pts, {
      w0: 3.4, w1: 2.0, color: C().ink, alpha: 0.20,
      taper: false, hairs: 0, core: false, seed: 41, wobble: 0.6
    });
    repeatX(ox, 118, 60, function (i2, sx) {
      if (hs(i2 * 6.7) < 0.45) return;
      SJ.Ink.blob(g, sx, shoreY + 4 + hs(i2 * 2.9) * 5, 2.2 + hs(i2 * 5.3) * 3.4, i2 * 13 + 1,
        { color: C().ink, alpha: 0.16, rough: 0.4, squash: 0.5 });
    });

    // 更远的一道岸：与近岸之间夹一条水汽，江面的进深全靠这条缝
    var fy = shoreY - 46 - nz(3.3 + cx * 0.0007) * 10, fpts = [], fx2;
    for (fx2 = -60; fx2 <= W + 60; fx2 += 62) {
      fpts.push([fx2, fy + nz(11.7 + (fx2 + cx * 0.18) * 0.0042) * 6]);
    }
    SJ.Ink.stroke(g, fpts, {
      w0: 2.2, w1: 1.4, color: C().ink, alpha: 0.10,
      taper: false, hairs: 0, core: false, seed: 44, wobble: 0.5
    });

    // 倒影：把上面那两层山镜到水里（压扁 0.18，否则山影全落在屏幕外）
    if (wat) {
      var wy = wat.y - cy, wh = Math.min(H - wy, 150);
      if (wy < H && wh > 12) {
        SJ.Ink.water(g, 0, wy, W, wh, t, {
          n: 0,                       // 波纹归 level.js 的 drawHazards 画，这里只做倒影与岸线
          shore: 0.22, seed: 3, reflectAlpha: 0.85, reflectScale: 0.18,
          reflect: farHills,
          reflectFrom: shoreY - wy    // 镜像轴取岸线，不是水面顶边，山才不会浮起来
        });
      }
    }

    // 远帆：整条河唯一的「有人」
    var sx2 = fmod(-cx * 0.14 + 1180, 2400) - 300, sy2 = fy + 12;
    if (sx2 > -60 && sx2 < W + 60) {
      SJ.Ink.stroke(g, [[sx2, sy2], [sx2 + 2, sy2 - 30]], {
        w0: 1.6, w1: 1.0, color: C().ink, alpha: 0.22, taper: false, hairs: 0, core: false, seed: 61
      });
      SJ.Ink.stroke(g, [[sx2 + 1, sy2 - 29], [sx2 + 17, sy2 - 6], [sx2, sy2 - 2]], {
        w0: 2.0, w1: 1.2, color: C().ink, alpha: 0.20, taper: false, hairs: 1, core: false, seed: 62
      });
    }
  }

  // ── 4 · 雪照山门：天空洗色与留白 ───────────────────────────────
  // 雪在米色纸上天生没有对比。办法不是把雪画白 —— 纸已经是白的 ——
  // 而是沿地平线压一条**横向的冷灰带**，脊线以下一笔不画：雪是留出来的。
  // 冷灰 = 淡墨打底 + 一点石青提冷。上一版是满屏一层石青，
  // 被雾（level.js:804 全程 R.fog=1）在玩家周围挖出一个圆洞，看着就是一块蓝污渍。
  function skyBand(g, yMid, h, aInk, aStone) {
    SJ.Ink.wash(g, -20, yMid - h, SJ.W + 40, h * 2,
      { color: C().inkLight, alpha: aInk, dir: 'v', both: true });
    SJ.Ink.wash(g, -20, yMid - h * 0.72, SJ.W + 40, h * 1.44,
      { color: C().stone, alpha: aStone, dir: 'v', both: true });
  }

  function snowRidge(g, ox, cfg) {
    var W = SJ.W, pts = [], x, y;
    for (x = -50; x <= W + 50; x += 22) {
      y = cfg.base
        - (nz(cfg.seed + (x + ox) * cfg.f) * 0.66 + nz(cfg.seed + 13 + (x + ox) * cfg.f * 3.1) * 0.34) * cfg.amp;
      pts.push([x, y]);
    }
    // 脊线：一笔淡墨，起收笔差 50%，把「天」与「雪」分开
    SJ.Ink.stroke(g, pts, {
      w0: cfg.w, w1: cfg.w * 0.5, color: C().ink, alpha: cfg.line,
      taper: false, hairs: 0, core: false, seed: cfg.seed + 3, wobble: 1.5
    });
    return pts;
  }

  function snow(g, cx, cy, t, def) {
    var H = SJ.H, dy = -cy * 0.13, i, seg;

    g.save(); g.translate(0, dy);
    skyBand(g, H * 0.42, 92, 0.085, 0.05);
    snowRidge(g, cx * 0.07, { base: H * 0.52, amp: 96, f: 0.0030, seed: 3.7, line: 0.10, w: 3.4 });
    g.restore();

    g.save(); g.translate(0, dy * 1.7);
    skyBand(g, H * 0.62, 58, 0.055, 0.035);
    var near = snowRidge(g, cx * 0.16, { base: H * 0.70, amp: 74, f: 0.0052, seed: 21.3, line: 0.14, w: 4.2 });

    // 背阴面：脊线下方几道往下化开的短皴，雪山才有体积（只 60px，绝不铺满）
    for (i = 4; i < near.length - 4; i += 9) {
      seg = near[i];
      if (near[i + 3] && near[i + 3][1] > seg[1] + 4) {
        SJ.Ink.stroke(g, [[seg[0], seg[1] + 3], [seg[0] + 16, seg[1] + 34 + hs(i) * 22]], {
          w0: 3.0, w1: 0.6, color: C().stone, alpha: 0.12,
          taper: true, hairs: 0, core: false, seed: i * 3 + 1, wobble: 1.5
        });
      }
    }
    // 山门那侧的两株远松，小得只剩姿态
    repeatX(cx * 0.16, 720, 200, function (i2, sx) {
      if (hs(i2 * 3.3) < 0.42) return;
      g.save(); g.globalAlpha = 0.26;
      SJ.Ink.pine(g, sx, H * 0.70 + 6, 0.34 + hs(i2 * 7.1) * 0.14, i2 * 9 + 2);
      g.restore();
    });
    g.restore();
  }

  // ── 5 · 藏经阁：火光与飞灰 ─────────────────────────────────────
  // 每屏至多四架书的**剪影**，一架 3–5 笔：两竖、一横、一两团书的墨。
  // 没有小格子 —— 上一版满屏格子是方格纸，不是藏经阁。其中偶尔一架是倒的（这一关的题眼）。
  function shelf(g, x, baseY, w, h, alpha, seed, fallen) {
    g.save();
    g.translate(x, baseY);
    if (fallen) g.rotate(-78 * DEG * sgn(seed * 3.7));       // 倒下的那一架
    column(g, -w * 0.5, -h, 0, 4.6, alpha, seed + 1);
    column(g, w * 0.5, -h * 0.94, 0, 4.2, alpha, seed + 2);
    // 一横：搁板，两端都不到头（规矩 2）
    bar(g, [[-w * 0.5 + off(seed + 4), -h * 0.62],
    [0, -h * 0.62 + 2.4],
    [w * 0.5 - off(seed + 5), -h * 0.60]], 4.0, alpha, seed + 6);
    // 一两团书：墨团，不是一排小竖
    SJ.Ink.blob(g, -w * 0.12 + hs(seed + 7) * w * 0.2, -h * 0.72, w * 0.19, seed + 8,
      { color: C().ink, alpha: alpha * 0.62, rough: 0.42, squash: 0.44 });
    if (hs(seed + 9) > 0.42) {
      SJ.Ink.blob(g, w * 0.16, -h * 0.34, w * 0.15, seed + 10,
        { color: C().ink, alpha: alpha * 0.5, rough: 0.46, squash: 0.40 });
    }
    g.restore();
  }

  // 飞灰：t 与 hash 算出来的确定性场，**不进 FX 粒子池**
  //（Scenery.draw 在暂停与 hitstop 时照样每帧跑，而 FX.update 不跑 —— 会一路堆到 MAX=600）
  function ash(g, ox, t, n) {
    var W = SJ.W, H = SJ.H, i, k, k2, k3, x, y, r, sp;
    g.save();
    for (i = 0; i < n; i++) {
      k = hs(i * 1.73 + 0.3); k2 = hs(i * 3.91 + 5.1); k3 = hs(i * 7.77 + 2.2);
      sp = 16 + k2 * 44;
      x = fmod(k * W * 1.4 - ox * (0.18 + k2 * 0.42) + Math.sin(t * (0.4 + k * 0.7) + i) * 24, W + 80) - 40;
      y = fmod(k2 * H - t * sp, H + 70) - 35;
      r = 1.3 + k3 * 2.8;
      g.globalAlpha = 0.12 + k3 * k3 * 0.34;
      g.fillStyle = (k3 > 0.86) ? C().gamboge : C().inkLight;   // 十来粒还带着火星
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    g.restore();
  }

  function library(g, cx, cy, t, def) {
    var W = SJ.W, H = SJ.H, ox = cx * 0.56, FLOORS = [900, 680, 460, 260], f, fy;

    // 一层楼板一排，gap 拉到 640：算上同屏可见的两三层，一屏也就三四架
    for (f = 0; f < FLOORS.length; f++) {
      fy = FLOORS[f] - cy * 0.92;
      if (fy < -60 || fy > H + 60) continue;
      (function (fy2, f2) {
        repeatX(ox + f2 * 190, 640, 140, function (i, sx) {
          var seed = i * 17.3 + f2 * 5.1;
          if (hs(seed) < 0.34) return;                     // 空一架：烧掉的、搬空的
          shelf(g, sx, fy2, 92 + hs(seed + 3) * 34, 132 + hs(seed + 4) * 42,
            0.30, seed, hs(seed + 21) > 0.86);
        });
      })(fy, f);
    }

    // 火光：1.3Hz 主 + 3.7Hz 次的低频暖闪，从右下角舔上来。
    // 只是一层径向渐变，纸色一点没被填掉。
    var fl = 0.74 + Math.sin(t * 1.3) * 0.20 + Math.sin(t * 3.7 + 1.1) * 0.09 + nz(t * 0.9) * 0.07;
    var fx = W * 0.84, fy2 = H * 0.94, gr = g.createRadialGradient(fx, fy2, 20, fx, fy2, H * 1.05);
    gr.addColorStop(0, hex(C().gamboge, 0.40 * fl));
    gr.addColorStop(0.34, hex(C().gamboge, 0.165 * fl));
    gr.addColorStop(1, hex(C().gamboge, 0));
    g.save(); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore();

    // 顶上被熏黑的一道：火在烧，梁先黑
    SJ.Ink.wash(g, 0, 0, W, 96, { color: C().ink, alpha: 0.085 * (0.7 + fl * 0.4), dir: 'v' });

    ash(g, cx, t, 40);
  }

  // ── 6 · 城楼夜：月与旗 ─────────────────────────────────────────
  // 留白月：月本身**一笔不画**（它就是纸），只在外圈让一层淡墨把它「让」出来。
  // 没有白色填充、没有发光。旗是两三笔的布，顺着 env.windAx 弯。
  // 旗是一块**布**，不是两根挂着的线。所以轮廓一笔画完：
  // 前缘往下 → 下摆横过去 → 后缘收回来（末端差 2–6px 不与挑杆交合，规矩 2），
  // 再补一笔中间的褶。风向来自 env.windAx：p² 的常量弯（一直被吹着）
  // 叠一点低频摆动（在风里抖），不是原地左右晃。
  // 旗是一块挂在杆上的**布**。画法是水墨里最老实的那种：
  //   一根挑杆 → 两条边（上端贴杆、下端被风推开）→ 一道兜起来的下摆 → 一两道横褶。
  // 四个角都**不合拢**（规矩 2）。闭合成一圈会变成一颗药丸，那是我上一版的错。
  function banner(g, x, yTop, len, t, dir, seed, alpha) {
    // 布宽 34–46：窄的那几面（原来最窄 24）在远处会读成一颗豆荚，
    // 所以把下限抬上来、方差压下去，每一面都得看得出是块布。
    var w = 34 + hs(seed) * 12, i, p, front = [], back = [], yy, sN;

    function windX(p2) {
      return (p2 * p2 * 9 + Math.sin(t * 1.05 + seed * 2.1 + p2 * 1.3) * (0.5 + p2 * p2 * 5)) * dir;
    }

    // 挑杆：布挂在它上面。没有它，旗就是飘在空中的一个荚
    bar(g, [[x - 7, yTop - 4], [x + w + 7, yTop - 2.5]], 3.0, alpha, seed);

    for (i = 0; i <= 5; i++) {
      p = i / 5;
      front.push([x + windX(p), yTop + off(seed + 1) + p * len]);
      back.push([x + w + windX(p) * 0.86, yTop + off(seed + 2) + p * len * 0.97]);
    }
    bar(g, front, 4.2, alpha, seed + 1, { w1k: 0.48 });          // 迎风的一边重
    bar(g, back, 3.0, alpha * 0.78, seed + 2, { w1k: 0.46 });    // 背风的一边轻

    // 下摆：把两条边兜起来，两端都差 2–6px 不与边线相接
    bar(g, [
      [front[5][0] + off(seed + 4), front[5][1] - 2],
      [(front[5][0] + back[5][0]) / 2, front[5][1] + 5],
      [back[5][0] - off(seed + 6), back[5][1] - 2]
    ], 3.2, alpha * 0.9, seed + 5, { w1k: 0.45 });

    // 两道横褶：布被风吹出的折，比边线轻，长度只到布宽的七成
    for (i = 1; i <= 2; i++) {
      p = i / 3.4;
      yy = yTop + p * len + 3;
      sN = windX(p);
      bar(g, [[x + sN + off(seed + 7 + i), yy], [x + sN + w * 0.82, yy + 3.2]],
        2.4, alpha * 0.62, seed + 10 + i);
    }
  }

  function wall(g, cx, cy, t, def) {
    var W = SJ.W, H = SJ.H, ink = C().ink, i;
    var wind = (def.env && def.env.windAx) || 0;
    var dir = wind > 0 ? 1 : -1;              // 缺省往左，与 Ink.rain/snow 的缺省风向一致

    // 夜不是黑的，是纸凉下来了
    SJ.Ink.wash(g, 0, 0, W, H * 0.62, { color: ink, alpha: 0.075, dir: 'v' });

    // 月：天上的东西没有视差。画外圈的晕，月心那块纸原样留着
    var mx = W - 206 - cx * 0.02, my = 100 - cy * 0.05, r = 44, cy2;
    if (mx > -140 && mx < W + 140) {
      var mg = g.createRadialGradient(mx, my, r, mx, my, r * 3.6);
      mg.addColorStop(0, hex(ink, 0.135));
      mg.addColorStop(0.34, hex(ink, 0.060));
      mg.addColorStop(1, hex(ink, 0));
      g.save();
      g.beginPath();
      g.arc(mx, my, r * 3.6, 0, TAU);
      g.arc(mx, my, r, 0, TAU, true);         // 反向 → 中间那块纸一笔不碰
      g.fillStyle = mg; g.fill();
      g.restore();
      // 云：横过月面的两道**淡墨**（不是白线 —— 白填充是上一版最刺眼的错）
      for (i = 0; i < 2; i++) {
        cy2 = my - 8 + i * 32 + Math.sin(t * 0.11 + i) * 4;
        SJ.Ink.stroke(g, [
          [mx - r * 2.4, cy2 + 7], [mx - r * 0.5, cy2], [mx + r * 1.1, cy2 + 5], [mx + r * 2.6, cy2 - 3]
        ], {
          w0: 15 - i * 5, w1: 6, color: ink, alpha: 0.055,
          taper: false, hairs: 0, core: false, seed: 71 + i, wobble: 1.5, soft: 1
        });
      }
    }

    // 城墙：一条**带飞白的断续线**（不是一排小矩形）。玩家正走在更前面的那一段上
    var yW = 214 - cy * 0.34, oxw = cx * 0.46;
    repeatX(oxw, 190, 120, function (i2, sx2) {
      if (hs(i2 * 9.1) < 0.18) return;                     // 断口：墙不是连续的
      var len = 96 + hs(i2 * 4.7) * 62, yy = yW + (hs(i2 * 2.3) - 0.5) * 5;
      bar(g, [[sx2, yy], [sx2 + len * 0.55, yy - 2.4], [sx2 + len, yy + 1.6]],
        4.6, 0.28, 60 + i2, { hairs: 3 });
    });
    SJ.Ink.wash(g, 0, yW, W, 52, { color: ink, alpha: 0.045, dir: 'v' });   // 墙身，只往下 52px

    // 旗：挂在墙头，一屏至多两面
    repeatX(oxw, 620, 160, function (i2, sx2) {
      if (hs(i2 * 5.9) < 0.34) return;
      banner(g, sx2 + 14, yW + 2, 104 + hs(i2 * 8.3) * 76, t, dir, i2 * 3 + 1, 0.30);
    });

    // 城楼：关卡末端那一座（世界 x≈4760），越走越近 —— 这一回的目的地
    var tx = 4760 * 0.46 - cx * 0.46, ty = yW - 132;
    if (tx > -320 && tx < W + 320) {
      eave(g, tx - 156, tx + 156, ty, 26, 0.30, 81);
      eave(g, tx - 112, tx + 112, ty + 58, 18, 0.26, 82);
      column(g, tx - 82, ty + 70, yW, 5.0, 0.26, 83);
      column(g, tx + 82, ty + 70, yW, 5.0, 0.26, 84);
      // 楼里的一点暗：一块洗，不画窗框
      SJ.Ink.wash(g, tx - 52, ty + 74, 104, 58, { color: ink, alpha: 0.07, dir: 'v', both: true });
    }
  }

  // ── 7 · 终章「说剑」：空 ───────────────────────────────────────
  // 全屏**至多两个元素**：楔子那道檐，和一条贴着地平的横线。别的什么都没有。
  function finale(g, cx, cy, t, def) {
    var y = 58 - cy * 0.12;
    eave(g, -120, 470, y, 24, 0.16, 5);
    SJ.Ink.stroke(g, [[-20, 262 - cy * 0.05], [SJ.W * 0.46, 258 - cy * 0.05]], {
      w0: 2.4, w1: 0.9, color: C().ink, alpha: 0.075,
      taper: true, hairs: 0, core: false, seed: 7, wobble: 1.5
    });
  }

  // ── 入口 ──────────────────────────────────────────────────────
  // bg = def.bg。楔子与终章的 bg 都是 'tea'，靠 def.id 分开
  //（一个是「进门」，一个是「回来」，构图必须不同）。
  Sc.draw = function (bg, g, camX, camY, t, def) {
    if (!def) return;
    camX = camX || 0; camY = camY || 0; t = t || 0;

    if (def.id === 'f') { finale(g, camX, camY, t, def); return; }
    if (def.id === 'p') { tea(g, camX, camY, t, def, 1); return; }

    switch (bg) {
      case 'bamboo': bamboo(g, camX, camY, t, def); break;
      case 'inn': inn(g, camX, camY, t, def); break;
      case 'river': river(g, camX, camY, t, def); break;
      case 'snow': snow(g, camX, camY, t, def); break;
      case 'library': library(g, camX, camY, t, def); break;
      case 'wall': wall(g, camX, camY, t, def); break;
      case 'tea': tea(g, camX, camY, t, def, 1); break;
      default:
        // 没登记过的 bg：给一层远山兜底，绝不留下一屏纯白
        SJ.Ink.mountains(g, camX, 2, { alpha: 0.10 });
        break;
    }
  };

})(window.SJ = window.SJ || {});
