// 【E】十二招。DESIGN §6 全表实现 + 残墨进度 + 「悟」的演出。
//
// defs 既是数组（`每条 {id,name,...}`），也按 id 挂了键，
// 所以 SJ.Tech.defs[0] 与 SJ.Tech.defs.hengyun 都能取到同一个对象。
(function (SJ) {
  'use strict';

  var running = [];        // {ent, def, st}
  var cds = {};            // id -> 剩余冷却
  var learnQueue = [];
  var learning = false;

  function P() { return SJ.player; }

  // ── 小工具 ─────────────────────────────────────────────────

  // 以施术者为中心生成一个玩家阵营 hitbox
  function box(p, o) {
    return SJ.Combat.hit({
      x: p.cx() + (o.ox || 0) * p.facing - (o.w || 60) / 2,
      y: p.cy() + (o.oy || 0) - (o.h || 40) / 2,
      w: o.w || 60, h: o.h || 40,
      dmg: o.dmg || 0, team: 'player', owner: p,
      ttl: o.ttl === undefined ? 0.10 : o.ttl,
      knock: o.knock || [200, -80],
      stun: o.stun === undefined ? 0.3 : o.stun,
      type: o.type || 'slash',
      pierce: o.pierce !== false,
      moveId: o.moveId || null,
      weight: o.weight || 'mid',
      ink: o.ink === undefined ? 4 : o.ink,
      guardBreak: !!o.guardBreak,
      launch: !!o.launch,
      burn: o.burn,
      silent: !!o.silent,
      follow: o.follow ? p : null,
      ox: o.ox || 0, oy: o.oy || 0,
      onHit: o.onHit || null
    });
  }

  function nearestFoe(p, maxD) {
    var list = SJ.Ent.list, best = null, bd = maxD || 1e9, i, e, d;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (e.dead || e.team === 'player' || !e.hurt) continue;
      if (e.hp !== undefined && e.hp <= 0) continue;
      d = Math.abs(e.cx() ? e.cx() - p.cx() : e.x - p.x);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // 剑气 / 音波：穿透型投射物
  function proj(p, o) {
    var e = {
      tag: 'proj', team: 'player', z: 8, projectile: true,
      x: p.cx() - 16, y: p.cy() + (o.oy || 0) - 8, w: 34, h: 18,
      vx: (o.speed || 620) * p.facing, vy: 0,
      facing: p.facing, hp: 1, maxHp: 1,
      life: o.life || 0.9, t: 0, owner: p,
      moveId: o.moveId, dmg: o.dmg || 12, color: o.color || SJ.C.ink,
      struck: [],
      cx: function () { return this.x + this.w / 2; },
      cy: function () { return this.y + this.h / 2; },
      hurt: function () { },
      update: function (dt) {
        this.t += dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        if (this.t >= this.life) { this.dead = true; return; }
        if (SJ.World.lineBlocked(this.cx(), this.cy(), this.cx() + this.vx * dt, this.cy())) {
          this.dead = true;
          SJ.FX.burst(this.cx(), this.cy(), {
            n: 6, color: this.color, speed: 150, spread: 2.2,
            angle: this.vx > 0 ? Math.PI : 0, life: 0.3, size: 2.4
          });
          return;
        }
        var list = SJ.Ent.list, i, t2;
        for (i = 0; i < list.length; i++) {
          t2 = list[i];
          if (t2.dead || t2.team === this.team || !t2.hurt) continue;
          if (t2.hp !== undefined && t2.hp <= 0) continue;
          if (this.struck.indexOf(t2) >= 0) continue;
          if (!SJ.aabb(this, t2)) continue;
          this.struck.push(t2);
          SJ.Combat.hit({
            x: this.x, y: this.y, w: this.w, h: this.h,
            dmg: this.dmg, team: this.team, owner: this.owner, ttl: 0.02,
            knock: [160, -60], stun: 0.28, type: 'qi', pierce: true,
            moveId: this.moveId, weight: 'mid', ink: 4
          });
        }
      },
      draw: function (g) {
        var k = 1 - this.t / this.life, i;
        for (i = 0; i < 3; i++) {
          var off = i * 16 * (this.vx > 0 ? -1 : 1);
          SJ.Ink.stroke(g, [
            [this.cx() + off - this.facing * 22, this.cy() - 7 + i * 6],
            [this.cx() + off + this.facing * 22, this.cy() + 1 + i * 4]
          ], {
            w0: 4.6 - i * 1.2, w1: 0.5, color: this.color,
            alpha: (0.34 + 0.5 * k) * (1 - i * 0.24), seed: i * 9 + 3, wobble: 1.2
          });
        }
      }
    };
    return SJ.Ent.add(e);
  }

  function cast(p, pose) { p.castPose = pose; p.setState('cast'); }

  function inSolid(x, y, w, h) {
    var s = SJ.World.solids, i, b;
    for (i = 0; i < s.length; i++) {
      b = s[i];
      if (b.gone || b.oneway) continue;
      if (x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y) return true;
    }
    return false;
  }

  // 瞬移落点安全化：孤影/说剑穿到墙里会把玩家卡死，
  // 落点被占就沿原路往回退，退不出来就原地不动。
  function blink(p, tx, ty) {
    var ox = p.x, oy = p.y, i, k, x, y;
    for (i = 0; i <= 6; i++) {
      k = 1 - i / 6;
      x = ox + (tx - ox) * k;
      y = oy + (ty - oy) * k;
      if (!inSolid(x, y, p.w, p.h)) { p.x = x; p.y = y; return true; }
    }
    return false;
  }

  // ── 十二招 ─────────────────────────────────────────────────

  var defs = [

    // 雨中刀 · 前冲斩，破防，命中回墨多
    { id: 'hengyun', name: '横云断', from: '雨中刀', cost: 20, cd: 0.70,
      desc: '前冲一斩，横云断岭。破防，命中回墨极多。',
      exec: function (p, st, dt) {
        st.t = (st.t || 0) + dt;
        if (!st.ph) {
          cast(p, 'castWind'); st.ph = 1; st.t = 0; st.noGravity = false;
          p.vx *= 0.2;
          SJ.Audio.sfx('draw', { vol: 0.9 });
        }
        if (st.ph === 1) {                                   // 前摇 0.14
          p.vx *= Math.pow(0.02, dt);
          if (st.t >= 0.14) {
            st.ph = 2; st.t = 0; st.noGravity = true;
            cast(p, 'atk3_hit');
            st.hb = box(p, {
              w: 78, h: 46, ox: 40, oy: -2, dmg: 18, ttl: 0.22, follow: true,
              knock: [330, -140], stun: 0.5, weight: 'heavy', ink: 12,
              guardBreak: true, pierce: true, moveId: 'hengyun'
            });
            SJ.Audio.sfx('swing3', { vol: 1, rate: 0.92 });
            SJ.Game.shake(3.5, 0.14);
          }
        } else if (st.ph === 2) {                            // 冲刺判定 0.22
          p.vx = p.facing * 560; p.vy = 0;
          st.trail = (st.trail || 0) + dt;
          if (st.trail > 0.03) {
            st.trail = 0;
            SJ.FX.trail(p, { life: 0.24, alpha: 0.26, color: SJ.C.ink });
            SJ.FX.slash(p.cx() + p.facing * 34, p.cy(), -1.1 * p.facing, 0.9 * p.facing,
              38, { color: SJ.C.ink, w: 6, life: 0.14 });
          }
          if (st.t >= 0.22) { st.ph = 3; st.t = 0; st.noGravity = false; p.vx *= 0.3; cast(p, 'atk3_rec'); }
        } else {
          p.vx *= Math.pow(0.05, dt);
          if (st.t >= 0.16) return true;
        }
        return false;
      } },

    // 铁笛先生 · 音波剑气，穿透，远程
    { id: 'liebo', name: '裂帛', from: '铁笛先生', cost: 25, cd: 0.90,
      desc: '一道音波剑气破空而去，穿透众敌。',
      exec: function (p, st, dt) {
        st.t = (st.t || 0) + dt;
        if (!st.ph) { cast(p, 'castWind'); st.ph = 1; st.t = 0; p.vx *= 0.3; }
        if (st.ph === 1) {
          p.vx *= Math.pow(0.05, dt);
          if (st.t >= 0.16) {
            st.ph = 2; st.t = 0;
            cast(p, 'castHit');
            proj(p, { dmg: 12, speed: 660, life: 1.0, moveId: 'liebo', oy: -4 });
            SJ.Audio.sfx('qi', { vol: 1, rate: 1.15 });
            SJ.Game.shake(3, 0.14);
            SJ.Game.slowmo(0, 0.05);
            SJ.FX.ring(p.cx() + p.facing * 26, p.cy(), { r: 6, r1: 54, color: SJ.C.ink, life: 0.3 });
            p.vx = -p.facing * 90;                            // 后坐
          }
        } else {
          p.vx *= Math.pow(0.05, dt);
          if (st.t >= 0.20) return true;
        }
        return false;
      } },

    // 渡口老翁 · 上挑，把敌人挑起，可接空连
    { id: 'chengtian', name: '撑天', from: '渡口老翁', cost: 22, cd: 0.80,
      desc: '一篙撑天，把人挑上去。挑起后可以接空中连段。',
      exec: function (p, st, dt) {
        st.t = (st.t || 0) + dt;
        if (!st.ph) { cast(p, 'upslash'); st.ph = 1; st.t = 0; p.vx *= 0.3; }
        if (st.ph === 1) {
          if (st.t >= 0.10) {
            st.ph = 2; st.t = 0;
            p.vy = -300;
            box(p, {
              w: 74, h: 88, ox: 38, oy: -26, dmg: 12, ttl: 0.14,
              knock: [110, -640], stun: 0.55, weight: 'mid', ink: 6,
              launch: true, pierce: true, moveId: 'chengtian'
            });
            SJ.FX.slash(p.cx() + p.facing * 28, p.cy() - 18,
              1.6 * p.facing, -0.4 * p.facing, 52, { color: SJ.C.ink, w: 6.5, life: 0.18 });
            SJ.Audio.sfx('swing2', { vol: 0.95, rate: 0.88 });
            SJ.Game.shake(4, 0.16);
          }
        } else {
          if (st.t >= 0.24) return true;
        }
        return false;
      } },

    // 白衣 · 留残影原地，本体瞬移到身后
    { id: 'guying', name: '孤影', from: '白衣', cost: 30, cd: 1.00,
      desc: '留一道残影在原地，人已经在他身后了。',
      exec: function (p, st, dt) {
        st.t = (st.t || 0) + dt;
        if (!st.ph) {
          cast(p, 'observe'); st.ph = 1; st.t = 0; st.noGravity = true;
          p.vx = 0; p.vy = 0;
          SJ.Audio.sfx('dash', { vol: 0.8, rate: 0.8 });
        }
        if (st.ph === 1) {
          if (st.t >= 0.07) {
            st.ph = 2; st.t = 0;
            // 残影留在原地
            for (var i = 0; i < 4; i++) SJ.FX.trail(p, { life: 0.5 + i * 0.06, alpha: 0.30, color: SJ.C.ink });
            SJ.FX.ring(p.cx(), p.cy(), { r: 6, r1: 60, color: SJ.C.inkLight, life: 0.4 });

            var foe = nearestFoe(p, 340);
            if (foe) {
              var side = p.cx() < foe.cx() ? 1 : -1;          // 穿过去，落到他背后
              blink(p, foe.cx() + side * 42 - p.w / 2, foe.cy() - p.h / 2);
              p.facing = -side;
            } else {
              blink(p, p.x + p.facing * 170, p.y);
            }
            p.invuln = Math.max(p.invuln, 0.30);
            p.vy = -120;
            SJ.FX.ring(p.cx(), p.cy(), { r: 4, r1: 46, color: SJ.C.ink, life: 0.32 });
            SJ.FX.burst(p.cx(), p.cy(), {
              n: 10, color: SJ.C.ink, speed: 180, spread: Math.PI * 2, life: 0.4, size: 2.4
            });
            SJ.Game.slowmo(0, 0.06);
            cast(p, 'dashF');
          }
        } else {
          st.noGravity = false;
          if (st.t >= 0.14) return true;
        }
        return false;
      } },

    // 守阁人 · 不造成伤害，清空对方格挡与硬直
    { id: 'wufeng', name: '无锋', from: '守阁人', cost: 18, cd: 0.80,
      desc: '不伤人。一记无锋，把他架起来的势卸掉。',
      exec: function (p, st, dt) {
        st.t = (st.t || 0) + dt;
        if (!st.ph) { cast(p, 'thrust'); st.ph = 1; st.t = 0; p.vx *= 0.3; }
        if (st.ph === 1) {
          if (st.t >= 0.12) {
            st.ph = 2; st.t = 0;
            cast(p, 'castHit');
            box(p, {
              w: 96, h: 64, ox: 48, oy: -2, dmg: 0, ttl: 0.14,
              knock: [40, 0], stun: 1.2, type: 'qi', weight: 'light',
              ink: 8, guardBreak: true, pierce: true, silent: true, moveId: 'wufeng',
              onHit: function (t) {
                t.guard = false;
                t.guarding = false;
                t.guardBroken = true;
                t.blocking = false;
                SJ.FX.ring(t.cx(), t.cy(), { r: 10, r1: 88, color: SJ.C.stone, life: 0.5, w: 3 });
                SJ.FX.burst(t.cx(), t.cy(), {
                  n: 10, color: SJ.C.stone, speed: 210, spread: Math.PI * 2, life: 0.5, size: 2.6
                });
                SJ.Game.slowmo(0, 0.14);
                SJ.Game.shake(7, 0.24);
                SJ.Audio.sfx('block', { vol: 1, rate: 0.8 });
              }
            });
            SJ.Audio.sfx('swing1', { vol: 0.7, rate: 0.75 });
          }
        } else {
          if (st.t >= 0.18) return true;
        }
        return false;
      } },

    // 力士 · 三连踢，浮空
    { id: 'lianhuan', name: '连环腿', from: '力士', cost: 15, cd: 0.70,
      desc: '三连踢，最后一脚把人踢上天。',
      exec: function (p, st, dt) {
        st.t = (st.t || 0) + dt;
        if (!st.n) { st.n = 0; st.next = 0.06; cast(p, 'atk2_wind'); p.vx *= 0.4; }
        p.vx = p.facing * (st.n < 3 ? 130 : 40);
        if (st.n < 3 && st.t >= st.next) {
          var last = st.n === 2;
          box(p, {
            w: 60, h: 36, ox: 38, oy: last ? -16 : (st.n === 0 ? 6 : -4),
            dmg: last ? 8 : 5, ttl: 0.09,
            knock: last ? [180, -520] : [140, -40], stun: 0.24,
            type: 'blunt', weight: last ? 'mid' : 'light', ink: 4,
            launch: last, pierce: true, moveId: 'lianhuan'
          });
          SJ.FX.slash(p.cx() + p.facing * 32, p.cy() + (last ? -16 : 2),
            (last ? 1.4 : -0.6) * p.facing, (last ? -0.4 : 0.8) * p.facing,
            30, { color: SJ.C.ink, w: 3.6 + st.n, life: 0.11 });
          SJ.Audio.sfx(last ? 'swing3' : 'swing1', { vol: 0.7 + st.n * 0.12, rate: 1.1 + st.n * 0.1 });
          cast(p, last ? 'atk3_hit' : 'atk2_hit');
          if (last) { p.vy = -230; SJ.Game.shake(4, 0.16); }
          st.n++;
          st.next = st.t + 0.10;
        }
        if (st.n >= 3 && st.t >= st.next + 0.14) return true;
        return false;
      } },

    // 刀客 · 短距突刺，起手快
    { id: 'poyu', name: '破雨', from: '刀客', cost: 12, cd: 0.45,
      desc: '起手最快的一刺。距离短，但先手永远是你的。',
      exec: function (p, st, dt) {
        st.t = (st.t || 0) + dt;
        if (!st.ph) { cast(p, 'thrust'); st.ph = 1; st.t = 0; }
        if (st.ph === 1) {
          if (st.t >= 0.05) {                                 // 前摇极短
            st.ph = 2; st.t = 0; st.noGravity = true;
            box(p, {
              w: 72, h: 22, ox: 44, oy: 0, dmg: 10, ttl: 0.12, follow: true,
              knock: [230, -50], stun: 0.3, type: 'thrust',
              weight: 'mid', ink: 6, pierce: true, moveId: 'poyu'
            });
            SJ.FX.slash(p.cx() + p.facing * 46, p.cy(), -0.15 * p.facing, 0.15 * p.facing,
              46, { color: SJ.C.ink, w: 4.5, life: 0.12 });
            SJ.Audio.sfx('swing1', { vol: 0.9, rate: 1.25 });
          }
        } else if (st.ph === 2) {
          p.vx = p.facing * 620; p.vy = 0;
          if (st.t >= 0.12) { st.ph = 3; st.t = 0; st.noGravity = false; p.vx *= 0.25; }
        } else {
          p.vx *= Math.pow(0.05, dt);
          if (st.t >= 0.10) return true;
        }
        return false;
      } },

    // 弓手 · 反弹箭矢／远程投射
    { id: 'chuanyang', name: '穿杨', from: '弓手', cost: 18, cd: 0.80,
      desc: '把射过来的东西原样送回去。',
      exec: function (p, st, dt) {
        st.t = (st.t || 0) + dt;
        if (!st.ph) { cast(p, 'guard'); st.ph = 1; st.t = 0; p.vx *= 0.3; }
        if (st.ph === 1) {
          if (st.t >= 0.08) {
            st.ph = 2; st.t = 0;
            cast(p, 'castHit');
            SJ.Audio.sfx('parry', { vol: 0.8, rate: 1.2 });
            box(p, {
              w: 90, h: 76, ox: 46, oy: -4, dmg: 4, ttl: 0.30, follow: true,
              knock: [120, -60], stun: 0.2, type: 'qi',
              weight: 'light', ink: 4, pierce: true, moveId: 'chuanyang'
            });
          }
        } else if (st.ph === 2) {
          // 反弹场：把敌方投射物翻面加速送回
          var fx = p.cx() + p.facing * 46, list = SJ.Ent.list, i, e;
          for (i = 0; i < list.length; i++) {
            e = list[i];
            if (e.dead || !e.projectile || e.team === 'player') continue;
            if (Math.abs(e.cx() - fx) > 56 || Math.abs(e.cy() - p.cy()) > 46) continue;
            e.team = 'player';
            e.owner = p;
            e.vx = -e.vx * 1.7;
            e.vy = -e.vy * 0.5;
            e.facing = e.vx > 0 ? 1 : -1;
            if (e.struck) e.struck.length = 0;
            if (e.dmg) e.dmg = e.dmg * 1.6;
            e.color = SJ.C.cinnabar;
            SJ.FX.ring(e.cx(), e.cy(), { r: 4, r1: 40, color: SJ.C.cinnabar, life: 0.3 });
            SJ.Game.slowmo(0, 0.07);
            SJ.Game.shake(4, 0.16);
            SJ.Audio.sfx('parry', { vol: 1 });
          }
          if (st.t >= 0.30) { st.ph = 3; st.t = 0; }
        } else {
          if (st.t >= 0.14) return true;
        }
        return false;
      } },

    // 枪兵 · 下砸震地，范围击倒
    { id: 'zhenshan', name: '镇山', from: '枪兵', cost: 24, cd: 1.10,
      desc: '整个人砸下去，地面震一圈。全场最重的一下。',
      exec: function (p, st, dt) {
        st.t = (st.t || 0) + dt;
        if (!st.ph) {
          st.ph = p.onGround ? 2 : 1; st.t = 0;
          cast(p, 'downslash');
          p.vx *= 0.2;
          if (st.ph === 1) { p.vy = -180; st.noGravity = true; }
        }
        if (st.ph === 1) {                                    // 空中滞空一瞬再砸
          p.vx *= Math.pow(0.02, dt);
          if (st.t >= 0.14) { st.ph = 15; st.t = 0; st.noGravity = false; }
        } else if (st.ph === 15) {                            // 下落
          p.vy = 1350;
          p.vx *= Math.pow(0.1, dt);
          if (p.onGround || st.t > 0.9) { st.ph = 2; st.t = 0; }
        } else if (st.ph === 2) {                             // 蓄力 / 落地
          p.vx *= Math.pow(0.02, dt);
          if (st.t >= (p.onGround ? 0.02 : 0.12)) {
            st.ph = 3; st.t = 0;
            box(p, {
              w: 260, h: 58, ox: 0, oy: 22, dmg: 16, ttl: 0.12,
              knock: [300, -400], stun: 0.7, type: 'blunt',
              weight: 'huge', ink: 8, pierce: true, moveId: 'zhenshan'
            });
            SJ.Game.slowmo(0, 0.14);
            SJ.Game.shake(13, 0.4);
            SJ.FX.ring(p.cx(), p.footY(), { r: 10, r1: 190, color: SJ.C.ink, life: 0.5, w: 4 });
            SJ.FX.dust(p.cx() - 40, p.footY(), -1);
            SJ.FX.dust(p.cx() + 40, p.footY(), 1);
            SJ.FX.burst(p.cx(), p.footY(), {
              n: 16, color: SJ.C.ink, speed: 320, spread: 2.4,
              angle: -Math.PI / 2, life: 0.6, size: 3, gravity: 1400
            });
            SJ.Audio.sfx('hitHeavy', { vol: 1, rate: 0.8 });
          }
        } else {
          if (st.t >= 0.26) return true;
        }
        return false;
      } },

    // 雪山 · 空中再跳一次（三段跳的消耗版）
    { id: 'tiyun', name: '踏云', from: '雪山', cost: 10, cd: 0.25,
      desc: '在空里再踏一步。',
      exec: function (p, st, dt) {
        st.t = (st.t || 0) + dt;
        if (!st.ph) {
          st.ph = 1;
          p.vy = -640;
          p.onGround = false;
          cast(p, 'rise');
          SJ.Audio.sfx('jump', { vol: 0.85, rate: 1.2 });
          SJ.FX.ring(p.cx(), p.footY(), { r: 6, r1: 62, color: SJ.C.paperDark, life: 0.4, w: 2.4 });
          SJ.FX.leaf(p.cx(), p.footY(), 6, 'snow');
        }
        if (st.t >= 0.10) { p.setState('jump'); return true; }
        return false;
      } },

    // 藏经阁 · 周身爆开火墨，范围伤害 + 点燃
    { id: 'fenshu', name: '焚书', from: '藏经阁', cost: 28, cd: 1.20,
      desc: '周身炸开一团火墨。烧起来的会一直烧。',
      exec: function (p, st, dt) {
        st.t = (st.t || 0) + dt;
        if (!st.ph) { cast(p, 'castWind'); st.ph = 1; st.t = 0; p.vx *= 0.2; }
        if (st.ph === 1) {                                    // 蓄 0.20，墨往身上聚
          p.vx *= Math.pow(0.02, dt);
          st.acc = (st.acc || 0) + dt;
          if (st.acc > 0.03) {
            st.acc = 0;
            var a = Math.random() * Math.PI * 2, r = 90;
            SJ.FX.burst(p.cx() + Math.cos(a) * r, p.cy() + Math.sin(a) * r, {
              n: 1, color: SJ.C.cinnabar, speed: 220, spread: 0.2,
              angle: a + Math.PI, life: 0.42, size: 2.6, drag: 0.4
            });
          }
          if (st.t >= 0.20) {
            st.ph = 2; st.t = 0;
            cast(p, 'castHit');
            box(p, {
              w: 300, h: 170, ox: 0, oy: -8, dmg: 14, ttl: 0.14,
              knock: [280, -300], stun: 0.5, type: 'fire',
              weight: 'heavy', ink: 6, pierce: true, burn: 2.5, moveId: 'fenshu'
            });
            SJ.Game.slowmo(0, 0.12);
            SJ.Game.shake(10, 0.34);
            SJ.Game.flash(SJ.C.gamboge, 0.30, 0.42);
            SJ.FX.ring(p.cx(), p.cy(), { r: 12, r1: 170, color: SJ.C.cinnabar, life: 0.55, w: 4 });
            SJ.FX.burst(p.cx(), p.cy(), {
              n: 24, color: SJ.C.cinnabar, speed: 400, spread: Math.PI * 2,
              life: 0.7, size: 3.4, gravity: -200, drag: 1.6
            });
            SJ.Audio.sfx('fire', { vol: 1 });
          }
        } else {
          if (st.t >= 0.22) return true;
        }
        return false;
      } },

    // 师兄 · 复制敌人上一次用的招并立即施展
    { id: 'shuojian', name: '说剑', from: '师兄', cost: 40, cd: 1.50,
      desc: '他刚讲过的那一段，你原样讲一遍。',
      exec: function (p, st, dt) {
        if (!st.ph) {
          st.ph = 1;
          var id = SJ.Combat.lastFoeMove;
          var d = (id && id !== 'shuojian') ? byId(id) : null;
          st.inner = d ? { def: d, st: {} } : null;
          SJ.Game.flash(SJ.C.cinnabar, 0.24, 0.30);
          SJ.Game.slowmo(0.2, 0.14);
          SJ.Audio.sfx('qi', { vol: 1, rate: 0.85 });
          SJ.FX.ring(p.cx(), p.cy(), { r: 8, r1: 100, color: SJ.C.cinnabar, life: 0.5, w: 3 });
          if (st.inner) {
            SJ.FX.word(p.cx(), p.y - 22, st.inner.def.name,
              { color: SJ.C.cinnabar, size: 20, life: 1.0, screen: false });
          }
        }
        if (st.inner) {
          var done = st.inner.def.exec(p, st.inner.st, dt);
          st.noGravity = st.inner.st.noGravity;
          return done;
        }
        // 没有可复制的招：退化成一记重斩，不让 40 点墨白花
        st.t = (st.t || 0) + dt;
        if (st.ph === 1) {
          cast(p, 'atk3_wind'); st.ph = 2; st.t = 0;
        } else if (st.ph === 2) {
          p.vx *= Math.pow(0.02, dt);
          if (st.t >= 0.16) {
            st.ph = 3; st.t = 0;
            cast(p, 'atk3_hit');
            box(p, {
              w: 92, h: 62, ox: 46, oy: -4, dmg: 20, ttl: 0.12,
              knock: [340, -220], stun: 0.6, weight: 'huge', ink: 10,
              guardBreak: true, pierce: true, moveId: 'shuojian'
            });
            SJ.FX.slash(p.cx() + p.facing * 44, p.cy(), -1.6 * p.facing, 1.3 * p.facing,
              62, { color: SJ.C.cinnabar, w: 8, life: 0.2 });
            SJ.Audio.sfx('swing3', { vol: 1, rate: 0.82 });
          }
        } else {
          if (st.t >= 0.24) return true;
        }
        return false;
      } }
  ];

  // 数组 + id 键双索引
  var byIdMap = {};
  for (var di = 0; di < defs.length; di++) {
    byIdMap[defs[di].id] = defs[di];
    defs[defs[di].id] = defs[di];
  }
  function byId(id) { return byIdMap[id] || null; }

  // ── 「悟」的演出 ───────────────────────────────────────────
  // Game.step 只更新栈顶 scene，push 上来天然就是全屏定格；
  // draw 仍然画全栈，所以定格住的战斗画面还在下面。
  function learnScene(def) {
    var DUR = 1.75;
    return {
      t: 0,
      enter: function () {
        this.t = 0;
        SJ.Audio.sfx('learn', { vol: 1 });
        SJ.Audio.duck(1.6);
        SJ.Game.flash(SJ.C.gamboge, 0.55, 0.62);
      },
      // 谁把这一屏拿下去都算数：Game.pop 与 Game.setScene 都会调 exit。
      // 不在这里解锁的话，学招过程中一旦切场景（Level.load 会 setScene），
      // learning 会永远卡在 true —— 之后所有的「悟」都不再显示，且不报错。
      exit: function () { learning = false; },
      update: function () {
        this.t += SJ.Game.rawDt;                  // 走真实时间：同帧的 hitstop 不能把它冻住
        // 跳过只认「这一帧按下」，不能用 SJ.Input.any()（那是「按住」）：
        // 完美观势触发学招时玩家正按着 K，trigger 学招时正按着 D，
        // 用 any() 会让这一屏在 0.6s 就被自己的手按掉 —— 招名还没写完。
        var skip = SJ.Input.pressed('confirm') || SJ.Input.pressed('attack') ||
                   SJ.Input.pressed('jump') || SJ.Input.pressed('pause');
        if (this.t >= DUR || (this.t > 1.05 && skip)) {
          SJ.Game.pop();     // pop 会调 exit()，learning 在那里解锁
          next();
        }
      },
      draw: function (g) {
        var t = this.t, W = SJ.W, H = SJ.H;
        var din = SJ.clamp(t / 0.16, 0, 1);
        var dout = SJ.clamp((DUR - t) / 0.3, 0, 1);
        var a = din * dout;
        var cx = W * 0.54, top = 128, size = 76;

        // 定格画面上罩一层纸，把战斗压到背景里
        g.save();
        g.globalAlpha = 0.86 * a;
        g.fillStyle = SJ.C.paper;
        g.fillRect(0, 0, W, H);
        g.restore();

        // 藤黄的一闪：只在最初半秒，之后退干净，别把整屏染黄
        var flash = 1 - SJ.clamp(t / 0.5, 0, 1);
        if (flash > 0) {
          g.save();
          g.globalAlpha = a * flash * 0.22;
          g.fillStyle = SJ.C.gamboge;
          g.fillRect(0, 0, W, H);
          g.restore();
        }

        // 领悟的晕轮：干净的径向渐变，不用墨团
        g.save();
        var gr = 90 + SJ.ease.out(SJ.clamp(t / 0.9, 0, 1)) * 210;
        var rad = g.createRadialGradient(cx, top + 130, 0, cx, top + 130, gr);
        rad.addColorStop(0, 'rgba(200,165,91,' + (a * (0.30 + flash * 0.28)).toFixed(3) + ')');
        rad.addColorStop(0.55, 'rgba(200,165,91,' + (a * 0.10).toFixed(3) + ')');
        rad.addColorStop(1, 'rgba(200,165,91,0)');
        g.fillStyle = rad;
        g.fillRect(0, 0, W, H);
        g.restore();

        // 招名：竖排毛笔字，逐笔写出。这是整屏的主角。
        var wp = SJ.clamp((t - 0.12) / 0.55, 0, 1);
        SJ.Ink.brushReveal(g, def.name, cx, top, size, wp,
          { color: SJ.C.ink, alpha: a, seed: 5, vertical: true });

        // 「悟」——小字，缀在招名右上
        if (t > 0.06) {
          g.save();
          g.globalAlpha = a * SJ.clamp((t - 0.06) / 0.3, 0, 1) * 0.92;
          SJ.Ink.vtext(g, '悟', cx + size * 0.86, top - size * 0.52, 30,
            { color: SJ.C.gamboge, alpha: g.globalAlpha, seed: 9 });
          g.restore();
        }

        // 来处：每一招都来自一个具体的人。
        // 决议 012 路径二 —— 这是把「挨打 → 学会」这条因果关系变可见的唯一时刻。
        // 玩家得看见「这一招是从他身上来的」，才会开始盯着敌人出招看。
        // 所以它必须读得清，不能是一行淡到看不见的注脚。
        if (t > 0.55) {
          var sp = SJ.ease.out(SJ.clamp((t - 0.55) / 0.34, 0, 1));
          var colH = def.name.length * size * 1.14;
          SJ.Ink.line(g, cx - size * 0.80, top - size * 0.4,
            cx - size * 0.80, top - size * 0.4 + colH * sp, 1.8,
            { color: SJ.C.inkLight, alpha: a * sp * 0.5 });
          SJ.Ink.vtext(g, def.from, cx - size * 1.16, top + size * 0.06, 27,
            { color: SJ.C.ink2, alpha: a * sp, seed: 17 });
        }

        // 朱砂印：落在招名末尾
        if (t > 0.98) {
          var kp = SJ.clamp((t - 0.98) / 0.24, 0, 1);
          g.save();
          g.globalAlpha = a * kp;
          SJ.Ink.seal(g, cx + size * 0.30,
            top + def.name.length * size * 1.14 - size * 0.2,
            46 * (0.72 + 0.28 * SJ.ease.back(kp)), def.name);
          g.restore();
        }
        g.globalAlpha = 1;
      }
    };
  }

  function next() {
    if (learning || !learnQueue.length) return;
    var def = learnQueue.shift();
    learning = true;
    SJ.Game.push(learnScene(def));
  }

  // ── 出口 ───────────────────────────────────────────────────

  var Tech = {

    defs: defs,
    progress: {},

    def: byId,

    can: function (p, id) {
      var d = byId(id);
      if (!d || !p || p.dead) return false;
      if (p.known.indexOf(id) < 0) return false;
      if ((cds[id] || 0) > 0) return false;
      if (p.ink < d.cost) return false;                 // 招式没有地板
      if (p.hurtT > 0 || p.state === 'dead') return false;
      if (id === 'tiyun' && p.onGround) return false;   // 踏云只在空中
      for (var i = 0; i < running.length; i++) if (running[i].ent === p) return false;
      return true;
    },

    use: function (p, id) {
      if (!this.can(p, id)) {
        if (p && !p.dead && byId(id) && p.ink < byId(id).cost) {
          SJ.Audio.sfx('uiBack', { vol: 0.5 });          // 墨不够：给一声，别让玩家以为没按到
        }
        return false;
      }
      var d = byId(id);
      p.spendInk(d.cost);
      cds[id] = d.cd;
      p.observing = false;
      p.parryWindow = false;
      if (p.atkHb) { p.atkHb.dead = true; p.atkHb = null; }
      running.push({ ent: p, def: d, st: {} });
      return true;
    },

    cancel: function (ent) {
      for (var i = running.length - 1; i >= 0; i--) {
        if (running[i].ent === ent) running.splice(i, 1);
      }
      if (ent) ent.castPose = null;
    },

    // 招式执行期间是否照常受重力（player.js 读）
    gravityOn: function (ent) {
      for (var i = 0; i < running.length; i++) {
        if (running[i].ent === ent) return !running[i].st.noGravity;
      }
      return true;
    },

    busy: function (ent) {
      for (var i = 0; i < running.length; i++) if (running[i].ent === ent) return true;
      return false;
    },

    update: function (dt) {
      var k;
      for (k in cds) { if (cds[k] > 0) cds[k] -= dt; }

      for (var i = running.length - 1; i >= 0; i--) {
        var r = running[i];
        if (!r.ent || r.ent.dead || r.ent.state === 'dead' || r.ent.hurtT > 0) {
          running.splice(i, 1);
          continue;
        }
        var done = r.def.exec(r.ent, r.st, dt);
        if (done) {
          running.splice(i, 1);
          r.ent.castPose = null;
          if (r.ent.state === 'cast') r.ent.setState(r.ent.onGround ? 'idle' : 'fall');
        }
      }
      next();
    },

    cd: function (id) { return Math.max(0, cds[id] || 0); },

    // 残墨。关卡 trigger 可以直接 SJ.Tech.gain('tiyun', 100)。
    gain: function (moveId, amount) {
      var d = byId(moveId);
      if (!d || !amount) return;
      var p = SJ.player;
      if (p && p.known.indexOf(moveId) >= 0) return;         // 已经会了
      var was = Tech.progress[moveId] || 0;
      if (was >= 100) return;
      var now = SJ.clamp(was + amount, 0, 100);
      Tech.progress[moveId] = now;

      if (p && now < 100) {
        // 残墨：一道朱砂顺着身上淌下来
        SJ.FX.burst(p.cx(), p.cy() - 6, {
          n: 3 + Math.round(amount / 12), color: SJ.C.cinnabar,
          speed: 90, spread: 1.4, angle: -Math.PI / 2,
          life: 0.7, size: 2.4, gravity: 420, drag: 1.2
        });
        SJ.Audio.sfx('qi', { vol: 0.35 + amount / 100 * 0.4, rate: 1.1 + now / 200 });
      }
      if (now >= 100) Tech.learn(moveId);
    },

    learn: function (moveId) {
      var d = byId(moveId);
      if (!d) return;
      var save = SJ.Save.data;
      if (save.known.indexOf(moveId) >= 0) return;
      save.known.push(moveId);
      Tech.progress[moveId] = 100;
      for (var i = 0; i < 4; i++) {                          // 自动填进第一个空槽
        if (!save.slots[i]) { save.slots[i] = moveId; break; }
      }
      SJ.Save.save();
      learnQueue.push(d);
      next();
      return d;
    },

    // 关卡切换用：只清运行期状态，**不动残墨进度**（进度要跨关累积）
    clear: function () {
      running.length = 0;
      learnQueue.length = 0;
      learning = false;
      for (var k in cds) cds[k] = 0;
    },

    // 开新游戏用：残墨进度只存在内存里（DESIGN §8 的存档里没有这一项），
    // 不清的话「回标题 → 开新档」会带着上一周目的进度，且不报错。
    // H 的「始」（新游戏）流程应当调它一次。
    resetProgress: function () {
      Tech.progress = {};
      Tech.clear();
    }
  };

  SJ.Tech = Tech;

})(window.SJ = window.SJ || {});
