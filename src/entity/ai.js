// 【F】敌人地基：实体基座 / 招式跑动器 / 感知与走位 / 招式注册表。
//
// enemies.js 与 bosses.js 只写「谁有哪几招、什么时候出」，
// 招式本身、物理、受击、姿势、起手式全部在这里。
//
// 三条硬约束（决议 001 / 005）：
//   · 每帧维护 e.figOpts —— 残影 / 分身 / 瞬移全靠它
//   · telegraph.path 相对 owner 中心，x 按 facing 镜像，y 向下为正
//   · 完美观势的硬直经 hurt(0, src, {parried:true, stun:0.9}) 进来
(function (SJ) {
  'use strict';

  var AI = {};
  var uid = 1;

  // 起手式下限（DESIGN §3.2）。低于它玩家来不及反应，一律夹上去并告警。
  var MIN_WIND = 0.35;

  // 玩家最近一次用出的招（师兄 P3 现学它）。
  // combat.js 的 lastFoeMove 记的是反方向（敌→玩家），不能用。
  AI.lastPlayerMove = null;

  // 全局招式注册表：id -> 招式定义。师兄复制玩家的招就是在这里查表。
  AI.moves = {};

  // 同时允许几个敌人处在「危险招式」中。杂兵围殴时靠它排队，
  // 否则五个人同时起手，画面全是朱砂虚线，观势失去意义。
  AI.maxAttackers = 2;

  // ── 感知 ────────────────────────────────────────────────────

  AI.target = function () {
    var p = SJ.player;
    return (p && p.state !== 'dead' && p.hp > 0) ? p : null;
  };

  AI.dx = function (e, t) { return t.cx() - e.cx(); };
  AI.dy = function (e, t) { return t.cy() - e.cy(); };
  AI.dist = function (e, t) { return Math.abs(t.cx() - e.cx()); };
  AI.dist2 = function (e, t) { return Math.hypot(t.cx() - e.cx(), t.cy() - e.cy()); };

  AI.sees = function (e, t) {
    return !SJ.World.lineBlocked(e.cx(), e.cy(), t.cx(), t.cy());
  };

  AI.face = function (e, t) {
    if (!t) return;
    var d = t.cx() - e.cx();
    if (Math.abs(d) > 4) e.facing = d < 0 ? -1 : 1;
  };

  // 玩家是不是正处在「读不到起手式」的状态。
  // player.js 里观势被普攻/受击/身法打断，所以快招在这些时候出手 = 不可格挡。
  AI.playerBusy = function () {
    var p = SJ.player;
    if (!p) return false;
    return p.state === 'atk1' || p.state === 'atk2' || p.state === 'atk3' ||
           p.state === 'hurt' || p.state === 'cast' || p.dashT > 0;
  };

  // 玩家还要被自己的动作锁多久（观势进不去的那段）。
  // 敌人拿它决定「现在出这一招还留不留得出反应空间」。
  AI.playerLock = function () {
    var p = SJ.player;
    if (!p) return 0;
    if (p.dashT > 0) return p.dashT + 0.06;
    if (p.hurtT > 0) return p.hurtT;
    if (p.state === 'cast') return 0.34;
    if (p.state === 'atk1' || p.state === 'atk2') return 0.26;
    if (p.state === 'atk3') return 0.36;
    return 0;
  };

  AI.attackers = function () {
    var n = 0, L = SJ.Ent.list, i;
    for (i = 0; i < L.length; i++) {
      var e = L[i];
      if (!e.dead && e.mv && e.mv.d.danger !== false) n++;
    }
    return n;
  };

  // ── 走位 ────────────────────────────────────────────────────

  AI.walk = function (e, dir, spd, dt) {
    if (dt <= 0) return;
    e.vx += dir * e.acc * dt;
    if (Math.abs(e.vx) > spd) e.vx = dir * spd;
    if (dir !== 0) e.facing = dir;
  };

  AI.brake = function (e, dt) {
    if (dt <= 0) return;
    var f = e.fric * dt;
    if (Math.abs(e.vx) <= f) e.vx = 0;
    else e.vx -= Math.sign(e.vx) * f;
  };

  // 维持与目标的距离 want（±tol）。返回 true 表示已经到位。
  AI.spacing = function (e, t, want, tol, dt) {
    var d = AI.dx(e, t), ad = Math.abs(d);
    AI.face(e, t);
    if (ad > want + tol) { AI.walk(e, d < 0 ? -1 : 1, e.speed, dt); return false; }
    if (ad < want - tol) { AI.walk(e, d < 0 ? 1 : -1, e.speed * 0.7, dt); return false; }
    AI.brake(e, dt);
    return true;
  };

  AI.hop = function (e, vy, vx) {
    if (!e.onGround) return false;
    e.vy = vy === undefined ? -520 : vy;
    if (vx !== undefined) e.vx = vx;
    e.onGround = false;
    SJ.FX.dust(e.cx(), e.y + e.h, 0);
    return true;
  };

  // 前方有没有地可站（防止走下悬崖）。
  // groundAt 要求 s.y >= yFrom，脚正好踩在地面上时必须从脚底稍上方问，
  // 否则脚下那块地会被判成「在身后」，敌人会原地不动。
  AI.ledge = function (e, dir) {
    var x = e.cx() + dir * (e.w * 0.6 + 6);
    var foot = e.y + e.h;
    var g = SJ.World.groundAt(x, foot - 4);
    return g !== null && g - foot < 96;
  };

  // ── 招式跑动器 ───────────────────────────────────────────────

  AI.cool = function (e, id, sec) { e.cds[id] = sec; };
  AI.ready = function (e, id) { return !(e.cds[id] > 0); };

  // 从 ids 里挑一个现在能用的招（冷却好 / 距离对 / 玩家读得到）
  AI.pick = function (e, t, ids) {
    var ok = [], tot = 0, i, m, d = t ? AI.dist(e, t) : 1e9;
    var lock = AI.playerLock();
    var crowded = AI.attackers() >= AI.maxAttackers;
    for (i = 0; i < ids.length; i++) {
      m = AI.moves[ids[i]];
      if (!m) continue;
      if (e.cds[m.id] > 0) continue;
      if (m.range && (d < m.range[0] || d > m.range[1])) continue;
      if (m.ground !== false && !e.onGround) continue;
      // 「公平」的主开关。玩家被自己的动作锁住时（普攻/招式/身法/受击）
      // 观势进不去 —— 起手式再明显也读不到。所以要求：
      //     起手式时长 − 玩家剩余锁定 ≥ 0.22s
      // 玩家自由时 lock=0，什么招都能出；玩家在挥剑时，只有大招敢起手。
      // （实测：一刀切成「busy 时禁止 <0.70s 的招」会让白衣 50s 里只出 5 招，
      //   人物性格直接没了；按剩余时间算才既公平又不温吞。）
      if (lock > 0 && (m.wind || 1) * (e.windMul || 1) - lock < 0.22) continue;
      if (crowded && m.danger !== false && !m.priority) continue;
      if (m.can && !m.can(e, t)) continue;
      ok.push(m); tot += (m.weight || 1);
    }
    if (!ok.length) return null;
    var r = Math.random() * tot;
    for (i = 0; i < ok.length; i++) {
      r -= (ok[i].weight || 1);
      if (r <= 0) return ok[i];
    }
    return ok[ok.length - 1];
  };

  AI.start = function (e, m, data) {
    if (!m) return false;
    if (typeof m === 'string') m = AI.moves[m];
    if (!m) return false;

    var wind = m.wind === undefined ? 0.6 : m.wind;
    if (m.danger !== false && wind < MIN_WIND) {
      console.warn('[F] 起手式短于 0.35s，已夹紧：', m.id, wind);
      wind = MIN_WIND;
    }
    wind *= (e.windMul || 1);

    var s = e.mv = {
      d: m, ph: 'wind', t: 0, wind: wind, tg: null, n: 0,
      data: data || {}
    };
    e.act = 'move';
    e.at = 0;
    if (m.onStart) m.onStart(e, s);

    var mid = s.data.moveId !== undefined ? s.data.moveId
            : (m.learn === false ? null : m.id);
    s.moveId = mid;

    var path = m.path ? m.path(e, s) : null;
    if (path && path.length > 1) {
      s.tg = SJ.Combat.telegraph({
        owner: e, moveId: mid, dur: wind, path: path,
        danger: m.danger !== false, color: m.color || null
      });
    }
    if (m.sfx) SJ.Audio.sfx(m.sfx, { vol: m.sfxVol || 0.7 });
    return true;
  };

  // 打断：杀掉本人所有活着的 hitbox 与起手式。
  // 完美观势之后玩家必须真的安全 —— 漏掉这一步，格挡完还会被同一刀打中。
  AI.interrupt = function (e) {
    var H = SJ.Combat.hitList, T = SJ.Combat.tgList, i;
    for (i = 0; i < H.length; i++) if (H[i].owner === e) H[i].dead = true;
    for (i = 0; i < T.length; i++) if (T[i].owner === e) T[i].dead = true;
    if (e.mv) {
      if (e.mv.d.onEnd) e.mv.d.onEnd(e, e.mv, true);
      e.cds[e.mv.d.id] = (e.mv.d.cd || 1) * 0.6;
      e.mv = null;
    }
  };

  function endMove(e) {
    var s = e.mv;
    if (!s) return;
    if (s.d.onEnd) s.d.onEnd(e, s, false);
    e.cds[s.d.id] = s.d.cd === undefined ? 1.2 : s.d.cd;
    e.mv = null;
    e.act = 'idle';
    e.at = 0;
  }
  AI.endMove = endMove;

  function runMove(e, dt) {
    var s = e.mv, m = s.d;
    s.t += dt;

    if (s.ph === 'wind') {
      if (!m.lockFace) {
        var t = AI.target();
        if (t && s.t < s.wind * 0.55) AI.face(e, t);   // 起手前半段还会调整朝向
      }
      if (m.onWind) m.onWind(e, s, dt);
      if (s.t >= s.wind) {
        s.ph = 'act'; s.t = 0;
        if (s.tg) s.tg.window = true;
        if (m.fire) m.fire(e, s);
      }
    } else if (s.ph === 'act') {
      if (m.onAct) m.onAct(e, s, dt);
      if (s.t >= (m.act === undefined ? 0.12 : m.act)) { s.ph = 'rec'; s.t = 0; }
    } else {
      if (m.onRec) m.onRec(e, s, dt);
      if (s.t >= (m.rec === undefined ? 0.35 : m.rec)) endMove(e);
    }
  }

  // 招式的 hitbox：默认 team 'foe'、owner e、moveId 跟着起手式走
  AI.hit = function (e, o) {
    o = o || {};
    o.team = o.team || 'foe';
    o.owner = e;
    if (o.moveId === undefined) o.moveId = e.mv ? e.mv.moveId : null;
    if (o.x === undefined && o.ox !== undefined && !o.follow) {
      o.x = e.cx() + o.ox * e.facing - (o.w || 0) / 2;
      o.y = e.cy() + (o.oy || 0) - (o.h || 0) / 2;
      delete o.ox; delete o.oy;
    }
    return SJ.Combat.hit(o);
  };

  // ── 物理 ────────────────────────────────────────────────────

  function physics(e, dt, grav) {
    if (dt <= 0) return;
    if (grav !== false) {
      e.vy += SJ.GRAVITY * dt;
      if (e.vy > SJ.MAXFALL) e.vy = SJ.MAXFALL;
    }
    var was = e.onGround, fell = e.vy;
    SJ.World.moveX(e, e.vx * dt);
    SJ.World.moveY(e, e.vy * dt);
    if (e.onGround && !was && fell > 420) {
      SJ.FX.dust(e.cx(), e.y + e.h, 0);
      SJ.Audio.sfx('land', { vol: SJ.clamp(fell / 1400, 0.2, 0.7) });
    }
    if (e.onGround && !e.mv) AI.brake(e, dt * 0.6);
  }
  AI.physics = physics;

  // ── 姿势 ────────────────────────────────────────────────────

  function poseSpec(e) {
    var m = e.mv;
    if (e.act === 'down') return { p: e.at > 0.45 ? 'dead' : 'down', k: SJ.clamp(e.at / 0.5, 0, 1) };
    if (e.act === 'stun') return { p: 'hurt', k: SJ.clamp(1 - e.stunT / 0.5, 0, 1) };
    if (e.act === 'shift') return { p: e.def.shiftPose || 'guard', k: SJ.clamp(e.at / 0.5, 0, 1) };
    if (e.act === 'guard') return { p: e.def.guardPose || 'guard', k: SJ.clamp(e.at / 0.35, 0, 1) };
    if (m) {
      var ph = m.ph, d = m.d;
      var name = ph === 'wind' ? (d.poseW || 'atk1_wind')
               : ph === 'act' ? (d.poseA || 'atk1_hit')
               : (d.poseR || 'atk1_rec');
      var dur = ph === 'wind' ? m.wind : ph === 'act' ? (d.act === undefined ? 0.12 : d.act)
              : (d.rec === undefined ? 0.35 : d.rec);
      return { p: name, k: dur > 0 ? SJ.clamp(m.t / dur, 0, 1) : 1 };
    }
    if (!e.onGround) return { p: e.vy < -40 ? 'jump' : 'fall', k: SJ.clamp(Math.abs(e.vy) / 700, 0, 1) };
    if (Math.abs(e.vx) > 14) {
      e.runPhase += Math.abs(e.vx) * 0.0022;
      return { p: Math.abs(e.vx) > e.speed * 0.8 ? 'run' : 'walk', k: e.runPhase % 1 };
    }
    return { p: 'idle', k: (e.anim * 0.38 + e.seed) % 1 };
  }

  // 每帧维护 figOpts（决议 001 §4）
  function figure(e) {
    var o = e.figOpts || (e.figOpts = {});
    var s = poseSpec(e);
    o.x = e.cx();
    o.y = e.y + e.h;
    o.facing = e.facing;
    o.scale = e.scale;
    o.pose = (typeof s.p === 'function') ? s.p(e, s.k, e.anim)
                                         : SJ.Figure.pose(s.p, s.k, e.anim + e.seed);
    o.poseName = (typeof s.p === 'function') ? 'custom' : s.p;
    o.weapon = e.weapon;
    o.color = e.flash > 0 ? SJ.C.cinnabar : e.color;
    o.alpha = e.alpha;
    o.lineScale = e.lineScale;
    o.cloth = SJ.clamp(0.2 + Math.abs(e.vx) / 240 * 0.6 + (e.onGround ? 0 : 0.3), 0, 1.3);
    // figure.js 的次级运动（衣摆/发带）读 vx/vy，key 用来做每个实体独立的延迟弹簧
    o.vx = e.vx; o.vy = e.vy;
    o.key = e.figKey;
    o.t = e.anim + e.seed;
    return o;
  }
  AI.figure = figure;

  // ── 基座 ────────────────────────────────────────────────────

  AI.make = function (def, x, y, opts) {
    opts = opts || {};
    var e = {
      tag: 'foe', team: 'foe', z: def.z === undefined ? 5 : def.z,
      id: def.id, def: def, boss: !!def.boss,
      x: x - (def.w || 26) / 2, y: y - (def.h || 52),
      w: def.w || 26, h: def.h || 52,
      vx: 0, vy: 0, facing: opts.facing || -1,
      hp: opts.hp || def.hp || 30, maxHp: opts.hp || def.hp || 30,
      scale: def.scale || 0.86,
      weapon: def.weapon === undefined ? null : def.weapon,
      color: def.color || SJ.C.ink,
      alpha: 1, lineScale: def.lineScale || 1,

      speed: def.speed || 130,
      acc: def.acc || 1600,
      fric: def.fric || 2000,
      windMul: opts.windMul || def.windMul || 1,

      onGround: false, invuln: 0, stunT: 0, flash: 0,
      act: 'idle', at: 0, anim: 0, runPhase: 0,
      seed: SJ.rand(0, 10),
      figKey: 'f' + (uid++),
      mv: null, cds: {}, mem: {},
      think: 0,

      staggers: 0, staggerMax: def.staggerMax || 2,
      armorT: 0, armorSec: def.armorSec || 1.0,
      superArmor: !!def.superArmor,
      knockMul: def.knockMul === undefined ? 1 : def.knockMul,

      phase: 1, shiftT: 0, _defeated: false,
      onDefeat: null,
      figOpts: null,
      dead: false
    };

    e.cx = function () { return this.x + this.w / 2; };
    e.cy = function () { return this.y + this.h / 2; };
    e.footY = function () { return this.y + this.h; };

    // Boss 阶段切换：清场 → 换势 → 继续。突兀的阶段转换是「不好玩」的第一来源。
    e.setPhase = function (n) {
      if (n === this.phase || this.act === 'down') return;
      this.phase = n;
      AI.interrupt(this);
      this.stunT = 0;
      this.staggers = 0; this.armorT = 0;
      this.invuln = Math.max(this.invuln, this.def.shiftSec || 1.0);
      this.shiftT = this.def.shiftSec || 1.0;
      this.act = 'shift'; this.at = 0;
      this.vx = 0;
      SJ.Game.slowmo(0.35, 0.30);
      SJ.Game.shake(7, 0.4);
      SJ.FX.ring(this.cx(), this.cy(), { r: 10, r1: 150, color: SJ.C.ink, life: 0.7, w: 3 });
      SJ.FX.burst(this.cx(), this.cy(), {
        n: 16, color: SJ.C.ink, speed: 260, spread: Math.PI * 2,
        life: 0.7, size: 3, gravity: 400, drag: 2
      });
      SJ.Audio.sfx('qi', { vol: 1 });
      if (this.def.onPhase) this.def.onPhase(this, n);
    };

    e.hurt = function (dmg, src, opt) { return hurt(this, dmg, src, opt); };
    e.update = function (dt) { tick(this, dt); };
    e.draw = function (g) { (this.def.draw || AI.draw)(g, this); };

    if (def.init) def.init(e, opts);
    figure(e);
    SJ.Ent.add(e);
    return e;
  };

  // ── 受击 ────────────────────────────────────────────────────

  function hurt(e, dmg, src, opt) {
    opt = opt || {};
    if (e.act === 'down' || e.dead) return;

    // ① 完美观势的硬直。combat.js 会走两条路进来（onParry 与 strike），
    //    所以必须幂等：取最大值，不叠加、不掉血、不击退。
    if (opt.parried) {
      var st = opt.stun === undefined ? 0.9 : opt.stun;
      AI.interrupt(e);
      e.stunT = Math.max(e.stunT, st);
      e.act = 'stun'; e.at = 0;
      e.staggers = 0; e.armorT = 0;
      e.vx *= 0.2;
      if (e.def.onParried) e.def.onParried(e, src);
      return;
    }

    // 玩家用过的招 —— 师兄 P3 要现学（combat 的 lastFoeMove 是反方向的）
    if (src === SJ.player && opt.moveId) AI.lastPlayerMove = opt.moveId;

    // ② 格挡型敌人（僧人 / 守阁人）。
    //    不能用 dmg>0 当门槛 —— 「无锋」本身就是 0 伤害，
    //    正是它要来撬这道门的（tech.js 里 wufeng 的 hitbox dmg=0）。
    if (e.def.block) {
      var r = e.def.block(e, dmg, src, opt);
      if (r === true) return;          // 完全挡掉
      if (typeof r === 'number') dmg = r;
    }

    if (e.invuln > 0 && dmg > 0) return;
    if (e.hp <= 0) return;

    e.hp -= dmg;
    if (dmg > 0) e.flash = 0.10;

    if (e.hp <= 0) { defeat(e, src); return; }

    // ③ 僵直预算：不设上限，玩家三连能把任何人锁死到死
    var stun = opt.stun === undefined ? 0.2 : opt.stun;
    if (e.superArmor) stun = 0;
    else if (e.armorT > 0) stun = 0;
    else if (stun > 0) {
      e.staggers++;
      if (e.staggers >= e.staggerMax) { e.staggers = 0; e.armorT = e.armorSec; }
    }

    var kx = opt.knock ? (opt.knock[0] || 0) : 140;
    var ky = opt.knock ? (opt.knock[1] === undefined ? -60 : opt.knock[1]) : -60;
    var dir = opt.dir !== undefined ? opt.dir
            : (src ? (e.cx() < (src.cx ? src.cx() : src.x) ? -1 : 1) : -e.facing);
    var km = e.knockMul * (stun > 0 ? 1 : 0.25);
    e.vx = dir * kx * km;
    if (opt.launch) { e.vy = -420; e.onGround = false; }
    else if (stun > 0) e.vy = Math.min(e.vy, ky * e.knockMul);

    if (stun > 0) {
      AI.interrupt(e);
      e.stunT = Math.max(e.stunT, stun);
      e.act = 'stun'; e.at = 0;
    }
    if (e.def.onHurt) e.def.onHurt(e, dmg, src, opt);
  }

  function defeat(e, src) {
    e.hp = 0;
    AI.interrupt(e);
    e.act = 'down'; e.at = 0;
    e.stunT = 0;
    e.vx = -e.facing * (e.boss ? 90 : 150);
    e.vy = -220;
    SJ.FX.splash(e.cx(), e.cy(), -e.facing, { n: e.boss ? 14 : 8, color: SJ.C.ink, speed: 280 });
    SJ.Audio.sfx('enemyDeath', { vol: e.boss ? 1 : 0.8 });
    SJ.Game.shake(e.boss ? 10 : 4, 0.3);
    if (e.boss) {
      // 倒地不死。等关卡层弹生杀选择（DESIGN §3.3）
      SJ.Game.slowmo(0.2, 1.1);
      if (!e._defeated) { e._defeated = true; if (e.onDefeat) e.onDefeat(e); }
    }
    if (e.def.onDown) e.def.onDown(e, src);
  }

  // ── 每帧 ────────────────────────────────────────────────────

  function tick(e, dt) {
    e.at += dt;
    e.anim += dt;
    e.invuln = Math.max(0, e.invuln - dt);
    e.flash = Math.max(0, e.flash - dt);
    e.armorT = Math.max(0, e.armorT - dt);
    if (e.armorT === 0 && e.staggers > 0 && !e.mv) e.staggers = Math.max(0, e.staggers - dt * 0.5);
    for (var k in e.cds) if (e.cds[k] > 0) e.cds[k] -= dt;

    if (e.act === 'down') {
      physics(e, dt);
      if (!e.boss && e.at > 1.0) { SJ.Ent.remove(e); return; }
      figure(e);
      return;
    }

    if (e.stunT > 0) {
      e.stunT -= dt;
      physics(e, dt);
      if (e.stunT <= 0) { e.act = 'idle'; e.at = 0; }
      figure(e);
      return;
    }

    if (e.act === 'shift') {
      e.shiftT -= dt;
      AI.brake(e, dt);
      physics(e, dt);
      if (e.shiftT <= 0) { e.act = 'idle'; e.at = 0; }
      figure(e);
      return;
    }

    // 阶段自动推进（Boss）
    if (e.def.phases && !e.mv) {
      var th = e.def.phases, want = 1;
      for (var i = 0; i < th.length; i++) if (e.hp / e.maxHp <= th[i]) want = i + 2;
      if (want > e.phase) { e.setPhase(want); figure(e); return; }
    }

    if (e.mv) {
      runMove(e, dt);
      physics(e, dt, e.mv ? e.mv.d.gravity !== false : true);
      figure(e);
      return;
    }

    var t = AI.target();
    if (e.def.think) e.def.think(e, dt, t);
    physics(e, dt);
    figure(e);
  }

  // ── 绘制 ────────────────────────────────────────────────────

  AI.draw = function (g, e) {
    var o = e.figOpts;
    if (!o) return;

    // 霸体：一圈极淡的焦墨，告诉玩家「这一下打不断他」
    if (e.armorT > 0 && e.act !== 'down') {
      g.save();
      g.globalAlpha = SJ.clamp(e.armorT, 0, 1) * 0.16;
      SJ.Ink.blob(g, e.cx(), e.cy(), e.w * 1.5, 21, { color: SJ.C.ink2, alpha: 0.16 });
      g.restore();
    }
    if (e.invuln > 0 && e.act !== 'down') {
      o.alpha = (Math.floor(SJ.Game.time * 20) % 2) ? 0.5 : e.alpha;
    } else o.alpha = e.alpha;

    SJ.Figure.draw(g, o);
    o.alpha = e.alpha;
  };

  // ── 招式注册 ─────────────────────────────────────────────────

  AI.def = function (m) {
    AI.moves[m.id] = m;
    return m;
  };

  SJ.AI = AI;

})(window.SJ = window.SJ || {});
