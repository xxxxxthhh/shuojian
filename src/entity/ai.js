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

  AI.MIN_WIND = MIN_WIND;

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

  // 同时在出危险招的敌人数。分身（e.host）不计入 ——
  // 否则白衣 P3 的三个影一动手就把本体自己的招额度吃光，本体反而站着不动。
  // 分身自己的并发上限由 bosses.js 里的影单独管。
  AI.attackers = function () {
    var n = 0, L = SJ.Ent.list, i;
    for (i = 0; i < L.length; i++) {
      var e = L[i];
      if (!e.dead && !e.host && e.mv && e.mv.d.danger !== false) n++;
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

  function inSolid(b) {
    var S = SJ.World.solids, i, s;
    for (i = 0; i < S.length; i++) {
      s = S[i];
      if (s.gone || s.oneway) continue;
      if (b.x < s.x + s.w && b.x + b.w > s.x && b.y < s.y + s.h && b.y + b.h > s.y) return true;
    }
    return false;
  }

  // 瞬移。**不要直接写 e.x/e.y** —— World.moveX/moveY 只在「移动过程中」推出，
  // 已经和墙重叠了是推不出来的，实体会被永久卡死（notes-E §6，E 在 tech.js 里踩过同一个坑）。
  // 沿「原点 → 落点」回退 6 档，取第一个不重叠的位置；全都不行就原地不动。
  AI.blink = function (e, tx, ty) {
    var ox = e.x, oy = e.y, i, k;
    e._tp = 1;                             // 自己挪的，下一帧的瞬移守卫别管
    for (i = 0; i <= 6; i++) {
      k = 1 - i / 6;
      e.x = ox + (tx - ox) * k;
      e.y = oy + (ty - oy) * k;
      if (!inSolid(e)) {
        e.vx = 0; e.vy = 0;
        return i === 0;                    // true = 落到了想去的地方
      }
    }
    e.x = ox; e.y = oy;
    return false;
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

  // 这个敌人这一刻的招表。opts.only 可以把它钉死成一个子集 ——
  // 决议 012：第一回的第一个刀客是全游戏的教具，只准出「破雨」，反复出。
  AI.moveset = function (e, fallback) {
    return e.only || fallback;
  };

  // 从 ids 里挑一个现在能用的招（冷却好 / 距离对 / 玩家读得到 / 上一招过去够久）
  AI.pick = function (e, t, ids) {
    var ok = [], tot = 0, i, m, d = t ? AI.dist(e, t) : 1e9;
    if (e.gcd > 0) return null;          // 上一招刚完，先把 0.9s 的反击窗口留给玩家
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

    data = data || {};
    var wind = data.wind !== undefined ? data.wind
             : (m.wind === undefined ? 0.6 : m.wind);
    wind *= (e.windMul || 1);
    // 决议 018：夹紧必须在 windMul **之后**。在之前夹，enemies.js 承诺的
    // 「下限 0.35s 由 AI.start 兜底」对最终值根本不成立 —— 第六回按注释把 windMul
    // 调到 0.62，0.42s 的快剑会变成 0.26s，而且不报错。现状最短 0.361s，挪动改变为零。
    if (m.danger !== false && wind < MIN_WIND) {
      console.warn('[F] 起手式短于 0.35s，已夹紧：', m.id, wind);
      wind = MIN_WIND;
    }

    var s = e.mv = {
      d: m, ph: 'wind', t: 0, wind: wind, tg: null, n: 0,
      data: data
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
        danger: m.danger !== false, color: m.color || null,
        // 决议 014：分层只是画法，path/dur/danger 的语义一个不动。
        // 缺省 light 是兜底，不是许可 —— dev/enemy-check.js 要求招表里显式写。
        tier: m.tier || 'light'
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
      e.gcd = Math.max(e.gcd, e.gap * 0.5);
      e.mv = null;
    }
  };

  function endMove(e) {
    var s = e.mv;
    if (!s) return;
    if (s.d.onEnd) s.d.onEnd(e, s, false);
    e.cds[s.d.id] = s.d.cd === undefined ? 1.2 : s.d.cd;
    // 两次起手式之间的全局空档。完美观势给敌人 0.9s 硬直，
    // 而玩家三连全程 0.62s —— 空档小于 0.9s，格挡成功就换不来一套连段，
    // 「做对了却没有奖励」是最伤的一种设计（notes-E §5）。
    if (s.d.danger !== false) e.gcd = e.gap;
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
    // Boss 是「倒地未死」（DESIGN §3.3）：撑在一只手上、头还抬着，
    // 生杀抉择就看这一下 —— 所以永远停在 down，不许躺平成 dead。
    if (e.act === 'down') {
      if (e.boss) return { p: 'down', k: SJ.clamp(e.at / 0.5, 0, 1) };
      return { p: e.at > 0.45 ? (e.mem.deadPose || 'dead') : 'down', k: SJ.clamp(e.at / 0.5, 0, 1) };
    }
    // 受击按体重分层：轻的整段后仰，中的仰完架回来，重的沉肩硬吃、不后仰。
    if (e.act === 'stun') {
      var sk = SJ.clamp(1 - e.stunT / 0.5, 0, 1);
      if (e.mass === 'heavy') return { p: 'crouch', k: sk };
      if (e.mass === 'mid' && sk > 0.55) return { p: 'guard', k: (sk - 0.55) / 0.45 };
      return { p: 'hurt', k: sk };
    }
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
      gcd: 0, gap: def.gap === undefined ? 0.9 : def.gap,
      only: opts.only || null,
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
      // 体重（轻/中/重）：只影响受击姿势与墨点，不影响击退与伤害
      mass: def.mass || 'mid',
      // 瞬移守卫用（T1 的 rescueFoes 会把掉出世界的敌人传送到玩家身边）。
      // _tp=1 表示「这一帧的位移是我自己要的」，首帧先跳过。
      _lx: 0, _ly: 0, _tp: 1,
      dead: false
    };

    e.cx = function () { return this.x + this.w / 2; };
    e.cy = function () { return this.y + this.h / 2; };
    e.footY = function () { return this.y + this.h; };

    // Boss 阶段切换：清场 → 换势 → 继续。突兀的阶段转换是「不好玩」的第一来源。
    //
    // 换势的这一段（def.shiftSec，1.0–1.3s，决议 019 不缩短）：
    // 停手、不起手式、无敌。玩家在这段里打上来不掉血，但**必须有回音** ——
    // 那条「挡开」反馈归 combat.js（决议 019：T3 不在 ai.js 侧绕）。
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

      // 影/分身也得停手：只停本体的话，白衣 P2→P3 换势期间三个影照打，
      // 「他换了个打法」这句话就没人听得见。mimic 是影自己的「站住」计时。
      if (SJ.Bosses && SJ.Bosses.clones) {
        var cs = SJ.Bosses.clones(this), ci;
        for (ci = 0; ci < cs.length; ci++) {
          AI.interrupt(cs[ci]);
          cs[ci].mimic = Math.max(cs[ci].mimic || 0, this.shiftT);
        }
      }

      SJ.Game.slowmo(0.35, 0.30);
      SJ.Game.shake(7, 0.4);
      SJ.FX.ring(this.cx(), this.cy(), { r: 10, r1: 150, color: SJ.C.ink, life: 0.7, w: 3 });
      SJ.FX.burst(this.cx(), this.cy(), {
        n: 16, color: SJ.C.ink, speed: 260, spread: Math.PI * 2,
        life: 0.7, size: 3, gravity: 400, drag: 2
      });
      // 甩一把墨：决议 013 —— 第三参是弧度角，不是 ±1。
      // groundY 也要给，否则墨点在半空原地化开，落不到纸上。
      var gy = SJ.World.groundAt(this.cx(), this.cy());
      SJ.FX.splash(this.cx(), this.cy() - 6,
        this.facing > 0 ? -0.6 : -(Math.PI - 0.6),
        { n: 11, color: SJ.C.ink, speed: 310, groundY: gy == null ? this.footY() : gy });
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

  // 受击的墨：按体重分层。轻的细碎飞散，重的少而钝、直接落到脚边的纸上。
  // **击退距离不动**（那是数值），这里只改墨。
  function hurtInk(e, dir, mass) {
    var x = e.cx() + dir * 6, y = e.cy() - 4;
    if (mass === 'light') {
      SJ.FX.burst(x, y, {
        n: 5, color: SJ.C.ink, speed: 240, spread: 2.2,
        angle: dir > 0 ? -0.5 : -(Math.PI - 0.5),
        life: 0.36, size: 1.7, gravity: 700, drag: 2.2
      });
    } else if (mass === 'heavy') {
      // groundY 取命中点正下方真正的地面（与 combat.js 的 groundLine 同口径）——
      // 被浮空时脚底本身就在半空，墨该继续落到纸上，不是跟着人挂在空中
      var gy = SJ.World.groundAt(x, y);
      SJ.FX.splash(x, y, dir > 0 ? -0.9 : -(Math.PI - 0.9),
        { n: 2, color: SJ.C.ink, speed: 130, groundY: gy == null ? e.footY() : gy });
      SJ.FX.burst(x, e.cy() + e.h * 0.3, {
        n: 3, color: SJ.C.ink2, speed: 90, spread: 1.4,
        angle: -Math.PI / 2, life: 0.5, size: 3.2, gravity: 900
      });
    } else {
      SJ.FX.burst(x, y, {
        n: 3, color: SJ.C.ink, speed: 170, spread: 1.8,
        angle: dir > 0 ? -0.6 : -(Math.PI - 0.6),
        life: 0.4, size: 2.4, gravity: 800, drag: 1.8
      });
    }
  }

  function hurt(e, dmg, src, opt) {
    opt = opt || {};
    if (e.act === 'down' || e.dead) return;

    // ⓪ 换势（Boss 阶段转换）：这段停顿是给玩家看的一句话，不许被打断。
    //    伤害由 invuln 挡（决议 019：静默吃掉玩家 hitbox 的「挡开」反馈归 combat.js）；
    //    这里只挡「硬直」这条路 —— 没有它，一次 Combat.stun 就能把换势掐掉。
    if (e.act === 'shift') return;

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
    if (dmg > 0 && !opt.silent) hurtInk(e, dir, e.mass);
    if (e.def.onHurt) e.def.onHurt(e, dmg, src, opt);
  }

  function defeat(e, src) {
    e.hp = 0;
    AI.interrupt(e);
    e.act = 'down'; e.at = 0;
    // 死姿两种，随机。Boss 不用 —— 他倒地未死，姿势由 poseSpec 钉死在「撑手抬头」。
    e.mem.deadPose = Math.random() < 0.5 ? 'dead' : 'sit';
    e.stunT = 0;
    e.vx = -e.facing * (e.boss ? 90 : 150);
    e.vy = -220;
    // 决议 013：第三参是弧度角，不是 ±1。传 ±1 会让左右两侧的墨点甩向同一边。
    SJ.FX.splash(e.cx(), e.cy(), -e.facing > 0 ? -0.6 : -(Math.PI - 0.6),
      { n: e.boss ? 14 : 8, color: SJ.C.ink, speed: 280, groundY: e.y + e.h });
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
    e.gcd = Math.max(0, e.gcd - dt);
    if (e.armorT === 0 && e.staggers > 0 && !e.mv) e.staggers = Math.max(0, e.staggers - dt * 0.5);
    for (var k in e.cds) if (e.cds[k] > 0) e.cds[k] -= dt;

    // 瞬移守卫。T1 的 rescueFoes()（level.js:151）会把掉出世界的敌人传送到
    // 玩家身边 —— 被传送的那一刻，正在跑的招必须作废：
    //   · 冲锋的 hitbox 是 follow:e，跟着人一起贴到玩家脸上（k_zhuang / 横云断 / 遍照）
    //   · 起手式画在新位置上，玩家刚读到一半的反应窗口被凭空吃掉
    //   · 算好落点的招（雨落）在半空改了落点
    // 三种都不报错，只是不公平。_tp 是「这一下位移是我自己要的」（AI.blink 会设）。
    // 倒地 / 换势 / 硬直中只清招不动 act —— 倒地的 Boss 站起来会毁掉生杀抉择。
    if (e._tp) e._tp = 0;
    else if (Math.abs(e.x - e._lx) + Math.abs(e.y - e._ly) > 240) {
      AI.interrupt(e);
      e.vx = 0; e.vy = 0; e.think = 0;
      if (e.act === 'move') { e.act = 'idle'; e.at = 0; }
    }
    e._lx = e.x; e._ly = e.y;

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
