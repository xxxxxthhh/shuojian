// 【F】六个 Boss + 其余八招的敌方版本。
//
// 每个 Boss 2–3 阶段，每阶段 3–5 个可读招式，至少一招必须观势才能过。
// 「必须观势」的定义（不是背板）：
//   hitbox 存活 > 0.20s（身法无敌帧长度）且覆盖玩家能到的位置 —— 逃与滚都不成立，
//   但**每一招都留了 ≥0.45s 的起手式**，第一次见也有机会读出来。
//
// 倒地不死：Boss hp 归零后 act='down'、hp=0、e.dead 保持 false，
// 调用一次 e.onDefeat(e)，由关卡层弹生杀选择（DESIGN §3.3）。
(function (SJ) {
  'use strict';

  var AI = SJ.AI, M = AI.def, C = SJ.C;
  var go = AI.go, space = AI.space, beat = AI.beat;

  // ══════════════════════════════════════════════════════════
  // 音波 / 气劲投射物（裂帛、浪头、遍照都用它）
  // ══════════════════════════════════════════════════════════

  function wave(x, y, dir, owner, o) {
    o = o || {};
    var w = {
      tag: 'wave', team: o.team || 'foe', z: 6,
      w: o.w || 26, h: o.h || 78,
      vx: dir * (o.speed || 300), vy: o.vy || 0,
      facing: dir, life: o.life || 3.0, hp: 1, maxHp: 1,
      invuln: 0, dead: false, seed: SJ.rand(0, 9),
      color: o.color || C.stone, hb: null, t: 0
    };
    w.x = x - w.w / 2; w.y = y - w.h / 2;
    w.cx = function () { return this.x + this.w / 2; };
    w.cy = function () { return this.y + this.h / 2; };
    w.hurt = function (dmg, src, opt) {
      opt = opt || {};
      // 气劲只有「穿杨」能弹回来；刀砍不散
      if (opt.moveId === 'chuanyang') {
        this.vx = -this.vx; this.facing = -this.facing; this.team = 'player';
        if (this.hb) this.hb.dead = true;
        this.hb = SJ.Combat.hit({
          follow: this, ox: 0, oy: 0, w: this.w, h: this.h,
          dmg: 22, team: 'player', owner: src || SJ.player, ttl: this.life,
          knock: [280, -120], stun: 0.34, type: 'qi', pierce: true, maxHits: 3,
          moveId: 'chuanyang', ink: 6
        });
        SJ.Audio.sfx('parry', { vol: 0.9 });
      }
    };
    w.update = function (dt) {
      this.t += dt;
      this.life -= dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.life <= 0) { if (this.hb) this.hb.dead = true; SJ.Ent.remove(this); }
    };
    w.draw = function (g) {
      var cx = this.cx(), cy = this.cy(), i, pts = [];
      var a = 0.30 + 0.35 * SJ.clamp(this.life, 0, 1);
      for (i = 0; i <= 6; i++) {
        var k = i / 6;
        pts.push([cx + Math.sin(this.t * 12 + k * 5 + this.seed) * 5 * this.facing,
                  cy - this.h / 2 + this.h * k]);
      }
      SJ.Ink.stroke(g, pts, { w0: 3.2, w1: 7, color: this.color, alpha: a, seed: this.seed, wobble: 1.4 });
      SJ.Ink.stroke(g, pts.map(function (p) { return [p[0] - 11 * w.facing, p[1]]; }),
        { w0: 1.6, w1: 3.4, color: this.color, alpha: a * 0.5, seed: this.seed + 3, wobble: 2 });
    };
    w.hb = SJ.Combat.hit({
      follow: w, ox: 0, oy: 0, w: w.w, h: w.h,
      dmg: o.dmg || 12, team: w.team, owner: owner, ttl: w.life,
      knock: o.knock || [260, -120], stun: o.stun === undefined ? 0.28 : o.stun,
      type: 'qi', pierce: true, maxHits: 99, weight: o.weight || 'mid',
      moveId: o.moveId || null
    });
    SJ.Ent.add(w);
    return w;
  }

  // ══════════════════════════════════════════════════════════
  // 其余八招的敌方版本（师兄 P3 现学玩家的招时也查这张表）
  // ══════════════════════════════════════════════════════════

  M({
    id: 'hengyun', name: '横云断', tier: 'heavy',
    wind: 0.72, act: 0.30, rec: 0.62, cd: 4.2, range: [0, 330], weight: 1.8,
    poseW: 'atk3_wind', poseA: 'atk3_hit', poseR: 'atk3_rec', sfx: 'draw', sfxVol: 1,
    // 前冲斩，破防。hitbox 活 0.30s > 身法无敌 0.20s，高 96 从头罩到脚 ——
    // 滚不过去、跳不过去，只能观势。这是雨中刀教你的那一件事。
    path: function () { return [[-26, -50], [26, -46], [96, -16], [156, 8]]; },
    onWind: function (e, s, dt) { AI.brake(e, dt * 2); },
    fire: function (e, s) {
      var t = AI.target();
      if (t) AI.face(e, t);
      e.vx = e.facing * 560;
      s.data.hb = AI.hit(e, {
        follow: e, ox: 46, oy: -8, w: 104, h: 96, dmg: 16, ttl: 0.30,
        knock: [340, -220], stun: 0.34, type: 'slash', weight: 'heavy',
        guardBreak: true
      });
      SJ.FX.slash(e.cx() + e.facing * 50, e.cy() - 8,
        -1.5 * e.facing, 1.2 * e.facing, 84, { color: C.ink, w: 8, life: 0.2 });
      SJ.Game.shake(5, 0.2);
      SJ.Audio.sfx('swing3', { vol: 1 });
    },
    onAct: function (e, s, dt) {
      e.vx = e.facing * 560 * (1 - s.t / 0.30 * 0.55);
      if (!AI.ledge(e, e.facing)) e.vx *= 0.2;
      SJ.FX.dust(e.cx() - e.facing * 12, e.footY(), -e.facing);
    },
    onEnd: function (e, s) { if (s.data.hb) s.data.hb.dead = true; e.vx *= 0.3; }
  });

  M({
    id: 'liebo', name: '裂帛', tier: 'light',
    wind: 0.70, act: 0.14, rec: 0.52, cd: 3.0, range: [90, 620], weight: 1.6,
    poseW: 'castWind', poseA: 'castHit', poseR: 'idle', sfx: 'qi',
    path: function () { return [[16, -18], [120, -18], [280, -18], [430, -18]]; },
    fire: function (e, s) {
      wave(e.cx() + e.facing * 22, e.cy() - 8, e.facing, e, {
        dmg: 13, speed: 320, w: 24, h: 84, life: 2.6,
        moveId: s.moveId, color: C.stone
      });
      SJ.Game.shake(3, 0.14);
      SJ.Audio.sfx('qi', { vol: 1 });
    }
  });

  M({
    id: 'chengtian', name: '撑天', tier: 'heavy',
    wind: 0.66, act: 0.18, rec: 0.55, cd: 3.4, range: [0, 150], weight: 1.5,
    poseW: 'crouch', poseA: 'upslash', poseR: 'atk2_rec', sfx: 'swing2',
    path: function () { return [[34, 40], [50, 4], [46, -44], [30, -84]]; },
    onWind: function (e, s, dt) { AI.brake(e, dt * 1.5); },
    fire: function (e) {
      AI.hit(e, {
        ox: 44, oy: -22, w: 74, h: 116, dmg: 12, ttl: 0.18,
        knock: [140, -520], stun: 0.30, type: 'slash', weight: 'heavy', launch: true
      });
      SJ.FX.slash(e.cx() + e.facing * 44, e.cy() - 20,
        1.4 * e.facing, -1.4 * e.facing, 66, { color: C.ink, w: 6, life: 0.18 });
      SJ.FX.burst(e.cx() + e.facing * 40, e.cy(), {
        n: 8, color: C.inkLight, speed: 300, spread: 0.8,
        angle: -Math.PI / 2, life: 0.5, size: 2.6, gravity: 600
      });
      SJ.Audio.sfx('swing3', { vol: 0.9 });
    }
  });

  M({
    id: 'guying', name: '孤影', tier: 'grab',
    wind: 0.55, act: 0.14, rec: 0.46, cd: 4.0, range: [0, 520], weight: 1.5,
    poseW: 'atk1_wind', poseA: 'thrust', poseR: 'atk1_rec', ground: false,
    path: function () { return [[8, -12], [56, -14], [104, -12]]; },
    // 残影留在原地，本体到身后。位移在起手式之前 —— 落地后仍有 0.48s 可读
    onStart: function (e) {
      var t = AI.target();
      AI.figure(e);
      SJ.FX.trail(e, { life: 0.55, alpha: 0.38, color: C.ink });
      SJ.FX.burst(e.cx(), e.cy(), {
        n: 14, color: C.ink, speed: 210, spread: Math.PI * 2,
        life: 0.5, size: 2.8, gravity: 0, drag: 3
      });
      if (t) {
        var nx = t.cx() - t.facing * 58;
        var gy = SJ.World.groundAt(nx, t.y);
        if (gy !== null && gy - t.y < 220) {
          if (AI.blink(e, nx - e.w / 2, gy - e.h)) e.onGround = true;
        }
        AI.face(e, t);
      }
      SJ.Audio.sfx('dash', { vol: 0.9 });
    },
    fire: function (e) {
      e.vx = e.facing * 300;
      AI.hit(e, {
        ox: 58, oy: -12, w: 86, h: 34, dmg: 12, ttl: 0.14,
        knock: [260, -130], stun: 0.26, type: 'thrust', weight: 'mid'
      });
      SJ.FX.slash(e.cx() + e.facing * 64, e.cy() - 12,
        -0.22 * e.facing, 0.22 * e.facing, 46, { color: C.ink, w: 4.4 });
      SJ.Audio.sfx('swing2', { vol: 0.95 });
    }
  });

  M({
    id: 'wufeng', name: '无锋', tier: 'light',
    wind: 0.55, act: 0.12, rec: 0.50, cd: 5.0, range: [0, 110], weight: 0.6,
    danger: false, poseW: 'guard', poseA: 'guard', poseR: 'idle',
    path: function () { return [[-16, -36], [16, -42], [26, -8], [8, 18], [-16, 8], [-16, -36]]; },
    // 无锋不造成伤害。敌人用它 = 把你的观势与硬直清掉，逼你重新起手
    fire: function (e) {
      AI.hit(e, {
        ox: 34, oy: -8, w: 76, h: 64, dmg: 0, ttl: 0.12,
        knock: [260, -60], stun: 0.20, type: 'blunt', silent: true
      });
      SJ.FX.ring(e.cx() + e.facing * 26, e.cy(),
        { r: 8, r1: 80, color: C.stone, life: 0.45, w: 2.6 });
      SJ.Audio.sfx('block', { vol: 1 });
    }
  });

  M({
    id: 'fenshu', name: '焚书', tier: 'heavy',
    wind: 0.68, act: 0.20, rec: 0.60, cd: 5.5, range: [0, 130], weight: 1.2,
    poseW: 'castWind', poseA: 'castHit', poseR: 'atk3_rec', sfx: 'fire',
    color: '#b03a2b',
    path: function () {
      var p = [], i;
      for (i = 0; i <= 10; i++) {
        var a = i / 10 * Math.PI * 2;
        p.push([Math.sin(a) * 76, -8 - Math.cos(a) * 62]);
      }
      return p;
    },
    fire: function (e) {
      AI.hit(e, {
        ox: 0, oy: -8, w: 168, h: 132, dmg: 13, ttl: 0.20,
        knock: [320, -220], stun: 0.32, type: 'fire', weight: 'heavy',
        pierce: true, maxHits: 6
      });
      SJ.FX.ring(e.cx(), e.cy() - 8, { r: 10, r1: 150, color: C.cinnabar, life: 0.6, w: 4 });
      SJ.FX.burst(e.cx(), e.cy() - 8, {
        n: 22, color: C.cinnabar, speed: 340, spread: Math.PI * 2,
        life: 0.7, size: 3.2, gravity: -140, drag: 2
      });
      SJ.Game.shake(8, 0.32);
      SJ.Audio.sfx('fire', { vol: 1 });
    }
  });

  M({
    id: 'tiyun', name: '踏云', tier: 'light', learn: false,
    wind: 0.40, act: 0.10, rec: 0.30, cd: 5.0, range: [0, 400], weight: 0.4,
    danger: false, poseW: 'crouch', poseA: 'jump', poseR: 'fall',
    path: function () { return [[0, -10], [30, -70], [70, -110]]; },
    fire: function (e) { AI.hop(e, -640, e.facing * 220); }
  });

  M({
    id: 'shuojian', name: '说剑', tier: 'heavy', learn: false,
    wind: 0.60, act: 0.12, rec: 0.40, cd: 6.0, range: [0, 400], weight: 0.5,
    poseW: 'castWind', poseA: 'castHit', poseR: 'idle',
    path: function () { return [[-20, -46], [30, -40], [92, -10]]; },
    fire: function (e) { AI.start(e, AI.moves.hengyun, { moveId: 'shuojian' }); }
  });

  // ══════════════════════════════════════════════════════════
  // Boss 专用招（learn:false）
  // ══════════════════════════════════════════════════════════

  M({
    id: 'b_sanlian', name: '三连刀', tier: 'light', learn: false,
    wind: 0.50, act: 0.52, rec: 0.55, cd: 3.6, range: [0, 130], weight: 1.3,
    poseW: 'atk2_wind', poseA: 'atk2_hit', poseR: 'atk2_rec', sfx: 'swing1',
    path: function () { return [[-24, -44], [16, -54], [58, -26], [80, 6]]; },
    onStart: function (e, s) { s.data.n = 0; },
    onAct: function (e, s) {
      var stamp = [0, 0.17, 0.34], n = s.data.n;
      if (n < 3 && s.t >= stamp[n]) {
        s.data.n++;
        e.vx = e.facing * 150;
        AI.hit(e, {
          ox: 46, oy: -10 + (n === 1 ? 10 : 0), w: 82, h: 50,
          dmg: n === 2 ? 12 : 8, ttl: 0.11,
          knock: n === 2 ? [300, -180] : [160, -60], stun: 0.2,
          type: 'slash', weight: n === 2 ? 'heavy' : 'light'
        });
        SJ.FX.slash(e.cx() + e.facing * 48, e.cy() - 10,
          (n % 2 ? 1.1 : -1.1) * e.facing, (n % 2 ? -0.9 : 0.9) * e.facing,
          46, { color: C.ink, w: 4 });
        SJ.Audio.sfx(n === 2 ? 'swing3' : 'swing1', { vol: 0.8 });
      }
    }
  });

  M({
    id: 'b_yuluo', name: '雨落', tier: 'grab', learn: false,
    wind: 0.58, act: 0.85, rec: 0.50, cd: 4.4, range: [70, 400], weight: 1.2,
    poseW: 'crouch', poseA: 'downslash', poseR: 'land', sfx: 'swing2',
    path: function (e) {
      var t = AI.target(), d = t ? SJ.clamp((t.cx() - e.cx()) * e.facing, 60, 260) : 160;
      return [[10, -20], [d * 0.4, -110], [d * 0.8, -70], [d, 26]];
    },
    fire: function (e, s) {
      var t = AI.target();
      var d = t ? SJ.clamp((t.cx() - e.cx()) * e.facing, 60, 260) : 160;
      e.vy = -640; e.vx = e.facing * d * 1.4; e.onGround = false;
      // 起跳只结束了「他要跳」这句话，落地砸还没发生。
      // 再登记一道跟着他走的起手式，落点就是他脚下 —— 不然落地那一下没有前摇。
      SJ.Combat.telegraph({
        owner: e, moveId: s.moveId, dur: 0.52, danger: true,
        tier: 'grab',                     // 决议 014：整招是跳扑，落地那一下也归 grab
        path: [[0, -60], [0, -10], [0, 26], [78, 28]]
      });
      s.data.hb = AI.hit(e, {
        follow: e, ox: 16, oy: 6, w: 74, h: 74, dmg: 11, ttl: 0.85,
        knock: [240, -180], stun: 0.26, type: 'slash', weight: 'mid'
      });
      SJ.Audio.sfx('jump', { vol: 0.7 });
    },
    onAct: function (e, s) {
      if (e.onGround && s.t > 0.18) {
        s.t = 99;
        if (s.data.hb) s.data.hb.dead = true;
        AI.hit(e, {
          ox: 0, oy: 24, w: 150, h: 34, dmg: 10, ttl: 0.16,
          knock: [260, -240], stun: 0.3, type: 'blunt', weight: 'heavy',
          pierce: true, maxHits: 3
        });
        SJ.FX.ring(e.cx(), e.footY(), { r: 6, r1: 96, color: C.ink, life: 0.42, w: 2.8 });
        SJ.Game.shake(6, 0.24);
        SJ.Audio.sfx('hitHeavy', { vol: 0.8 });
      }
    },
    onEnd: function (e, s) { if (s.data.hb) s.data.hb.dead = true; }
  });

  M({
    id: 'b_dichui', name: '笛槌', tier: 'light', learn: false,
    wind: 0.46, act: 0.13, rec: 0.42, cd: 2.4, range: [0, 96], weight: 1.1,
    poseW: 'atk1_wind', poseA: 'atk1_hit', poseR: 'atk1_rec', sfx: 'swing1',
    path: function () { return [[-16, -44], [22, -46], [56, -12]]; },
    fire: function (e) {
      AI.hit(e, {
        ox: 42, oy: -12, w: 72, h: 48, dmg: 9, ttl: 0.13,
        knock: [280, -150], stun: 0.24, type: 'blunt', weight: 'mid'
      });
      SJ.FX.slash(e.cx() + e.facing * 42, e.cy() - 12,
        -1.0 * e.facing, 0.6 * e.facing, 40, { color: C.ink, w: 4 });
    }
  });

  M({
    id: 'b_yinbo', name: '音波', tier: 'light', learn: false,
    wind: 0.62, act: 0.22, rec: 0.55, cd: 4.0, range: [0, 300], weight: 1.2,
    poseW: 'castWind', poseA: 'castHit', poseR: 'idle', sfx: 'qi',
    // 原地爆一个环。贴地，跳起来就能躲 —— 教「跳」，不是逼观势
    path: function () {
      var p = [], i;
      for (i = 0; i <= 8; i++) p.push([Math.sin(i / 8 * Math.PI * 2) * 110, 22]);
      return p;
    },
    fire: function (e) {
      AI.hit(e, {
        ox: 0, oy: 22, w: 250, h: 34, dmg: 10, ttl: 0.22,
        knock: [300, -200], stun: 0.28, type: 'qi', weight: 'mid',
        pierce: true, maxHits: 4
      });
      SJ.FX.ring(e.cx(), e.footY() - 6, { r: 8, r1: 138, color: C.stone, life: 0.5, w: 3 });
      SJ.Game.shake(5, 0.24);
      SJ.Audio.sfx('qi', { vol: 0.9 });
    }
  });

  M({
    id: 'b_sanyin', name: '三音', tier: 'heavy', learn: false,
    wind: 0.80, act: 0.30, rec: 0.72, cd: 7.0, range: [110, 640], weight: 2, priority: true,
    poseW: 'castWind', poseA: 'castHit', poseR: 'idle', sfx: 'qi',
    // 高中低三道同时来：跳不过、蹲不下、冲不穿。铁笛先生的「必须观势」
    path: function () {
      return [[16, -66], [150, -66], [16, -18], [150, -18], [16, 22], [150, 22], [330, 0]];
    },
    onStart: function (e, s) { s.data.n = 0; },
    onWind: function (e, s, dt) { AI.brake(e, dt * 2); },
    fire: function (e, s) {
      var ys = [-58, -8, 24], i;
      for (i = 0; i < 3; i++) {
        wave(e.cx() + e.facing * 24, e.cy() + ys[i], e.facing, e, {
          dmg: 11, speed: 300, w: 22, h: 44, life: 2.6,
          moveId: s.moveId, color: C.stone
        });
      }
      SJ.Game.shake(6, 0.3);
      SJ.Audio.sfx('qi', { vol: 1 });
      SJ.Audio.sfx('bell', { vol: 0.5 });
    }
  });

  M({
    id: 'b_hengsao', name: '横扫', tier: 'heavy', learn: false,
    wind: 0.58, act: 0.18, rec: 0.52, cd: 2.8, range: [0, 210], weight: 1.4,
    poseW: 'atk2_wind', poseA: 'atk2_hit', poseR: 'atk2_rec', sfx: 'swing2',
    // 长篙：范围极大，但完全贴着地。跳起来就没事 —— 老翁教你「腿脚」
    path: function () { return [[-40, -20], [46, -32], [150, -22], [222, -4]]; },
    fire: function (e) {
      AI.hit(e, {
        ox: 100, oy: 2, w: 244, h: 40, dmg: 12, ttl: 0.18,
        knock: [360, -160], stun: 0.30, type: 'blunt', weight: 'heavy',
        pierce: true, maxHits: 3
      });
      SJ.FX.slash(e.cx() + e.facing * 100, e.cy() + 2,
        0.3 * e.facing, -0.3 * e.facing, 122, { color: C.ink, w: 6, life: 0.2 });
      SJ.Audio.sfx('swing3', { vol: 0.9 });
    }
  });

  M({
    id: 'b_dianshui', name: '点水', tier: 'light', learn: false,
    wind: 0.50, act: 0.14, rec: 0.40, cd: 2.2, range: [80, 240], weight: 1.2,
    poseW: 'atk1_wind', poseA: 'thrust', poseR: 'atk1_rec', sfx: 'swing1',
    path: function () { return [[12, -18], [90, -16], [176, -14]]; },
    fire: function (e) {
      AI.hit(e, {
        ox: 100, oy: -14, w: 168, h: 26, dmg: 10, ttl: 0.14,
        knock: [280, -70], stun: 0.24, type: 'thrust', weight: 'mid'
      });
      SJ.FX.slash(e.cx() + e.facing * 112, e.cy() - 14,
        -0.1 * e.facing, 0.1 * e.facing, 64, { color: C.ink, w: 3.6 });
    }
  });

  M({
    id: 'b_xuanfeng', name: '旋风扫', tier: 'heavy', learn: false,
    wind: 0.85, act: 0.90, rec: 0.75, cd: 8.0, range: [0, 260], weight: 2, priority: true,
    poseW: 'crouch', poseA: 'atk2_hit', poseR: 'atk3_rec', sfx: 'draw', lockFace: true,
    // 两圈，两侧都扫，持续 0.9s。跑不出去、滚不过去（0.20s 无敌帧不够）。
    // 渡口老翁的「必须观势」。起手 0.85s —— 全游戏最长的一个起手式。
    path: function () {
      var p = [], i;
      for (i = 0; i <= 14; i++) {
        var a = i / 14 * Math.PI * 4;
        p.push([Math.sin(a) * 150, -14 - Math.cos(a) * 26]);
      }
      return p;
    },
    onStart: function (e, s) { s.data.n = 0; },
    onWind: function (e, s, dt) { AI.brake(e, dt * 2); },
    fire: function (e, s) {
      s.data.hb = AI.hit(e, {
        follow: e, ox: 0, oy: -8, w: 300, h: 66, dmg: 14, ttl: 0.90,
        knock: [360, -260], stun: 0.34, type: 'blunt', weight: 'heavy',
        pierce: true, maxHits: 99
      });
      SJ.Game.shake(7, 0.6);
      SJ.Audio.sfx('swing3', { vol: 1 });
    },
    onAct: function (e, s) {
      if (Math.floor(s.t * 14) !== s.data.n) {
        s.data.n = Math.floor(s.t * 14);
        var a = s.t * Math.PI * 4;
        SJ.FX.slash(e.cx() + Math.sin(a) * 120, e.cy() - 14 - Math.cos(a) * 20,
          a, a + 1.2, 70, { color: C.ink, w: 5, life: 0.16 });
      }
    },
    onEnd: function (e, s) { if (s.data.hb) s.data.hb.dead = true; }
  });

  M({
    id: 'b_langtou', name: '浪头', tier: 'light', learn: false,
    wind: 0.60, act: 0.16, rec: 0.50, cd: 4.5, range: [120, 620], weight: 1.2,
    poseW: 'atk3_wind', poseA: 'downslash', poseR: 'atk3_rec', sfx: 'water',
    path: function () { return [[16, -40], [50, 10], [190, 22], [340, 22]]; },
    fire: function (e, s) {
      wave(e.cx() + e.facing * 30, e.footY() - 24, e.facing, e, {
        dmg: 11, speed: 260, w: 34, h: 48, life: 3.0,
        moveId: s.moveId, color: C.stone, vy: 0
      });
      SJ.FX.dust(e.cx() + e.facing * 30, e.footY(), e.facing);
      SJ.Audio.sfx('water', { vol: 0.9 });
    }
  });

  M({
    id: 'b_kuaijian', name: '快剑', tier: 'light', learn: false,
    wind: 0.42, act: 0.34, rec: 0.40, cd: 2.0, range: [0, 150], weight: 1.6,
    poseW: 'atk1_wind', poseA: 'thrust', poseR: 'atk1_rec', sfx: 'swing2',
    path: function () { return [[4, -26], [56, -18], [104, -22], [56, -6], [110, -2]]; },
    onStart: function (e, s) { s.data.n = 0; },
    onAct: function (e, s) {
      var stamp = [0, 0.14, 0.26], n = s.data.n;
      if (n < 3 && s.t >= stamp[n]) {
        s.data.n++;
        e.vx = e.facing * 220;
        AI.hit(e, {
          ox: 54, oy: -22 + n * 10, w: 84, h: 28, dmg: 7, ttl: 0.09,
          knock: [150, -50], stun: 0.16, type: 'thrust', weight: 'light'
        });
        SJ.FX.slash(e.cx() + e.facing * 58, e.cy() - 22 + n * 10,
          -0.16 * e.facing, 0.16 * e.facing, 44, { color: C.ink, w: 3, life: 0.1 });
        SJ.Audio.sfx('swing1', { vol: 0.6, rate: 1.2 });
      }
    }
  });

  M({
    id: 'b_fenshen', name: '分身', tier: 'light', learn: false,
    wind: 0.70, act: 0.16, rec: 0.50, cd: 12.0, range: [0, 620], weight: 3,
    danger: false, priority: true,
    poseW: 'castWind', poseA: 'castHit', poseR: 'idle', sfx: 'qi',
    path: function () { return [[-70, -30], [-24, -56], [24, -56], [70, -30], [0, 10], [-70, -30]]; },
    can: function (e) { return SJ.Bosses.clones(e).length === 0; },
    fire: function (e, s) {
      var n = s.data.n || (e.phase >= 3 ? 3 : 2), i;
      for (i = 0; i < n; i++) {
        var off = (i - (n - 1) / 2) * 150 + (i % 2 ? 24 : -24);
        SJ.Bosses.clone(e, e.cx() + off);
      }
      SJ.FX.ring(e.cx(), e.cy(), { r: 8, r1: 170, color: C.ink, life: 0.7, w: 2.6 });
      SJ.Game.shake(5, 0.3);
      SJ.Audio.sfx('qi', { vol: 1 });
    }
  });

  M({
    id: 'b_bianzhao', name: '遍照', tier: 'heavy', learn: false,
    wind: 0.78, act: 0.16, rec: 0.62, cd: 9.0, range: [0, 620], weight: 2.4, priority: true,
    poseW: 'atk3_wind', poseA: 'atk3_hit', poseR: 'atk3_rec', sfx: 'draw',
    // 本体与所有分身同时起手，只有一道是朱砂（danger:true）。
    // 观势看颜色，不观势只能猜。白衣的「必须观势」——它考的是「看」，不是「躲」。
    path: function () { return [[-30, -52], [22, -46], [92, -14], [140, 6]]; },
    onStart: function (e, s) {
      var cs = SJ.Bosses.clones(e), i;
      // 遍照是白衣的「必须观势」招，也是学孤影最好的一次机会：
      // 让它按孤影记进度（招式本身不叫孤影，所以要显式指定）
      s.data.moveId = 'guying';
      s.data.fake = [];
      for (i = 0; i < cs.length; i++) {
        s.data.fake.push(SJ.Combat.telegraph({
          owner: cs[i], moveId: null, dur: 0.78, danger: false,
          // 真伪之别钉在 **danger** 上，不在 tier 上，也不靠显式 color：
          // 假影 danger:false → combat.js 的 tgStyle 强制石青（守势型不吃 tier）；
          // 本体 danger:true + tier heavy → 朱砂加重。
          // 这里的 light 只是「别让假影冒充大招」的补充。
          // **谁都不许为了「统一」把假影改成 heavy，更不许给它 danger:true** ——
          // 那等于把遍照这道题的答案删掉（白衣的「必须观势」考的就是这一眼）。
          tier: 'light',
          path: [[-30, -52], [22, -46], [92, -14], [140, 6]]
        }));
        cs[i].act = 'move';
        cs[i].mimic = 0.78;
      }
      SJ.Audio.sfx('draw', { vol: 1 });
    },
    fire: function (e, s) {
      var i;
      if (s.data.fake) for (i = 0; i < s.data.fake.length; i++) s.data.fake[i].dead = true;
      var t = AI.target();
      if (t) AI.face(e, t);
      e.vx = e.facing * 520;
      s.data.hb = AI.hit(e, {
        follow: e, ox: 44, oy: -8, w: 100, h: 92, dmg: 15, ttl: 0.26,
        knock: [330, -210], stun: 0.32, type: 'slash', weight: 'heavy', guardBreak: true
      });
      SJ.FX.slash(e.cx() + e.facing * 48, e.cy() - 8,
        -1.4 * e.facing, 1.1 * e.facing, 80, { color: C.cinnabar, w: 7, life: 0.2 });
      SJ.Audio.sfx('swing3', { vol: 1 });
    },
    onEnd: function (e, s) {
      var i;
      if (s.data.hb) s.data.hb.dead = true;
      if (s.data.fake) for (i = 0; i < s.data.fake.length; i++) s.data.fake[i].dead = true;
      e.vx *= 0.3;
    }
  });

  // ── 守阁人：他的「招」全是守势 ────────────────────────────────

  M({
    id: 'b_shou', name: '守', tier: 'light', learn: false, danger: false,
    wind: 1.20, act: 0.10, rec: 1.00, cd: 0.90, range: [0, 900], weight: 1,
    poseW: 'guard', poseA: 'guard', poseR: 'guard',
    // 决议 9.1：守阁人的「起手式」就是他的守势本身。
    // moveId 固定 'wufeng' —— 观势读满一半即 +34%，三次读满即悟
    onStart: function (e, s) { s.data.moveId = 'wufeng'; },
    path: function () {
      return [[-18, -40], [18, -46], [30, -8], [10, 22], [-20, 12], [-18, -40]];
    },
    onWind: function (e, s, dt) { AI.brake(e, dt * 2); e.act = 'move'; },
    fire: function () { }
  });

  M({
    id: 'b_zhenjiao', name: '震脚', tier: 'heavy', learn: false,
    wind: 0.66, act: 0.16, rec: 0.60, cd: 5.0, range: [0, 130], weight: 1,
    poseW: 'crouch', poseA: 'land', poseR: 'guard', sfx: 'swing3', lockFace: true,
    path: function () { return [[0, -34], [10, 4], [10, 26]]; },
    // 不还手是字面意思：0 伤害。但会把你震开、打断观势、并抽走 10 点墨。
    // 第五回的压力来自墨，不来自血。
    fire: function (e) {
      AI.hit(e, {
        ox: 0, oy: 24, w: 230, h: 40, dmg: 0, ttl: 0.16,
        knock: [420, -320], stun: 0.28, type: 'blunt', weight: 'mid',
        pierce: true, maxHits: 3,
        onHit: function (target) {
          if (target === SJ.player) target.ink = Math.max(0, target.ink - 10);
        }
      });
      SJ.FX.ring(e.cx(), e.footY(), { r: 8, r1: 150, color: C.ink2, life: 0.55, w: 3 });
      SJ.FX.dust(e.cx() - 50, e.footY(), -1);
      SJ.FX.dust(e.cx() + 50, e.footY(), 1);
      SJ.Game.shake(8, 0.3);
      SJ.Audio.sfx('hitHeavy', { vol: 0.8 });
    }
  });

  M({
    id: 'b_tuibu', name: '退步', tier: 'light', learn: false, danger: false,
    wind: 0.40, act: 0.30, rec: 0.30, cd: 3.5, range: [0, 90], weight: 1.1,
    poseW: 'guard', poseA: 'walk', poseR: 'guard',
    path: function () { return [[-10, -20], [-60, -14], [-100, -10]]; },
    fire: function (e) { e.vx = -e.facing * 260; },
    onAct: function (e) { e.vx = -e.facing * 260; }
  });

  M({
    id: 'b_heshi', name: '合十', tier: 'light', learn: false, danger: false,
    wind: 0.90, act: 0.60, rec: 0.60, cd: 9.0, range: [0, 900], weight: 1.4,
    poseW: 'bow', poseA: 'bow', poseR: 'guard', sfx: 'bell',
    path: function () { return [[-14, -46], [0, -56], [14, -46], [0, -20], [-14, -46]]; },
    // 你六秒没伤到他，他就把伤养回去。读不出无锋，这场仗会倒退，但不会输。
    can: function (e) { return e.hp < e.maxHp && (SJ.Game.time - (e.mem.lastHurt || -99)) > 6; },
    fire: function (e) {
      e.hp = Math.min(e.maxHp, e.hp + 24);
      SJ.FX.ring(e.cx(), e.cy(), { r: 10, r1: 90, color: C.gamboge, life: 0.8, w: 2.4 });
      SJ.FX.burst(e.cx(), e.cy(), {
        n: 10, color: C.gamboge, speed: 90, spread: Math.PI * 2,
        life: 0.9, size: 2.4, gravity: -60, drag: 2
      });
      SJ.Audio.sfx('bell', { vol: 0.8 });
    }
  });

  // ══════════════════════════════════════════════════════════
  // Boss 定义
  // ══════════════════════════════════════════════════════════

  // 通用 Boss 大脑：按阶段取招表，维持距离，读节拍出手
  function brain(o) {
    return function (e, dt, t) {
      if (!t) { AI.brake(e, dt); return; }
      var set = e.def.sets[Math.min(e.phase, e.def.sets.length) - 1];
      if (beat(e, dt, o.lo || 0.22, o.hi || 0.6)) {
        if (o.before && o.before(e, dt, t)) return;
        var m = AI.pick(e, t, AI.moveset(e, set));
        if (m) { AI.start(e, m); return; }
      }
      var want = o.want || 100;
      if (typeof want === 'function') want = want(e, t);
      space(e, t, want, o.tol || 30, dt);
    };
  }

  var defs = {

    // ── 一回 · 雨中刀 ────────────────────────────────────────
    // 「我这一刀，练了三年。只出一次。看仔细了。」
    // 教的是「观势」这件事本身。P1 起手全部 ≥0.7s，慢到你不可能没看见。
    yuzhongdao: {
      id: 'yuzhongdao', name: '雨中刀', mass: 'mid', boss: true,
      hp: 300, speed: 150, w: 28, h: 56, weapon: 'dao', scale: 0.95, lineScale: 1.05,
      superArmor: true, knockMul: 0.45, z: 6,
      shiftSec: 1.1,
      shiftPose: 'crouch',
      phases: [0.5],
      sets: [
        ['poyu', 'k_hengzhan', 'hengyun'],
        ['poyu', 'b_sanlian', 'b_yuluo', 'hengyun']
      ],
      onPhase: function (e) { e.windMul = 0.82; e.speed = 180; },
      think: brain({ want: 110, tol: 34, lo: 0.24, hi: 0.62 })
    },

    // ── 二回 · 铁笛先生 ──────────────────────────────────────
    // 「也好。省我一句词。」远程压迫。逼你在音波之间找空隙近身。
    dizi: {
      id: 'dizi', name: '铁笛先生', mass: 'mid', boss: true,
      hp: 360, speed: 140, w: 26, h: 54, weapon: 'di', scale: 0.94, lineScale: 1.06,
      superArmor: true, knockMul: 0.4, z: 6,
      shiftSec: 1.1,
      shiftPose: 'castWind',
      phases: [0.55],
      sets: [
        ['liebo', 'b_dichui', 'b_yinbo'],
        ['liebo', 'b_dichui', 'b_yinbo', 'b_sanyin']
      ],
      onPhase: function (e) { e.windMul = 0.88; },
      // 他不想让你靠近：贴脸就后撤
      think: brain({
        lo: 0.2, hi: 0.5,
        want: function (e, t) { return AI.dist(e, t) < 90 ? 240 : 200; },
        tol: 60
      })
    },

    // ── 三回 · 渡口老翁 ──────────────────────────────────────
    // 「四十年，我渡过八百多人。回来的，一个没有。」
    // 长篙 = 超长范围。P2 的旋风扫是全游戏最长的起手式（0.85s），也是最躲不掉的一招。
    laoweng: {
      id: 'laoweng', name: '渡口老翁', mass: 'heavy', boss: true,
      hp: 400, speed: 115, w: 30, h: 58, weapon: 'gan', scale: 1.0,
      superArmor: true, knockMul: 0.35, z: 6,
      shiftSec: 1.2,
      shiftPose: 'guard',
      phases: [0.55],
      sets: [
        ['b_hengsao', 'b_dianshui', 'chengtian'],
        ['b_hengsao', 'b_dianshui', 'chengtian', 'b_langtou', 'b_xuanfeng']
      ],
      onPhase: function (e) { e.windMul = 0.9; },
      think: brain({ want: 148, tol: 28, lo: 0.26, hi: 0.62 })
    },

    // ── 四回 · 白衣 ──────────────────────────────────────────
    // 「快到你看见的时候，我已经走了。」三阶段：快剑 → 分身 → 遍照
    baiyi: {
      id: 'baiyi', name: '白衣', mass: 'light', boss: true,
      hp: 380, speed: 210, w: 26, h: 54, weapon: 'jian', scale: 0.92, lineScale: 1.09,
      color: '#35322c', superArmor: true, knockMul: 0.5, z: 6,
      shiftSec: 1.0,
      shiftPose: 'observe',
      phases: [0.62, 0.30],
      sets: [
        ['b_kuaijian', 'guying', 'k_hengzhan'],
        ['b_kuaijian', 'guying', 'b_fenshen', 'k_hengzhan'],
        ['b_kuaijian', 'guying', 'b_fenshen', 'b_bianzhao']
      ],
      onPhase: function (e, n) {
        e.windMul = n >= 3 ? 0.86 : 0.94;
        e.speed = 210 + n * 24;
        if (n >= 2) AI.cool(e, 'b_fenshen', 0.4);
      },
      onDown: function (e) { SJ.Bosses.clearClones(e); },
      think: brain({ want: 120, tol: 44, lo: 0.18, hi: 0.46 })
    },

    // 白衣的影 —— 一击即散。砍中的可能不是本体。
    baiyi_ying: {
      id: 'baiyi_ying', name: '影', mass: 'light', hp: 1, speed: 210, w: 26, h: 54,
      weapon: 'jian', scale: 0.92, lineScale: 1.09, z: 4, staggerMax: 99, knockMul: 0,
      moves: ['b_kuaijian'],
      init: function (e) { e.alpha = 0.55; e.life = 9; },
      onDown: function (e) {
        SJ.FX.burst(e.cx(), e.cy(), {
          n: 16, color: C.ink, speed: 200, spread: Math.PI * 2,
          life: 0.55, size: 2.6, gravity: 0, drag: 3
        });
        SJ.Audio.sfx('qi', { vol: 0.6 });
        SJ.Ent.remove(e);
      },
      think: function (e, dt, t) {
        e.life -= dt;
        if (e.life <= 0) { e.def.onDown(e); return; }
        if (e.mimic > 0) { e.mimic -= dt; AI.brake(e, dt); if (t) AI.face(e, t); return; }
        if (!t) { AI.brake(e, dt); return; }
        // 影自己排队：同时最多一个影在出手。三个影一起扑上来
        // 会把画面变成一堆朱砂虚线，观势就读不出东西了。
        var busy = SJ.Bosses.clones(e.host).some(function (c) { return c !== e && c.mv; });
        if (!busy && beat(e, dt, 0.3, 0.9)) {
          var m = AI.pick(e, t, AI.moveset(e, e.def.moves));
          if (m) { AI.start(e, m); return; }
        }
        space(e, t, 110, 40, dt);
      }
    },

    // ── 五回 · 守阁人 ────────────────────────────────────────
    // 「我不还手。还手的，都写进去了。」
    // 全游戏唯一一个「观势一个防御动作」的设计（DESIGN §9.1）。
    // 他不出伤害。压力来自墨：震脚抽墨、合十回血。读不出无锋 = 僵持，不会死。
    shouge: {
      id: 'shouge', name: '守阁人', mass: 'heavy', boss: true,
      hp: 320, speed: 84, w: 32, h: 58, weapon: null, scale: 1.02, lineScale: 1.2,
      superArmor: true, knockMul: 0.18, z: 6,
      guardPose: 'guard',
      shiftSec: 1.0,
      shiftPose: 'bow',
      phases: [0.68, 0.34],
      sets: [
        ['b_shou', 'b_tuibu'],
        ['b_shou', 'b_tuibu', 'b_zhenjiao'],
        ['b_shou', 'b_tuibu', 'b_zhenjiao', 'b_heshi']
      ],
      init: function (e) { e.openT = 0; e.mem.lastHurt = -99; e.mem.since = SJ.Game.time; },
      onPhase: function (e, n) { if (n >= 2) e.windMul = 0.85; },
      // 只认无锋。普攻第三段的 guardBreak 在他身上不管用 —— 僧人是提示，他是墙。
      block: function (e, dmg, src, opt) {
        if (e.openT > 0) return dmg;
        if (opt.moveId === 'wufeng') {
          e.openT = 2.6;
          e.mem.since = SJ.Game.time;      // 读懂了，线索退回常态
          AI.interrupt(e);
          e.stunT = Math.max(e.stunT, 0.8);
          e.act = 'stun';
          SJ.Game.slowmo(0, 0.14);
          SJ.Game.slowmo(0.3, 0.4);
          SJ.Game.shake(10, 0.4);
          SJ.Game.flash(C.gamboge, 0.3, 0.3);
          SJ.FX.ring(e.cx(), e.cy(), { r: 10, r1: 160, color: C.gamboge, life: 0.8, w: 3.4 });
          SJ.Audio.sfx('learn', { vol: 0.8 });
          return dmg;
        }
        SJ.FX.ring(e.cx() + e.facing * 14, e.cy() - 6,
          { r: 6, r1: 50, color: C.stone, life: 0.3, w: 2.6 });
        SJ.FX.burst(e.cx() + e.facing * 16, e.cy() - 6, {
          n: 4, color: C.stone, speed: 150, spread: 1.6,
          angle: e.facing > 0 ? 0 : Math.PI, life: 0.34, size: 2.2
        });
        SJ.Audio.sfx('block', { vol: 1 });
        SJ.Game.slowmo(0, 0.035);
        return true;
      },
      onHurt: function (e) { e.mem.lastHurt = SJ.Game.time; },
      // 决议 008 §3：僵持久了要**把线索变清楚**，不是把伤害变高。
      // 这是不做教程的游戏里唯一正当的引导手段 ——
      // 玩家不会觉得被教了，只会觉得自己终于看见了。
      // 0 级 常态 / 1 级 40s 起 / 2 级 70s 起：守势起手式越留越久，
      // 身上浮起藤黄（本作里「领悟」的颜色），把眼睛引到他身上。
      // 用 SJ.Game.time 而不是在 think 里累加 —— 他大部分时间都在守势这个「招」里，
      // think 根本不跑，累加出来的时间只有真实的三成。
      // 观势期间 Game.time 走 0.35×，所以**正在观势的玩家不会被催**：
      // 他做的正是对的事，二十来秒就能读满。
      esc: function (e) {
        var st = SJ.Game.time - (e.mem.since || 0);
        return st > 70 ? 2 : st > 40 ? 1 : 0;
      },
      think: function (e, dt, t) {
        e.openT = Math.max(0, e.openT - dt);
        if (!t) { AI.brake(e, dt); e.act = 'guard'; return; }
        AI.face(e, t);
        // 被撬开的两秒多是唯一的输出窗口：他手垂着，不架防
        if (e.openT > 0) { AI.brake(e, dt); e.act = 'idle'; return; }
        if (beat(e, dt, 0.2, 0.5)) {
          var m = AI.pick(e, t, AI.moveset(e, e.def.sets[Math.min(e.phase, 3) - 1]));
          if (m) {
            var k = e.def.esc(e);
            AI.start(e, m, m.id === 'b_shou' && k
              ? { wind: 1.2 * (1 + k * 0.42) } : null);
            if (k) e.cds.b_shou = 0.35;      // 线索也要来得更密
            return;
          }
        }
        AI.brake(e, dt);
        e.act = 'guard';
      },
      draw: function (g, e) {
        var k = e.def.esc(e);
        if (k && e.act !== 'down') {
          var pu = 0.5 + 0.5 * Math.sin(SJ.Game.time * 2.2);
          g.save();
          g.globalAlpha = (0.10 + 0.07 * k) * (0.55 + 0.45 * pu);
          SJ.Ink.blob(g, e.cx(), e.cy(), 46 + k * 10 + pu * 4, 31,
            { color: C.gamboge, alpha: 1 });
          g.restore();
        }
        AI.draw(g, e);
      }
    },

    // ── 六回 · 师兄 ──────────────────────────────────────────
    // 「这个故事要有个结局。你死了，它才算数。」
    // P3 现学玩家用过的招，并以 moveId:'shuojian' 打出来 ——
    // 玩家格开自己的招，就学会了「说剑」。
    shixiong: {
      id: 'shixiong', name: '师兄', mass: 'mid', boss: true,
      hp: 520, speed: 180, w: 28, h: 56, weapon: 'jian', scale: 0.97, lineScale: 1.03,
      superArmor: true, knockMul: 0.35, z: 6,
      shiftSec: 1.3,
      shiftPose: 'castWind',
      phases: [0.66, 0.33],
      sets: [
        ['poyu', 'k_hengzhan', 'hengyun', 'b_sanlian'],
        ['poyu', 'hengyun', 'b_sanlian', 'guying', 'zhenshan'],
        ['hengyun', 'b_sanlian', 'guying', 'b_kuaijian', 'zhenshan']
      ],
      init: function (e) { e.mem.copyCd = 0; },
      onPhase: function (e, n) { e.windMul = n === 3 ? 0.86 : n === 2 ? 0.92 : 1; },
      think: function (e, dt, t) {
        e.mem.copyCd -= dt;
        if (!t) { AI.brake(e, dt); return; }

        // P3：现学。你使一次，他就见过一次。
        // 决议 008 §1：唯一的来源是 combat.js 的 SJ.Combat.lastPlayerMove
        //（创建 hitbox 时即记录，所以挥空也算「他见过」）。
        if (e.phase >= 3 && e.mem.copyCd <= 0) {
          var id = SJ.Combat.lastPlayerMove, m = id && AI.moves[id];
          if (m && AI.dist(e, t) < 460 && !AI.playerBusy()) {
            e.mem.copyCd = 5.5;
            SJ.Combat.lastPlayerMove = null;
            SJ.FX.word(e.cx(), e.cy() - 62, m.name, { color: C.cinnabar, life: 1.0, size: 17 });
            SJ.Audio.sfx('learn', { vol: 0.55 });
            AI.start(e, m, { moveId: 'shuojian' });
            return;
          }
        }

        if (beat(e, dt, 0.2, 0.5)) {
          var mv = AI.pick(e, t, AI.moveset(e, e.def.sets[Math.min(e.phase, 3) - 1]));
          if (mv) { AI.start(e, mv); return; }
        }
        space(e, t, 115, 36, dt);
      }
    }
  };

  // ══════════════════════════════════════════════════════════

  SJ.Bosses = {
    defs: defs,
    wave: wave,

    spawn: function (id, x, y, opts) {
      var d = defs[id];
      if (!d) { console.warn('[F] 没有这个 Boss：' + id); return null; }
      var e = AI.make(d, x, y, opts);
      e.onDefeat = null;              // 由关卡层赋值（契约）
      return e;
    },

    clone: function (owner, x) {
      var gy = SJ.World.groundAt(x, owner.y);
      // 先在本体身上生出来，再 blink 到目标位置 —— 直接按坐标 make 有可能生在墙里
      var c = AI.make(defs.baiyi_ying, owner.cx(), owner.y + owner.h,
        { facing: owner.facing });
      AI.blink(c, x - c.w / 2, (gy === null ? owner.y + owner.h : gy) - c.h);
      c.host = owner;
      c.mimic = 0;
      SJ.FX.burst(x, c.cy(), {
        n: 10, color: C.ink, speed: 160, spread: Math.PI * 2,
        life: 0.5, size: 2.4, gravity: 0, drag: 3
      });
      return c;
    },

    clones: function (owner) {
      var out = [], L = SJ.Ent.list, i;
      for (i = 0; i < L.length; i++) {
        if (!L[i].dead && L[i].id === 'baiyi_ying' && L[i].host === owner) out.push(L[i]);
      }
      return out;
    },

    clearClones: function (owner) {
      var cs = SJ.Bosses.clones(owner), i;
      for (i = 0; i < cs.length; i++) cs[i].def.onDown(cs[i]);
    },

  };

})(window.SJ = window.SJ || {});
