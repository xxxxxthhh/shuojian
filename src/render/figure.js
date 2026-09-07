(function (SJ) {
  'use strict';

  // ── 人物笔画骨架 ──────────────────────────────────────────────
  //
  // 坐标：o.x, o.y = 脚底中心的世界坐标。y 向下为正。
  // 局部空间以「脚底中心」为原点，角色一律朝 +x 画，再用
  // g.scale(facing*scale, scale) 镜像/缩放，所以：
  //
  //   角度 0 = 向下，正 = 朝 facing 方向（向前）摆。
  //   关节角是相对父节点的：legF:[hip, knee] 里 knee 是在大腿方向上再加的偏转。
  //   屈膝为负，屈肘为正。
  //
  // 长度单位：scale 1 时身高约 64px。
  //
  // 依赖 src/core/const.js 与 src/render/ink.js

  var F = SJ.Figure = {};

  // 骨骼长度（单位）
  var THIGH = 16, SHIN = 16, SPINE = 21, NECK = 5.5, HEADR = 4.6,
    UARM = 12, FARM = 11.5;

  var WLEN = { jian: 26, dao: 24, qiang: 52, gong: 17, di: 13, gan: 56 };

  // 0=向下，正=向前
  function dv(a) { return [Math.sin(a), Math.cos(a)]; }
  // 0=向上，正=向前（脊柱、脖子用）
  function uv(a) { return [Math.sin(a), -Math.cos(a)]; }

  function add(p, d, l) { return [p[0] + d[0] * l, p[1] + d[1] * l]; }

  function P(o) {
    o = o || {};
    return {
      hipY: o.hipY != null ? o.hipY : 32,
      lean: o.lean || 0,
      headAng: o.headAng || 0,
      neck: o.neck || 0,
      spine: o.spine || 0,
      armF: o.armF || [0.34, 0.28],
      armB: o.armB || [-0.22, 0.40],
      legF: o.legF || [0.13, -0.10],
      legB: o.legB || [-0.14, -0.12],
      wristF: o.wristF != null ? o.wristF : -0.30,
      weaponLen: o.weaponLen != null ? o.weaponLen : 1
    };
  }

  var TAU = Math.PI * 2;
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ── 姿势表 ────────────────────────────────────────────────────
  // 攻击的前摇只有 0.06s（约 4 帧），所以 *_wind 在 p=0 就必须
  // 已经是「蓄满」的样子，不能在 wind 里再从站姿慢慢拉起来。
  // 跟随（follow-through）全部放在 *_rec：p=0 是过冲，p≈0.6 收回。

  // 一条腿的一个完整周期。ph 0..1，0 = 触地。
  // 返回 [大腿角, 膝角(相对大腿，负=向后折)]
  function legCycle(ph, amp, flex) {
    ph -= Math.floor(ph);
    var u;
    if (ph < 0.5) {                     // 支撑相：脚在地上，膝接近伸直
      u = ph / 0.5;
      return [lerp(0.55, -0.52, u) * amp, -0.12 - 0.22 * Math.sin(u * Math.PI)];
    }
    u = (ph - 0.5) / 0.5;               // 摆动相：膝大幅折起再送出去
    return [lerp(-0.52, 0.55, u) * amp, -0.15 - flex * Math.sin(u * Math.PI)];
  }

  var POSES = {

    idle: function (p, t) {
      var br = Math.sin(t * 1.9) * 0.35, br2 = Math.sin(t * 1.9 + 0.7);
      return P({
        hipY: 32 + br,
        lean: 0.05 + br2 * 0.012,
        spine: 0.03, neck: -0.02, headAng: 0.02 + br2 * 0.02,
        armF: [0.34 + br2 * 0.03, 0.28], wristF: -0.30,
        armB: [-0.22 + br2 * 0.035, 0.40],
        legF: [0.13, -0.10], legB: [-0.14, -0.12]
      });
    },

    // 重心两段起伏：支撑中期最低，落地帧再压一下
    run: function (p, t) {
      var dip = Math.abs(Math.sin(p * Math.PI * 2)),
        comp = Math.pow(Math.max(0, Math.cos(p * TAU * 2)), 3),
        sw = Math.sin(p * TAU);
      return P({
        hipY: 31.9 - dip * 1.15 - comp * 0.55,
        lean: 0.30,
        spine: 0.07, neck: -0.10, headAng: -0.06 + dip * 0.05,
        legF: legCycle(p, 1, 1.70),
        legB: legCycle(p + 0.5, 1, 1.70),
        armF: [0.30 - 0.52 * sw, 0.55], wristF: -0.20,
        armB: [0.10 + 0.62 * sw, 0.62]
      });
    },

    walk: function (p, t) {
      var dip = Math.abs(Math.sin(p * Math.PI * 2)), sw = Math.sin(p * TAU);
      return P({
        hipY: 32.0 - dip * 0.5,
        lean: 0.12, spine: 0.03, neck: -0.03,
        legF: legCycle(p, 0.55, 0.75),
        legB: legCycle(p + 0.5, 0.55, 0.75),
        armF: [0.30 - 0.26 * sw, 0.34], wristF: -0.28,
        armB: [0.02 + 0.30 * sw, 0.40]
      });
    },

    jump: function (p) {   // 起跳蹬地
      return P({
        hipY: lerp(28.5, 33.5, ease(p)), lean: 0.20 - p * 0.18,
        spine: 0.05, headAng: -0.05,
        legF: [0.30 - p * 0.42, -0.75 + p * 0.55],
        legB: [-0.20 - p * 0.30, -0.85 + p * 0.30],
        armF: [0.30 - p * 0.55, 0.40], wristF: -0.25,
        armB: [-0.30 - p * 0.70, 0.45]
      });
    },

    rise: function (p, t) {
      // 两条腿要错开，否则挤成一团黑
      return P({
        hipY: 33, lean: -0.06, spine: -0.03, neck: 0.04, headAng: 0.03,
        legF: [0.42, -0.52], legB: [-0.46, -1.15],
        armF: [-0.16, 0.42], wristF: -0.10,
        armB: [-0.75, 0.50]
      });
    },

    fall: function (p, t) {
      return P({
        hipY: 32.4, lean: 0.12, spine: 0.04, neck: -0.04, headAng: -0.02,
        legF: [0.34, -0.30], legB: [-0.26, -0.55],
        armF: [0.42, 0.30], wristF: -0.28,
        armB: [-0.55, 0.35]
      });
    },

    land: function (p) {     // 落地压缩后回弹
      var k = ease(p);
      return P({
        hipY: lerp(26.5, 31.4, k), lean: lerp(0.30, 0.08, k),
        spine: 0.10, neck: -0.08, headAng: -0.04,
        legF: [lerp(0.42, 0.16, k), lerp(-0.95, -0.14, k)],
        legB: [lerp(-0.40, -0.16, k), lerp(-1.00, -0.16, k)],
        armF: [lerp(0.62, 0.34, k), 0.36], wristF: -0.26,
        armB: [lerp(-0.62, -0.22, k), 0.42]
      });
    },

    crouch: function (p) {
      // 角度是解出来的：前脚落在 y≈0，后脚踮起略高
      return P({
        hipY: 21.5, lean: 0.26, spine: 0.10, neck: -0.12, headAng: -0.05,
        legF: [1.05, -1.70], legB: [-0.20, -1.25],
        armF: [0.48, 0.42], wristF: -0.34,
        armB: [-0.10, 0.60]
      });
    },

    dashF: function (p, t) {
      return P({
        hipY: 30.2, lean: 0.55, spine: 0.10, neck: -0.22, headAng: -0.10,
        legF: [0.72, -0.36], legB: [-0.62, -0.72],
        armF: [0.86, 0.18], wristF: 0.05,
        armB: [-0.80, 0.30]
      });
    },

    guard: function (p, t) {
      return P({
        hipY: 30.6, lean: 0.10, spine: 0.06, neck: -0.05, headAng: -0.02,
        legF: [0.30, -0.22], legB: [-0.34, -0.30],
        armF: [1.05, 0.72], wristF: 0.62,
        armB: [0.72, 0.90]
      });
    },

    // 观势：静。全身收住，后手抬起成「指」，剑压低。
    observe: function (p, t) {
      var fl = Math.sin(t * 1.6) * 0.35;
      return P({
        hipY: 29.8 + fl, lean: 0.03, spine: -0.04, neck: 0.03,
        headAng: 0.03 + Math.sin(t * 1.15) * 0.02,
        legF: [0.46, -0.30], legB: [-0.48, -0.34],
        armF: [-0.62, 0.34], wristF: -0.10,
        armB: [2.28, -0.85]
      });
    },

    hurt: function (p) {
      var k = ease(p);
      return P({
        hipY: lerp(29.4, 31.6, k), lean: lerp(-0.62, -0.14, k),
        spine: lerp(-0.26, -0.04, k), neck: lerp(0.34, 0.06, k),
        headAng: lerp(0.30, 0.04, k),
        legF: [lerp(-0.52, 0.06, k), lerp(-0.42, -0.20, k)],
        legB: [lerp(0.55, -0.16, k), lerp(-0.50, -0.30, k)],
        armF: [lerp(-1.05, 0.10, k), lerp(0.55, 0.30, k)], wristF: -0.50,
        armB: [lerp(-1.45, -0.40, k), lerp(0.80, 0.55, k)]
      });
    },

    // 倒地未死：撑在一只手上，头还抬着 —— 生杀抉择就看这一下
    down: function (p, t) {
      return P({
        hipY: 7, lean: 1.25, spine: 0.10, neck: -0.45,
        headAng: -0.12 + Math.sin(t * 2.2) * 0.03,
        legF: [-1.32, -0.10], legB: [-1.10, -0.25],
        armF: [0.15, 1.50], wristF: -0.55,
        armB: [-0.20, 1.90]
      });
    },

    dead: function (p) {
      return P({
        hipY: 4.5, lean: 1.50, spine: 0.05, neck: 0.0, headAng: 0.10,
        legF: [-1.50, 0.0], legB: [-1.38, -0.14],
        armF: [1.35, 0.15], wristF: -0.25,
        armB: [1.15, 0.45]
      });
    },

    sit: function (p, t) {
      var br = Math.sin(t * 1.7) * 0.25;
      return P({
        hipY: 17.5 + br * 0.3, lean: 0.06, spine: 0.05, neck: -0.02,
        headAng: 0.02 + br * 0.02,
        legF: [1.38, -1.52], legB: [1.20, -1.62],
        armF: [0.52, 0.72], wristF: -0.40,
        armB: [0.44, 0.80]
      });
    },

    bow: function (p) {     // 抱拳
      var k = ease(p);
      return P({
        hipY: lerp(31.6, 30.4, k), lean: lerp(0.06, 0.46, k),
        spine: lerp(0.02, 0.16, k), neck: lerp(0, -0.20, k), headAng: -0.10,
        legF: [0.16, -0.14], legB: [-0.18, -0.16],
        armF: [lerp(0.34, 1.02, k), 0.95], wristF: -0.55,
        armB: [lerp(-0.22, 0.92, k), 1.05]
      });
    },

    thrust: function (p) {
      var k = ease(p);
      return P({
        hipY: lerp(31.0, 29.8, k), lean: lerp(0.16, 0.40, k),
        spine: 0.06, neck: -0.10, headAng: -0.04,
        legF: [lerp(0.26, 0.62, k), -0.20], legB: [lerp(-0.28, -0.52, k), -0.34],
        armF: [lerp(0.85, 1.52, k), lerp(0.75, 0.02, k)], wristF: 0.0,
        armB: [lerp(-0.40, -0.80, k), 0.50]
      });
    },

    // ── 三段连 ──────────────────────────────────────────────────
    // atk1 横斩 / atk2 反撩 / atk3 大劈

    atk1_wind: function (p) {   // p=0 就已经拉满
      return P({
        hipY: 31.2 - p * 0.3, lean: -0.16 - p * 0.07,
        spine: -0.09, neck: 0.10, headAng: 0.05,
        legF: [0.30, -0.14], legB: [-0.28, -0.20],
        armF: [-0.92 - p * 0.10, 0.92], wristF: -0.52,
        armB: [0.55, 0.75]
      });
    },
    atk1_hit: function (p) {
      var k = ease(p);
      return P({
        hipY: lerp(31.0, 30.3, k), lean: lerp(0.06, 0.36, k),
        spine: 0.11, neck: -0.12, headAng: -0.05,
        legF: [lerp(0.34, 0.50, k), -0.12], legB: [lerp(-0.30, -0.42, k), -0.30],
        armF: [lerp(0.10, 1.36, k), lerp(0.70, 0.10, k)], wristF: lerp(-0.30, 0.16, k),
        armB: [lerp(0.40, -0.55, k), 0.60]
      });
    },
    atk1_rec: function (p) {    // p=0 过冲，p≈0.6 收住
      var k = ease(Math.min(1, p / 0.6));
      return P({
        hipY: lerp(30.1, 31.7, k), lean: lerp(0.44, 0.14, k),
        spine: lerp(0.14, 0.04, k), neck: -0.08, headAng: -0.03,
        legF: [lerp(0.56, 0.18, k), -0.12], legB: [lerp(-0.46, -0.18, k), -0.16],
        armF: [lerp(1.52, 0.62, k), lerp(-0.06, 0.34, k)], wristF: lerp(0.26, -0.18, k),
        armB: [lerp(-0.62, -0.24, k), 0.48]
      });
    },

    atk2_wind: function (p) {   // 剑压到前下方，蓄反撩
      return P({
        hipY: 30.6 - p * 0.2, lean: 0.24 + p * 0.06,
        spine: 0.10, neck: -0.10, headAng: -0.04,
        legF: [0.44, -0.20], legB: [-0.34, -0.34],
        armF: [0.86 + p * 0.08, 0.44], wristF: -0.62,
        armB: [-0.60, 0.55]
      });
    },
    atk2_hit: function (p) {
      var k = ease(p);
      return P({
        hipY: lerp(30.4, 31.8, k), lean: lerp(0.24, -0.14, k),
        spine: lerp(0.08, -0.10, k), neck: 0.08, headAng: 0.06,
        legF: [lerp(0.42, 0.20, k), -0.16], legB: [lerp(-0.34, -0.26, k), -0.24],
        armF: [lerp(0.80, 2.36, k), lerp(0.50, 0.12, k)], wristF: lerp(-0.55, 0.22, k),
        armB: [lerp(-0.55, 0.42, k), 0.62]
      });
    },
    atk2_rec: function (p) {
      var k = ease(Math.min(1, p / 0.6));
      return P({
        hipY: lerp(32.0, 31.7, k), lean: lerp(-0.24, 0.10, k),
        spine: -0.06, neck: 0.06, headAng: 0.04,
        legF: [lerp(0.16, 0.16, k), -0.14], legB: [-0.22, -0.18],
        armF: [lerp(2.62, 0.66, k), lerp(0.06, 0.32, k)], wristF: lerp(0.34, -0.20, k),
        armB: [lerp(0.55, -0.24, k), 0.50]
      });
    },

    atk3_wind: function (p) {   // 举过头顶，重心抬起
      return P({
        hipY: 32.6 + p * 0.4, lean: -0.24 - p * 0.06,
        spine: -0.12, neck: 0.14, headAng: 0.08,
        legF: [0.22, -0.12], legB: [-0.26, -0.18],
        armF: [3.32 + p * 0.10, 0.62], wristF: -0.30,
        armB: [2.85, 0.70]
      });
    },
    atk3_hit: function (p) {
      var k = ease(p);
      return P({
        hipY: lerp(32.6, 29.2, k), lean: lerp(-0.20, 0.46, k),
        spine: lerp(-0.10, 0.16, k), neck: -0.16, headAng: -0.08,
        legF: [lerp(0.26, 0.56, k), lerp(-0.14, -0.34, k)],
        legB: [lerp(-0.28, -0.48, k), lerp(-0.18, -0.46, k)],
        armF: [lerp(3.20, 0.86, k), lerp(0.55, 0.06, k)], wristF: lerp(-0.25, 0.10, k),
        armB: [lerp(2.70, -0.30, k), 0.66]
      });
    },
    atk3_rec: function (p) {
      var k = ease(Math.min(1, p / 0.6));
      return P({
        hipY: lerp(28.8, 31.6, k), lean: lerp(0.56, 0.14, k),
        spine: lerp(0.20, 0.04, k), neck: -0.10, headAng: -0.04,
        legF: [lerp(0.62, 0.18, k), lerp(-0.40, -0.12, k)],
        legB: [lerp(-0.52, -0.18, k), lerp(-0.50, -0.16, k)],
        armF: [lerp(0.62, 0.58, k), lerp(-0.02, 0.32, k)], wristF: lerp(0.22, -0.22, k),
        armB: [lerp(-0.40, -0.24, k), 0.50]
      });
    },

    castWind: function (p, t) {  // 起手：剑竖在身前，气收住
      return P({
        hipY: 31.0 - p * 0.6, lean: -0.06, spine: -0.04, neck: 0.04, headAng: 0.02,
        legF: [0.26, -0.20], legB: [-0.30, -0.26],
        armF: [1.30 + p * 0.12, 1.05], wristF: 1.15,
        armB: [1.15, 1.20]
      });
    },
    castHit: function (p) {
      var k = ease(p);
      return P({
        hipY: lerp(30.4, 31.4, k), lean: lerp(-0.06, 0.30, k),
        spine: 0.10, neck: -0.10, headAng: -0.04,
        legF: [lerp(0.26, 0.52, k), -0.18], legB: [lerp(-0.30, -0.46, k), -0.32],
        armF: [lerp(1.42, 1.62, k), lerp(1.05, 0.05, k)], wristF: lerp(1.15, 0.05, k),
        armB: [lerp(1.15, 0.85, k), lerp(1.20, 0.30, k)]
      });
    }
  };

  // 粗做的别名：宁可少打磨，也不能让下游拿到 undefined
  POSES.upslash = POSES.atk2_hit;
  POSES.downslash = POSES.atk3_hit;

  F.poses = POSES;

  var warned = {};
  F.pose = function (name, p, t) {
    var f = POSES[name];
    if (!f) {
      if (!warned[name]) { warned[name] = 1; console.warn('[Figure] 未知 pose:', name, '→ 回退 idle'); }
      f = POSES.idle;
    }
    return f(SJ.clamp(p || 0, 0, 1), t || 0);
  };

  F.blend = function (a, b, k) {
    var o = {}, key, va, vb, i;
    for (key in a) {
      if (!Object.prototype.hasOwnProperty.call(a, key)) continue;
      va = a[key]; vb = b[key];
      if (vb === undefined) { o[key] = va; continue; }
      if (va instanceof Array) {
        o[key] = [];
        for (i = 0; i < va.length; i++) o[key][i] = lerp(va[i], vb[i], k);
      } else o[key] = lerp(va, vb, k);
    }
    return o;
  };

  // ── 骨架解算 ──────────────────────────────────────────────────
  // draw 与 tip 共用，保证剑尖坐标和画出来的剑完全一致

  function rig(pose) {
    var hip = [0, -pose.hipY],
      mid = add(hip, uv(pose.lean), SPINE * 0.5),
      neckP = add(mid, uv(pose.lean + pose.spine), SPINE * 0.5),
      sh = [lerp(mid[0], neckP[0], 0.80), lerp(mid[1], neckP[1], 0.80)],
      headA = pose.lean + pose.spine + pose.neck,
      headBase = add(neckP, uv(headA), NECK),
      headTop = add(headBase, uv(headA + pose.headAng), HEADR * 0.82),
      elF = add(sh, dv(pose.armF[0]), UARM),
      haF = add(elF, dv(pose.armF[0] + pose.armF[1]), FARM),
      elB = add(sh, dv(pose.armB[0]), UARM),
      haB = add(elB, dv(pose.armB[0] + pose.armB[1]), FARM),
      knF = add(hip, dv(pose.legF[0]), THIGH),
      ftF = add(knF, dv(pose.legF[0] + pose.legF[1]), SHIN),
      knB = add(hip, dv(pose.legB[0]), THIGH),
      ftB = add(knB, dv(pose.legB[0] + pose.legB[1]), SHIN),
      wristA = pose.armF[0] + pose.armF[1] + pose.wristF;
    return {
      hip: hip, mid: mid, neck: neckP, sh: sh, headBase: headBase, headTop: headTop,
      elF: elF, haF: haF, elB: elB, haB: haB,
      knF: knF, ftF: ftF, knB: knB, ftB: ftB,
      wristA: wristA
    };
  }

  function weaponTipLocal(r, kind, wlen) {
    if (!kind || !WLEN[kind]) return r.haF.slice();
    return add(r.haF, dv(r.wristA), WLEN[kind] * (wlen == null ? 1 : wlen));
  }

  // ── 次级运动 ──────────────────────────────────────────────────
  // 主驱动是 o.vx/o.vy（每个实体都有）—— 无状态。
  // 传了 o.key 才额外做一个指数追随，衣摆/发带会晚 1-2 帧跟上。
  var springs = new Map();   // 键常常是实体对象，普通对象会塌成同一个 key

  function lag(o, t) {
    var vx = o.vx || 0, vy = o.vy || 0,
      tx = SJ.clamp(-vx * 0.016 * (o.facing || 1), -2.6, 2.6),
      ty = SJ.clamp(-vy * 0.009, -2.2, 2.2),
      st, dt, k;
    if (o.key != null) {
      st = springs.get(o.key);
      if (!st) { st = { x: tx, y: ty, t: t }; springs.set(o.key, st); }
      dt = SJ.clamp(t - st.t, 0, 0.1); st.t = t;
      k = 1 - Math.exp(-dt * 14);
      st.x += (tx - st.x) * k; st.y += (ty - st.y) * k;
      tx = st.x; ty = st.y;
    }
    return [tx, ty];
  }

  F.clearMotionCache = function () { springs = new Map(); };

  // ── 武器 ──────────────────────────────────────────────────────

  function drawWeapon(g, r, kind, wlen, col, al, ls) {
    if (!kind || !WLEN[kind]) return;
    var h = r.haF, a = r.wristA, d = dv(a), L = WLEN[kind] * (wlen == null ? 1 : wlen),
      back = add(h, dv(a + Math.PI), 5.5), tip = add(h, d, L),
      perp = [-d[1], d[0]], i;

    if (kind === 'gong') {
      // 弓：一段弧 + 弦
      var c = add(h, d, 3);
      g.save();
      SJ.Ink.arcStroke(g, c[0], c[1], L, a - 1.15, a + 1.15, 2.2 * ls,
        { color: col, alpha: al, taper: false, hairs: 0, seed: 61, core: false });
      SJ.Ink.stroke(g, [add(c, dv(a - 1.15), L), add(c, dv(a + 1.15), L)],
        { w0: 0.8 * ls, w1: 0.7 * ls, color: col, alpha: al * 0.7, taper: false, hairs: 0, seed: 62, core: false });
      g.restore();
      return;
    }
    if (kind === 'di') {
      SJ.Ink.stroke(g, [back, tip], {
        w0: 2.0 * ls, w1: 1.7 * ls, color: col, alpha: al,
        taper: false, hairs: 0, seed: 63, core: false
      });
      return;
    }
    if (kind === 'dao') {
      // 刀：略带弧、单边厚
      var m1 = add(add(h, d, L * 0.5), perp, -L * 0.11);
      SJ.Ink.stroke(g, [back, h, m1, tip], {
        w0: 2.3 * ls, w1: 0.5 * ls, color: col, alpha: al, seed: 64, hairs: 2, core: false
      });
      SJ.Ink.stroke(g, [add(h, perp, -2.2), add(h, perp, 2.2)], {
        w0: 1.5 * ls, w1: 1.2 * ls, color: col, alpha: al * 0.85,
        taper: false, hairs: 0, seed: 65, core: false
      });
      return;
    }
    if (kind === 'qiang' || kind === 'gan') {
      SJ.Ink.stroke(g, [add(h, dv(a + Math.PI), L * 0.30), tip], {
        w0: 2.3 * ls, w1: kind === 'qiang' ? 0.6 * ls : 1.6 * ls,
        color: col, alpha: al, seed: 66, hairs: 2, core: false
      });
      if (kind === 'qiang') {
        // 红缨（唯一的一点朱砂，很小）
        for (i = 0; i < 3; i++) {
          var t2 = add(h, d, L * 0.80);
          SJ.Ink.stroke(g, [t2, add(add(t2, dv(a + Math.PI), 5), perp, (i - 1) * 2.4)], {
            w0: 1.5 * ls, w1: 0.3, color: SJ.C.cinnabar, alpha: al * 0.75,
            seed: 67 + i, hairs: 0, core: false
          });
        }
      }
      return;
    }
    // jian 剑：柄 + 护手 + 由厚到尖的直刃
    SJ.Ink.stroke(g, [back, add(h, d, 2)], {
      w0: 1.9 * ls, w1: 1.7 * ls, color: col, alpha: al * 0.9,
      taper: false, hairs: 0, seed: 68, core: false
    });
    SJ.Ink.stroke(g, [add(add(h, d, 2.4), perp, -2.6), add(add(h, d, 2.4), perp, 2.6)], {
      w0: 1.5 * ls, w1: 1.3 * ls, color: col, alpha: al * 0.9,
      taper: false, hairs: 0, seed: 69, core: false
    });
    SJ.Ink.stroke(g, [add(h, d, 3), tip], {
      w0: 2.5 * ls, w1: 0.45 * ls, color: col, alpha: al, seed: 70, hairs: 2, core: false
    });
  }

  // ── 主绘制 ────────────────────────────────────────────────────

  F.draw = function (g, o) {
    var pose = o.pose && typeof o.pose === 'object' ? o.pose
      : F.pose(o.pose || 'idle', o.p || 0, o.t || 0),
      scale = o.scale != null ? o.scale : 1,
      facing = o.facing || 1,
      col = o.color || SJ.C.ink,
      al = o.alpha != null ? o.alpha : 1,
      ls = o.lineScale != null ? o.lineScale : 1,
      t = o.t || 0,
      cloth = o.cloth != null ? o.cloth : 0.5,
      r = rig(pose),
      lg = lag(o, t),
      alB = al * 0.70,           // 后侧肢体压淡，做出前后
      i, sw;

    if (al <= 0) return;

    g.save();
    g.translate(o.x, o.y);
    g.scale(facing * scale, scale);

    // 每一节单独一笔：大腿和小腿画成一笔的话，Catmull-Rom 会把膝盖
    // 磨圆，人就变成面条。分开画，关节才有折角，也才凑得出 12 段笔画。
    function seg(pA, pB, wa, wb, alp, sd) {
      SJ.Ink.stroke(g, [pA, pB], {
        w0: wa * ls, w1: wb * ls, color: col, alpha: alp,
        taper: false, hairs: 0, seed: sd, core: false
      });
    }

    // ── 后侧肢体（1-4）──
    seg(r.hip, r.knB, 3.0, 2.4, alB, 11);
    seg(r.knB, r.ftB, 2.4, 1.5, alB, 12);
    seg(r.ftB, add(r.ftB, dv(1.30 + (pose.legB[0] + pose.legB[1]) * 0.22), 3.7), 1.7, 1.0, alB, 25);
    seg(r.sh, r.elB, 2.3, 1.9, alB, 13);
    seg(r.elB, r.haB, 1.9, 1.2, alB, 14);

    // ── 衣摆：跟着躯干速度甩，比躯干晚一点 ──
    if (cloth > 0) {
      var sway = Math.sin(t * 3.3) * 0.55 + Math.sin(t * 1.9 + 1.1) * 0.32;
      for (i = 0; i < 2; i++) {
        var sp = i === 0 ? -1.6 : 1.4,
          len = (7.5 + i * 1.4) * cloth + 4,
          bx = r.hip[0] + sp, by = r.hip[1] - 0.5,
          tipx = bx - 3.4 * cloth + lg[0] * (1.5 + i * 0.4) + sway * cloth * (0.6 + i * 0.25),
          tipy = by + len + lg[1] * 0.7;
        SJ.Ink.stroke(g, [[bx, by], [bx + (tipx - bx) * 0.45, by + len * 0.55], [tipx, tipy]], {
          w0: 2.6 * ls, w1: 0.35 * ls, color: col, alpha: al * 0.62,
          seed: 20 + i, hairs: 2, core: false
        });
      }
    }

    // ── 躯干（5）：一笔，胯窄胸宽，这一笔决定这个人有没有「体量」──
    SJ.Ink.stroke(g, [r.hip, r.mid, r.neck], {
      w0: 4.4 * ls, w1: 6.0 * ls, color: col, alpha: al,
      taper: false, hairs: 0, seed: 15, wobble: 0.22
    });

    // ── 前侧腿（6-7）──
    seg(r.hip, r.knF, 3.2, 2.6, al, 16);
    seg(r.knF, r.ftF, 2.6, 1.6, al, 17);
    // 脚：很短的一笔，但没有它人就站不住
    seg(r.ftF, add(r.ftF, dv(1.30 + (pose.legF[0] + pose.legF[1]) * 0.22), 4.0), 1.9, 1.1, al, 24);

    // ── 脖子与头（8-9）──
    seg(r.neck, r.headBase, 2.0, 1.9, al, 18);
    // 头是一个短促的墨点（圆头笔），不是圆圈也不是方块
    SJ.Ink.stroke(g, [r.headBase, r.headTop], {
      w0: HEADR * 1.80 * ls, w1: HEADR * 1.52 * ls, color: col, alpha: al,
      taper: false, hairs: 0, seed: 19, core: true
    });

    // ── 发带：朱砂。唯一的彩色，默认关，主角才开 ──
    if (o.ribbon) {
      // 起点在后脑偏下，不是头顶，否则像犄角
      var hc = [(r.headBase[0] + r.headTop[0]) * 0.5, (r.headBase[1] + r.headTop[1]) * 0.5],
        ang = pose.lean + pose.spine + pose.neck + pose.headAng,
        bk = dv(ang + Math.PI * 0.5),
        p1 = [hc[0] - bk[0] * HEADR * 1.05, hc[1] - bk[1] * HEADR * 1.05 - 1.0],
        rs = Math.sin(t * 4.1) * 1.4 + Math.sin(t * 2.3) * 0.85, rj;
      // 两条：一长一短，长的带明显的弧，才像飘带不像刺
      for (rj = 0; rj < 2; rj++) {
        var rl = rj === 0 ? 1 : 0.62, rp = rj === 0 ? 0 : 1.4;
        SJ.Ink.stroke(g, [
          p1,
          [p1[0] - (7.0 - lg[0] * 1.1) * rl, p1[1] + (4.0 + rs * 0.30 + lg[1] * 0.5 + rp) * rl],
          [p1[0] - (13.0 - lg[0] * 2.0) * rl, p1[1] + (11.0 + rs * 0.9 + lg[1] * 1.0 + rp) * rl],
          [p1[0] - (15.0 - lg[0] * 2.6) * rl, p1[1] + (16.5 + rs * 1.4 + lg[1] * 1.3 + rp) * rl]
        ], {
          w0: (rj === 0 ? 1.7 : 1.2) * ls, w1: 0.22, color: SJ.C.cinnabar,
          alpha: al * (rj === 0 ? 0.9 : 0.6), seed: 21 + rj, hairs: 2, core: false, wobble: 0.4
        });
      }
    }

    // ── 前侧手臂 + 武器（手腕独立于肘，剑尖轨迹才好看）──
    seg(r.sh, r.elF, 2.5, 2.0, al, 22);   // （10-11）
    seg(r.elF, r.haF, 2.0, 1.2, al, 23);
    drawWeapon(g, r, o.weapon, pose.weaponLen, col, al, ls);

    g.restore();
    void sw;
  };

  // 武器尖端的世界坐标。weapon 为 null 时返回持械手的位置。
  F.tip = function (o) {
    var pose = o.pose && typeof o.pose === 'object' ? o.pose
      : F.pose(o.pose || 'idle', o.p || 0, o.t || 0),
      scale = o.scale != null ? o.scale : 1,
      facing = o.facing || 1,
      r = rig(pose),
      lt = weaponTipLocal(r, o.weapon, pose.weaponLen);
    return { x: o.x + lt[0] * facing * scale, y: o.y + lt[1] * scale };
  };

  // 给下游取别的关节（残影、抓握点、命中判定）
  F.joints = function (o) {
    var pose = o.pose && typeof o.pose === 'object' ? o.pose
      : F.pose(o.pose || 'idle', o.p || 0, o.t || 0),
      scale = o.scale != null ? o.scale : 1,
      facing = o.facing || 1,
      r = rig(pose), out = {}, k;
    for (k in r) {
      if (!Object.prototype.hasOwnProperty.call(r, k)) continue;
      if (r[k] instanceof Array) {
        out[k] = { x: o.x + r[k][0] * facing * scale, y: o.y + r[k][1] * scale };
      }
    }
    out.tip = F.tip(o);
    return out;
  };

})(window.SJ = window.SJ || {});
