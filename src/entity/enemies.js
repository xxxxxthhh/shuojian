// 【F】七种杂兵 + 共享招式注册表（杂兵来源的 4 招）。
//
// 敌人是老师：玩家没有教程，只能从这些人身上学会怎么玩。
//   刀客   → 破雨    第一回起手 0.8s，慢而夸张，为的是让人第一次注意到那道朱砂虚线
//   弓手   → 穿杨    远程压制；箭是实体，可以劈掉，也可以用穿杨反弹
//   枪兵   → 镇山    下砸震地，两侧都打 —— 教「跳」
//   力士   → 连环腿  三连踢，最后一脚浮空 —— 教「别贪刀」
//   僧人   →（无）   只格挡。普攻三段带破防，破不开的人会想起「无锋」
//   刺客   →（无）   瞬移。落地后仍有 0.45s 起手 —— 瞬移本身不能是伤害
//   提灯人 →（无）   雪山照明；挥灯带火，点燃走 combat 的 type:'fire'
(function (SJ) {
  'use strict';

  var AI = SJ.AI, M = AI.def, C = SJ.C;

  // 走一步，但不走下悬崖
  function go(e, dir, spd, dt) {
    if (e.onGround && !AI.ledge(e, dir)) { AI.brake(e, dt); return false; }
    AI.walk(e, dir, spd, dt);
    return true;
  }
  AI.go = go;

  // 维持距离 want（±tol）。返回 true = 已到位
  function space(e, t, want, tol, dt) {
    var d = AI.dx(e, t), ad = Math.abs(d);
    AI.face(e, t);
    if (ad > want + tol) return go(e, d < 0 ? -1 : 1, e.speed, dt), false;
    if (ad < want - tol) return go(e, d < 0 ? 1 : -1, e.speed * 0.75, dt), false;
    AI.brake(e, dt);
    return true;
  }
  AI.space = space;

  // 想事情的节拍。别每帧都决策，否则敌人像抽风。
  function beat(e, dt, lo, hi) {
    e.think -= dt;
    if (e.think > 0) return false;
    e.think = SJ.rand(lo, hi);
    return true;
  }
  AI.beat = beat;

  // ══════════════════════════════════════════════════════════
  // 招式注册表 · 杂兵来源的四招（DESIGN §6）
  // path 相对 owner 中心，x 按 facing 镜像，y 向下为正（决议 005 §2）
  // ══════════════════════════════════════════════════════════

  M({
    id: 'poyu', name: '破雨',
    wind: 0.70, act: 0.16, rec: 0.40, cd: 1.9, range: [34, 168], weight: 1.4,
    poseW: 'atk1_wind', poseA: 'thrust', poseR: 'atk1_rec', sfx: 'draw',
    path: function () { return [[6, -10], [40, -12], [78, -10], [108, -8]]; },
    fire: function (e) {
      e.vx = e.facing * 330;
      AI.hit(e, {
        ox: 64, oy: -9, w: 96, h: 32, dmg: 9, ttl: 0.15,
        knock: [230, -90], stun: 0.22, type: 'thrust', weight: 'mid'
      });
      SJ.FX.slash(e.cx() + e.facing * 74, e.cy() - 9,
        -0.18 * e.facing, 0.18 * e.facing, 46, { color: C.ink, w: 4.4 });
      SJ.Audio.sfx('swing2', { vol: 0.85 });
    }
  });

  M({
    id: 'chuanyang', name: '穿杨',
    wind: 0.78, act: 0.10, rec: 0.52, cd: 2.6, range: [130, 520], weight: 1.6,
    poseW: 'bow', poseA: 'bow', poseR: 'idle', sfx: 'draw',
    path: function (e, s) {
      var t = AI.target(), dy = 0;
      if (t) dy = SJ.clamp((t.cy() - e.cy()) * 0.5, -60, 60);
      s.data.dy = dy;
      return [[14, -16], [110, -16 + dy * 0.4], [250, -16 + dy * 0.8], [380, -16 + dy]];
    },
    fire: function (e, s) {
      SJ.Enemies.arrow(e.cx() + e.facing * 18, e.cy() - 10, e.facing, e,
        560, (s.data.dy || 0) / 380 * 560);
      SJ.Audio.sfx('arrow', { vol: 0.9 });
    }
  });

  M({
    id: 'zhenshan', name: '镇山',
    wind: 0.80, act: 0.22, rec: 0.55, cd: 3.4, range: [0, 190], weight: 1.5,
    poseW: 'atk3_wind', poseA: 'downslash', poseR: 'atk3_rec', sfx: 'swing3',
    lockFace: true,
    // 举枪过顶 → 砸地。轨迹末端落在脚下，收束环告诉你「这里要炸」
    path: function () { return [[10, -84], [42, -58], [56, -10], [52, 24], [140, 26]]; },
    onWind: function (e, s, dt) { AI.brake(e, dt * 1.6); },
    fire: function (e) {
      // 两侧都打 —— 往后跑躲不掉，只能跳。这是枪兵教的那一件事。
      AI.hit(e, {
        ox: 0, oy: 26, w: 300, h: 38, dmg: 12, ttl: 0.20,
        knock: [280, -300], stun: 0.34, type: 'blunt', weight: 'heavy',
        launch: true, pierce: true, maxHits: 4
      });
      SJ.Game.shake(9, 0.35);
      SJ.FX.ring(e.cx(), e.footY(), { r: 8, r1: 128, color: C.ink, life: 0.5, w: 3.2 });
      SJ.FX.dust(e.cx() - 90, e.footY(), -1);
      SJ.FX.dust(e.cx() + 90, e.footY(), 1);
      SJ.FX.burst(e.cx(), e.footY(), {
        n: 12, color: C.inkLight, speed: 300, spread: 2.2,
        angle: -Math.PI / 2, life: 0.6, size: 3, gravity: 900
      });
      SJ.Audio.sfx('hitHeavy', { vol: 0.9 });
    }
  });

  M({
    id: 'lianhuan', name: '连环腿',
    wind: 0.65, act: 0.56, rec: 0.50, cd: 3.2, range: [0, 108], weight: 1.3,
    poseW: 'crouch', poseA: 'atk2_hit', poseR: 'atk2_rec', sfx: 'swing1',
    path: function () { return [[26, 12], [50, -12], [58, -44], [46, -72]]; },
    onStart: function (e, s) { s.data.n = 0; },
    onWind: function (e, s, dt) { AI.brake(e, dt); },
    // 三连踢：0 / 0.18 / 0.36。最后一脚浮空，接不接得住看玩家
    onAct: function (e, s) {
      var stamp = [0, 0.18, 0.36], n = s.data.n;
      if (n < 3 && s.t >= stamp[n]) {
        s.data.n++;
        var last = n === 2;
        e.vx = e.facing * (last ? 190 : 110);
        AI.hit(e, {
          ox: 40, oy: -6 - n * 12, w: 66, h: 34,
          dmg: last ? 11 : 7, ttl: 0.11,
          knock: last ? [210, -430] : [150, -40], stun: 0.2,
          type: 'blunt', weight: last ? 'heavy' : 'light', launch: last
        });
        SJ.FX.slash(e.cx() + e.facing * 44, e.cy() - 6 - n * 12,
          0.6 * e.facing, -0.6 * e.facing, 30 + n * 6, { color: C.ink, w: 3.4 });
        SJ.Audio.sfx(last ? 'swing3' : 'swing1', { vol: 0.75 });
      }
    }
  });

  // ── 杂兵专用招（learn:false → 观势读不出招名，只是威胁）──────────

  M({
    id: 'k_hengzhan', name: '横斩', learn: false,
    wind: 0.58, act: 0.13, rec: 0.34, cd: 2.2, range: [0, 96], weight: 1,
    poseW: 'atk2_wind', poseA: 'atk2_hit', poseR: 'atk2_rec', sfx: 'swing1',
    path: function () { return [[-28, -46], [8, -58], [50, -34], [72, 4]]; },
    fire: function (e) {
      AI.hit(e, {
        ox: 40, oy: -8, w: 76, h: 52, dmg: 8, ttl: 0.13,
        knock: [200, -110], stun: 0.2, type: 'slash', weight: 'light'
      });
      SJ.FX.slash(e.cx() + e.facing * 40, e.cy() - 8,
        -1.2 * e.facing, 0.9 * e.facing, 44, { color: C.ink, w: 4 });
      SJ.Audio.sfx('swing1', { vol: 0.8 });
    }
  });

  M({
    id: 'k_ci', name: '直刺', learn: false,
    wind: 0.55, act: 0.14, rec: 0.40, cd: 2.0, range: [60, 200], weight: 1.2,
    poseW: 'atk1_wind', poseA: 'thrust', poseR: 'atk1_rec', sfx: 'swing2',
    path: function () { return [[10, -14], [70, -14], [142, -12]]; },
    fire: function (e) {
      AI.hit(e, {
        ox: 84, oy: -12, w: 136, h: 26, dmg: 8, ttl: 0.14,
        knock: [240, -60], stun: 0.2, type: 'thrust', weight: 'mid'
      });
      SJ.FX.slash(e.cx() + e.facing * 96, e.cy() - 12,
        -0.12 * e.facing, 0.12 * e.facing, 56, { color: C.ink, w: 3.6 });
    }
  });

  M({
    id: 'k_zhuang', name: '冲撞', learn: false,
    wind: 0.62, act: 0.50, rec: 0.48, cd: 4.0, range: [90, 340], weight: 1.1,
    poseW: 'crouch', poseA: 'run', poseR: 'land', sfx: 'swing3', lockFace: true,
    path: function () { return [[20, 0], [110, -6], [210, -2]]; },
    fire: function (e, s) {
      e.vx = e.facing * 430;
      s.data.hb = AI.hit(e, {
        follow: e, ox: 20, oy: 0, w: 50, h: 52, dmg: 11, ttl: 0.52,
        knock: [340, -180], stun: 0.30, type: 'blunt', weight: 'heavy'
      });
      SJ.Audio.sfx('dash', { vol: 1 });
    },
    // 冲锋一旦真的停下（崖边刹车 / 撞墙 —— World.moveX 会把 vx 归零），
    // **必须同时杀掉 hitbox**。只置 s.t=99 的话人已经站住了，
    // 判定还会跟着后摇再活半秒，玩家会被一个看上去早就结束的动作打中。
    onAct: function (e, s, dt) {
      var moved = s.data.px === undefined ? 99 : Math.abs(e.x - s.data.px);
      s.data.px = e.x;
      if (!AI.ledge(e, e.facing) || (s.t > 0.02 && moved < 1.5)) {
        s.t = 99;
        e.vx = 0;
        if (s.data.hb) { s.data.hb.dead = true; s.data.hb = null; }
        SJ.FX.dust(e.cx(), e.footY(), -e.facing);
        SJ.Game.shake(3, 0.12);
        return;
      }
      e.vx = e.facing * 430;
      SJ.FX.dust(e.cx() - e.facing * 14, e.footY(), -e.facing);
    },
    onEnd: function (e, s) { if (s.data.hb) s.data.hb.dead = true; e.vx *= 0.2; }
  });

  M({
    id: 'k_fanji', name: '反手掌', learn: false,
    wind: 0.50, act: 0.12, rec: 0.46, cd: 3.0, range: [0, 84], weight: 1,
    poseW: 'guard', poseA: 'atk1_hit', poseR: 'atk1_rec', sfx: 'swing1',
    path: function () { return [[-10, -30], [22, -34], [58, -22]]; },
    fire: function (e) {
      AI.hit(e, {
        ox: 44, oy: -20, w: 62, h: 42, dmg: 10, ttl: 0.12,
        knock: [330, -170], stun: 0.26, type: 'blunt', weight: 'mid'
      });
      SJ.FX.ring(e.cx() + e.facing * 44, e.cy() - 20,
        { r: 6, r1: 52, color: C.ink, life: 0.3, w: 2.4 });
    }
  });

  M({
    id: 'k_shan', name: '闪', learn: false,
    wind: 0.52, act: 0.14, rec: 0.44, cd: 3.6, range: [0, 460], weight: 1.4,
    poseW: 'atk1_wind', poseA: 'thrust', poseR: 'atk1_rec', ground: false,
    path: function () { return [[4, -10], [46, -12], [92, -10]]; },
    // 瞬移在起手式之前发生。落地后仍有 0.46s 让玩家读 ——
    // 「瞬移到你背后立刻捅你」是全游戏最容易做成不公平的一招。
    onStart: function (e) {
      var t = AI.target();
      AI.figure(e);
      SJ.FX.trail(e, { life: 0.45, alpha: 0.34, color: C.ink });
      SJ.FX.burst(e.cx(), e.cy(), {
        n: 12, color: C.ink, speed: 190, spread: Math.PI * 2,
        life: 0.42, size: 2.6, gravity: 0, drag: 3.4
      });
      if (t) {
        var nx = t.cx() - t.facing * 54;
        var gy = SJ.World.groundAt(nx, t.y);
        if (gy !== null && gy - t.y < 200) {
          e.x = nx - e.w / 2; e.y = gy - e.h;
          e.vx = 0; e.vy = 0; e.onGround = true;
        }
        AI.face(e, t);
      }
      SJ.FX.burst(e.cx(), e.cy(), {
        n: 10, color: C.ink, speed: 150, spread: Math.PI * 2,
        life: 0.35, size: 2.2, gravity: 0, drag: 4
      });
      SJ.Audio.sfx('dash', { vol: 0.85 });
    },
    fire: function (e) {
      e.vx = e.facing * 260;
      AI.hit(e, {
        ox: 52, oy: -10, w: 78, h: 30, dmg: 10, ttl: 0.13,
        knock: [230, -110], stun: 0.24, type: 'thrust', weight: 'mid'
      });
      SJ.FX.slash(e.cx() + e.facing * 58, e.cy() - 10,
        -0.2 * e.facing, 0.2 * e.facing, 40, { color: C.ink, w: 4 });
      SJ.Audio.sfx('swing2', { vol: 0.9 });
    }
  });

  M({
    id: 'k_denghuo', name: '灯火', learn: false,
    wind: 0.60, act: 0.16, rec: 0.46, cd: 2.8, range: [0, 120], weight: 1,
    poseW: 'atk2_wind', poseA: 'atk2_hit', poseR: 'atk2_rec', sfx: 'fire',
    color: '#c8a55b',
    path: function () { return [[-24, -34], [14, -50], [56, -30], [76, 2]]; },
    fire: function (e) {
      // 点燃 DoT 在 combat.js（决议 005 §4）。这里只负责传 type:'fire'
      AI.hit(e, {
        ox: 46, oy: -10, w: 84, h: 54, dmg: 7, ttl: 0.16,
        knock: [190, -110], stun: 0.2, type: 'fire', weight: 'mid'
      });
      SJ.FX.burst(e.cx() + e.facing * 46, e.cy() - 10, {
        n: 12, color: C.gamboge, speed: 190, spread: 2.0,
        angle: e.facing > 0 ? 0 : Math.PI, life: 0.55, size: 3, gravity: -180, drag: 2
      });
      SJ.Audio.sfx('fire', { vol: 0.9 });
    }
  });

  // ══════════════════════════════════════════════════════════
  // 箭（实体，不是 hitbox —— hitbox 没有速度，也挨不了打）
  // 可以被劈掉；被「穿杨」打中则反弹，这就是穿杨的全部实现
  // ══════════════════════════════════════════════════════════

  function arrow(x, y, dir, owner, vx, vy) {
    var a = {
      tag: 'arrow', team: 'foe', z: 6,
      x: x - 10, y: y - 3, w: 20, h: 6,
      vx: dir * Math.abs(vx || 560), vy: vy || 0,
      facing: dir, hp: 1, maxHp: 1, life: 3.2,
      from: owner, hb: null, dead: false, invuln: 0
    };
    a.cx = function () { return this.x + this.w / 2; };
    a.cy = function () { return this.y + this.h / 2; };

    a.hurt = function (dmg, src, opt) {
      opt = opt || {};
      if (this.hp <= 0) return;
      // 穿杨 / 气劲 → 反弹。别的（普攻）→ 劈断
      if (opt.moveId === 'chuanyang' || opt.type === 'qi') {
        var self = this;
        this.vx = -this.vx * 1.4;
        this.vy = -this.vy * 1.4;
        this.facing = -this.facing;
        this.team = 'player';
        this.from = src || SJ.player;
        this.life = Math.max(this.life, 2.2);
        if (this.hb) this.hb.dead = true;
        this.hb = SJ.Combat.hit({
          follow: this, ox: 0, oy: 0, w: this.w, h: this.h,
          dmg: 17, team: 'player', owner: this.from, ttl: 2.2,
          knock: [260, -90], stun: 0.32, type: 'thrust', weight: 'mid',
          moveId: 'chuanyang', ink: 4,
          onHit: function () { self.hp = 0; }
        });
        SJ.FX.ring(this.cx(), this.cy(),
          { r: 4, r1: 46, color: C.cinnabar, life: 0.32, w: 2.4 });
        SJ.Audio.sfx('parry', { vol: 0.75 });
        return;
      }
      this.hp = 0;
    };

    a.update = function (dt) {
      if (this.hp <= 0) { kill(this); return; }
      this.life -= dt;
      this.vy += 90 * dt;                        // 一点点垂坠就够；重了会在半路插进地里
      var blocked = SJ.World.moveX(this, this.vx * dt);
      if (!blocked) blocked = SJ.World.moveY(this, this.vy * dt);
      if (blocked || this.life <= 0) { kill(this); return; }
      this.facing = this.vx < 0 ? -1 : 1;
    };

    a.draw = function (g) {
      var ang = Math.atan2(this.vy, this.vx);
      var L = 22, cx = this.cx(), cy = this.cy();
      var x0 = cx - Math.cos(ang) * L * 0.6, y0 = cy - Math.sin(ang) * L * 0.6;
      var x1 = cx + Math.cos(ang) * L * 0.4, y1 = cy + Math.sin(ang) * L * 0.4;
      var col = this.team === 'player' ? C.cinnabar : C.ink;
      SJ.Ink.stroke(g, [[x0, y0], [x1, y1]],
        { w0: 1.2, w1: 2.6, color: col, alpha: 0.9, seed: 3, taper: false });
      SJ.Ink.stroke(g, [[x0 - Math.cos(ang) * 5 - Math.sin(ang) * 4,
                         y0 - Math.sin(ang) * 5 + Math.cos(ang) * 4],
                        [x0, y0],
                        [x0 - Math.cos(ang) * 5 + Math.sin(ang) * 4,
                         y0 - Math.sin(ang) * 5 - Math.cos(ang) * 4]],
        { w0: 1.6, w1: 0.5, color: col, alpha: 0.6, seed: 5 });
    };

    function kill(a) {
      if (a.hb) a.hb.dead = true;
      SJ.FX.burst(a.cx(), a.cy(), {
        n: 4, color: C.ink, speed: 120, spread: Math.PI * 2,
        life: 0.3, size: 1.8, gravity: 700
      });
      SJ.Ent.remove(a);
    }

    a.hb = SJ.Combat.hit({
      follow: a, ox: 0, oy: 0, w: a.w, h: a.h,
      dmg: 10, team: 'foe', owner: owner, ttl: 3.2,
      knock: [190, -70], stun: 0.22, type: 'thrust', weight: 'light',
      moveId: 'chuanyang',
      onHit: function () { a.hp = 0; }
    });

    SJ.Ent.add(a);
    return a;
  }

  // ══════════════════════════════════════════════════════════
  // 七种杂兵
  // ══════════════════════════════════════════════════════════

  var defs = {

    // 刀客 —— 第一个会起手式的人。第一回用 windMul 1.15（破雨 0.80s）
    daoke: {
      id: 'daoke', name: '刀客', hp: 30, speed: 150, w: 26, h: 52,
      weapon: 'dao', scale: 0.86, staggerMax: 2,
      moves: ['poyu', 'k_hengzhan'],
      ai: 'melee',
      think: function (e, dt, t) {
        if (!t || !AI.sees(e, t) || AI.dist(e, t) > 460) { AI.brake(e, dt); return; }
        var d = AI.dist(e, t);
        if (AI.beat(e, dt, 0.22, 0.55)) {
          var m = AI.pick(e, t, e.def.moves);
          if (m) { AI.start(e, m); return; }
          // 打不到就调整距离：一半概率后撤，读起来像在找机会
          e.mem.back = (d < 70 && Math.random() < 0.5) ? 0.45 : 0;
        }
        if (e.mem.back > 0) { e.mem.back -= dt; go(e, AI.dx(e, t) < 0 ? 1 : -1, e.speed, dt); AI.face(e, t); }
        else space(e, t, 88, 26, dt);
      }
    },

    // 弓手 —— 远程压制。近身就后跳，逼你先处理他，或者学会反弹
    gongshou: {
      id: 'gongshou', name: '弓手', hp: 22, speed: 130, w: 24, h: 50,
      weapon: 'gong', scale: 0.84, staggerMax: 1,
      moves: ['chuanyang'],
      ai: 'ranged',
      think: function (e, dt, t) {
        if (!t) { AI.brake(e, dt); return; }
        var d = AI.dist(e, t);
        AI.face(e, t);
        if (d < 110) {
          // 被贴脸：后跳拉开，别站着送
          if (e.onGround && AI.beat(e, dt, 0.5, 0.9)) {
            AI.hop(e, -430, -AI.dx(e, t) > 0 ? 260 : -260);
            SJ.Audio.sfx('jump', { vol: 0.5 });
          }
          go(e, AI.dx(e, t) < 0 ? 1 : -1, e.speed, dt);
          return;
        }
        if (AI.beat(e, dt, 0.35, 0.8) && AI.sees(e, t)) {
          var m = AI.pick(e, t, e.def.moves);
          if (m) { AI.start(e, m); return; }
        }
        space(e, t, 300, 90, dt);
      }
    },

    // 枪兵 —— 中距离戳，逮到机会就镇山。和弓手一起出现时威胁在组合不在单体
    qiangbing: {
      id: 'qiangbing', name: '枪兵', hp: 40, speed: 120, w: 28, h: 54,
      weapon: 'qiang', scale: 0.92, staggerMax: 2, knockMul: 0.8,
      moves: ['k_ci', 'zhenshan'],
      ai: 'spacer',
      think: function (e, dt, t) {
        if (!t || !AI.sees(e, t) || AI.dist(e, t) > 520) { AI.brake(e, dt); return; }
        if (AI.beat(e, dt, 0.3, 0.7)) {
          var m = AI.pick(e, t, e.def.moves);
          if (m) { AI.start(e, m); return; }
        }
        space(e, t, 130, 34, dt);
      }
    },

    // 力士 —— 慢、重、扛揍。教「别贪刀」
    lishi: {
      id: 'lishi', name: '力士', hp: 55, speed: 98, w: 34, h: 58,
      weapon: null, scale: 1.0, lineScale: 1.25,
      staggerMax: 3, armorSec: 1.2, knockMul: 0.55,
      moves: ['lianhuan', 'k_zhuang'],
      ai: 'bruiser',
      think: function (e, dt, t) {
        if (!t || AI.dist(e, t) > 560) { AI.brake(e, dt); return; }
        if (AI.beat(e, dt, 0.3, 0.7)) {
          var m = AI.pick(e, t, e.def.moves);
          if (m) { AI.start(e, m); return; }
        }
        space(e, t, 70, 26, dt);
      }
    },

    // 僧人 —— 只格挡。正面 90% 减伤；普攻第三段的破防能撬开他，
    // 「无锋」也能。他是提示，守阁人才是墙。
    sengren: {
      id: 'sengren', name: '僧人', hp: 45, speed: 92, w: 30, h: 56,
      weapon: null, scale: 0.96, lineScale: 1.1,
      staggerMax: 3, knockMul: 0.5, guardPose: 'guard',
      moves: ['k_fanji'],
      ai: 'wall',
      init: function (e) { e.blocked = 0; e.openT = 0; },
      block: function (e, dmg, src, opt) {
        if (e.openT > 0) return dmg;                     // 已经被撬开
        var front = src ? ((src.cx ? src.cx() : src.x) - e.cx()) * e.facing > -6 : true;
        if (!front) return dmg;                          // 背后照打
        // 破防（普攻第三段）只撬开一瞬，撬完他就重新架起来 ——
        // 他得先像一堵墙，玩家才会去想别的办法。无锋撬开的是 2.6s。
        if (opt.guardBreak || opt.moveId === 'wufeng') {
          e.openT = opt.moveId === 'wufeng' ? 2.6 : 0.9;
          e.stunT = Math.max(e.stunT, 0.5);
          e.act = 'stun';
          AI.interrupt(e);
          SJ.FX.ring(e.cx(), e.cy(), { r: 8, r1: 90, color: C.cinnabar, life: 0.5, w: 3 });
          SJ.Game.slowmo(0, 0.14);
          SJ.Game.shake(8, 0.3);
          SJ.Audio.sfx('parry', { vol: 1 });
          return dmg;
        }
        // 「你打不动我」—— 姿态必须明确，不然玩家只会以为自己没打中
        e.blocked++;
        e.vx = (src && src.cx && src.cx() > e.cx() ? -1 : 1) * 40;
        SJ.FX.ring(e.cx() + e.facing * 14, e.cy() - 6,
          { r: 6, r1: 44, color: C.stone, life: 0.28, w: 2.6 });
        SJ.FX.burst(e.cx() + e.facing * 16, e.cy() - 6, {
          n: 3, color: C.stone, speed: 130, spread: 1.6,
          angle: e.facing > 0 ? 0 : Math.PI, life: 0.3, size: 2
        });
        SJ.Audio.sfx('block', { vol: 0.9 });
        SJ.Game.slowmo(0, 0.03);
        return true;
      },
      think: function (e, dt, t) {
        e.openT = Math.max(0, e.openT - dt);
        if (!t) { AI.brake(e, dt); e.act = 'guard'; return; }
        AI.face(e, t);
        // 挡够三下就还一掌，逼玩家不能无脑贴脸磨
        if (e.blocked >= 3 && AI.ready(e, 'k_fanji') && AI.dist(e, t) < 90) {
          e.blocked = 0;
          AI.start(e, 'k_fanji');
          return;
        }
        if (AI.dist(e, t) > 150) { space(e, t, 110, 40, dt); e.act = 'idle'; }
        else { AI.brake(e, dt); e.act = e.openT > 0 ? 'idle' : 'guard'; }
      }
    },

    // 刺客 —— 瞬移。挨打就闪走，闪到你背后，但落地后仍留 0.46s 起手
    cike: {
      id: 'cike', name: '刺客', hp: 24, speed: 190, w: 24, h: 50,
      weapon: 'jian', scale: 0.84, staggerMax: 1, knockMul: 1.2,
      moves: ['k_shan', 'poyu'],
      ai: 'blink',
      onHurt: function (e) {
        // 被打中有 40% 直接闪走：刺客不站桩挨揍
        if (Math.random() < 0.4) AI.cool(e, 'k_shan', 0);
      },
      think: function (e, dt, t) {
        if (!t) { AI.brake(e, dt); return; }
        if (AI.beat(e, dt, 0.25, 0.55)) {
          var m = AI.pick(e, t, e.def.moves);
          if (m) { AI.start(e, m); return; }
        }
        // 不贴脸，绕着走
        var d = AI.dist(e, t);
        if (d < 150) { go(e, AI.dx(e, t) < 0 ? 1 : -1, e.speed * 0.9, dt); AI.face(e, t); }
        else space(e, t, 190, 60, dt);
      }
    },

    // 提灯人 —— 雪山。e.light 由 G 读去做雾里的照明范围
    denglong: {
      id: 'denglong', name: '提灯人', hp: 30, speed: 96, w: 26, h: 52,
      weapon: null, scale: 0.88, staggerMax: 2,
      moves: ['k_denghuo'],
      ai: 'lamp',
      init: function (e) { e.light = { r: 168, warm: 1, x: 0, y: 0 }; },
      onDown: function (e) {
        // 灯掉了，光慢慢灭 —— 雪山里这是一句话
        e.mem.fade = 1;
      },
      think: function (e, dt, t) {
        if (!t || AI.dist(e, t) > 420) {
          // 无事时提着灯来回巡，光是关卡照明的一部分
          if (AI.beat(e, dt, 1.2, 2.4)) e.mem.dir = -(e.mem.dir || 1);
          go(e, e.mem.dir || 1, e.speed * 0.55, dt);
          return;
        }
        if (AI.beat(e, dt, 0.35, 0.8)) {
          var m = AI.pick(e, t, e.def.moves);
          if (m) { AI.start(e, m); return; }
        }
        space(e, t, 76, 26, dt);
      },
      draw: function (g, e) {
        var lx = e.cx() + e.facing * 22, ly = e.cy() - 6;
        if (e.light) {
          e.light.x = lx; e.light.y = ly;
          if (e.mem.fade !== undefined) {
            e.mem.fade = Math.max(0, e.mem.fade - 1 / 60);
            e.light.warm = e.mem.fade;
            e.light.r = 168 * e.mem.fade;
          }
        }
        SJ.Ink.lantern(g, lx, ly, 15 * (e.light ? e.light.warm : 1), SJ.Game.time + e.seed);
        AI.draw(g, e);
        // 提灯的那条胳膊：一根细线连到灯
        SJ.Ink.stroke(g, [[e.cx() + e.facing * 6, e.cy() - 16], [lx, ly - 12]],
          { w0: 2, w1: 1.2, color: C.ink, alpha: 0.8, seed: e.seed * 7 });
      }
    }
  };

  // ══════════════════════════════════════════════════════════

  SJ.Enemies = {
    defs: defs,
    arrow: arrow,

    // opts: {facing, hp, windMul}
    //   windMul 是「章节难度」旋钮：第一回 1.15（刀客破雨 0.80s），
    //   第六回 0.62（0.43s）。下限 0.35s 由 AI.start 兜底。
    spawn: function (id, x, y, opts) {
      var d = defs[id];
      if (!d) { console.warn('[F] 没有这种杂兵：' + id); return null; }
      return AI.make(d, x, y, opts);
    }
  };

})(window.SJ = window.SJ || {});
