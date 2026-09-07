// 【E】主角「无名」。状态机 + 墨系统 + 观势。
//
// 数值严格按 DESIGN §7；与之有出入的地方在 _spec/notes-E.md 里逐条说明。
// 墨规则见 DESIGN §3.1 + §9.3：身法/观势在墨≤20 时不再扣墨；枯墨掉血最低到 1 HP。
(function (SJ) {
  'use strict';

  // ── DESIGN §7 ──────────────────────────────────────────────
  var RUN = 240, ACC = 3000, FRIC = 3200;
  var JUMP = -720, JUMP_SHORT = -420, JUMP2 = -640;
  var COYOTE = 0.10, JBUF = 0.12;
  var DASH_V = 780, DASH_T = 0.16, DASH_INV = 0.20, DASH_CD = 0.32, DASH_INK = 12;
  var COMBO_WIN = 0.35;
  var HURT_STUN = 0.22, HURT_INV = 0.60, HURT_KNOCK = 220;
  var OBS_SCALE = 0.35, OBS_INK = 12, INK_FLOOR = 20;
  var PARRY_INK = 18, PARRY_STUN = 0.9;
  var ENV_DRAG = 5;            // 环境速度的自衰减：稳态速度 = envForce 的 ax / 5

  // 普攻三连。第三下明显更重：更长前摇、更长 hitstop、更大震屏、更响。
  var ATK = [
    { dmg: 8, wind: 0.06, act: 0.08, rec: 0.14, hw: 62, hh: 36, ox: 37, oy: -4,
      knock: [170, -40], weight: 'light', ink: 6, lunge: 90, sfx: 'swing1', arc: [-1.0, 0.7] },
    { dmg: 9, wind: 0.06, act: 0.08, rec: 0.14, hw: 66, hh: 40, ox: 39, oy: -2,
      knock: [190, -70], weight: 'mid', ink: 6, lunge: 110, sfx: 'swing2', arc: [1.0, -0.7] },
    { dmg: 14, wind: 0.10, act: 0.08, rec: 0.22, hw: 84, hh: 54, ox: 45, oy: -6,
      knock: [300, -190], weight: 'heavy', ink: 8, lunge: 190, sfx: 'swing3', arc: [-1.5, 1.2] }
  ];

  function make(x, y) {
    var p = {
      tag: 'player', team: 'player', z: 10,
      x: x, y: y, w: 26, h: 52,
      vx: 0, vy: 0, facing: 1,
      scale: 0.86,                 // Figure scale 1 ≈ 64px；0.86 ≈ 55px，略高于 hitbox

      maxHp: 60, hp: 60,
      maxInk: 100, ink: 100,

      state: 'idle', st: 0, prev: 'idle',
      onGround: false, wasGround: false,

      coyote: 0, airJumps: 1, maxAirJumps: 1, bonusJumps: 0,
      invuln: 0, hurtT: 0,
      dashT: 0, dashCd: 0, dashDir: 1, dashTrail: 0,
      atkIdx: 0, atkPhase: 'wind', atkT: 0, comboT: 0, atkHb: null,
      observing: false, parryWindow: false, obsT: 0, parryGlow: 0,
      castPose: null, cast: null,
      dryAcc: 0, dmgMul: 1,
      inkDrainMul: 1,              // 决议 009：G 每帧可设，乘在被动墨耗上（雪山）
      envAx: 0, envAy: 0,          // 决议 009：外部环境加速度，physics 消费后清零
      envVx: 0, envVy: 0,          // 环境速度：与 p.vx 分开积分，不吃走路摩擦
      animT: 0, runPhase: 0, landT: 0,
      dead: false,
      figOpts: null
    };

    // known/slots 直接挂到 Save.data 上（Save.load 会换掉整个 data 对象，
    // 存副本会让 H 的换招菜单和 Tech.learn 写到两份不同的数组里）
    Object.defineProperty(p, 'known', {
      get: function () { return SJ.Save.data.known; },
      set: function (v) { SJ.Save.data.known = v; }
    });
    Object.defineProperty(p, 'slots', {
      get: function () { return SJ.Save.data.slots; },
      set: function (v) { SJ.Save.data.slots = v; }
    });
    Object.defineProperty(p, 'hearts', {
      get: function () { return Math.ceil(this.maxHp / 20); }
    });

    p.cx = function () { return this.x + this.w / 2; };
    p.cy = function () { return this.y + this.h / 2; };
    p.footX = function () { return this.x + this.w / 2; };
    p.footY = function () { return this.y + this.h; };

    p.addInk = function (n) {
      this.ink = SJ.clamp(this.ink + n, 0, this.maxInk);
      return this.ink;
    };

    // 招式没有地板：墨不够就是放不出来
    p.spendInk = function (n) {
      if (this.ink < n) return false;
      this.ink -= n;
      return true;
    };

    // 身法与观势：墨 ≤ 20 时不再扣墨，但依然可用（DESIGN §9.3）。
    // 被动墨耗乘 inkDrainMul（决议 009，雪山用），地板依然生效。
    p.spendSoft = function (n) {
      n = n * (this.inkDrainMul || 1);
      if (this.ink > INK_FLOOR) this.ink = Math.max(INK_FLOOR, this.ink - n);
      return true;
    };

    p.setState = function (s) {
      if (this.state === s) return;
      this.prev = this.state;
      this.state = s;
      this.st = 0;
    };

    p.onParry = function (src) {
      this.addInk(PARRY_INK);
      this.invuln = Math.max(this.invuln, 0.25);
      this.parryGlow = 0.5;
      this.obsT = 0;
      if (src && src.hurt) SJ.Combat.stun(src, PARRY_STUN, this);
    };

    p.hurt = function (dmg, src, opt) {
      opt = opt || {};
      if (this.dead) return;
      if (this.invuln > 0 && !opt.forced) return;

      this.hp = Math.max(0, this.hp - dmg);
      if (this.hp <= 0) { die(this); return; }

      var dir = opt.dir !== undefined ? opt.dir
        : (src ? (this.cx() < (src.cx ? src.cx() : src.x) ? -1 : 1) : -this.facing);
      var k = opt.knock || [HURT_KNOCK, -180];
      this.vx = dir * (k[0] || HURT_KNOCK);
      this.vy = Math.min(this.vy, k[1] === undefined ? -180 : k[1]);
      this.hurtT = opt.stun === undefined ? HURT_STUN : opt.stun;
      this.invuln = HURT_INV;
      this.observing = false;
      this.parryWindow = false;
      cancelAtk(this);
      SJ.Tech.cancel(this);
      this.setState('hurt');

      SJ.Game.shake(6, 0.24);
      SJ.Game.slowmo(0, 0.06);
      SJ.Game.flash(SJ.C.cinnabar, 0.22, 0.20);
      SJ.FX.splash(this.cx(), this.cy(), -dir,
        { n: 6, color: SJ.C.cinnabar, speed: 240 });
      SJ.Audio.sfx('hurt', { vol: 1 });
    };

    p.respawn = function (nx, ny) {
      this.x = nx; this.y = ny;
      this.vx = 0; this.vy = 0;
      this.hp = this.maxHp;
      this.ink = this.maxInk;
      this.dead = false;
      this.invuln = 1.0;
      this.hurtT = 0; this.dashT = 0; this.dashCd = 0;
      this.envAx = 0; this.envAy = 0; this.envVx = 0; this.envVy = 0;
      this.inkDrainMul = 1;
      this.observing = false; this.parryWindow = false;
      this.atkHb = null; this.cast = null; this.castPose = null;
      this.airJumps = this.maxAirJumps;
      this.setState('idle');
    };

    p.update = function (dt) { tick(this, dt); };
    p.draw = function (g) { render(this, g); };

    return p;
  }

  // ── 每帧 ───────────────────────────────────────────────────

  function tick(p, dt) {
    p.st += dt;
    p.animT += dt;
    p.invuln = Math.max(0, p.invuln - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.comboT = Math.max(0, p.comboT - dt);
    p.parryGlow = Math.max(0, p.parryGlow - dt);
    p.landT = Math.max(0, p.landT - dt);
    p.dmgMul = p.ink <= 0 ? 0.6 : 1;      // 枯墨攻击力 -40%

    if (p.state === 'dead') { physics(p, dt, true); figure(p); return; }

    if (p.hurtT > 0) {
      p.hurtT -= dt;
      physics(p, dt, true);
      if (p.hurtT <= 0) p.setState(p.onGround ? 'idle' : 'fall');
      figure(p);
      return;
    }

    if (p.dashT > 0) { dash(p, dt); figure(p); return; }

    inkUpkeep(p, dt);

    if (p.state === 'cast') {
      // 招式由 SJ.Tech.update 驱动位移，这里只跑物理与落地
      physics(p, dt, SJ.Tech.gravityOn(p));
      figure(p);
      return;
    }

    control(p, dt);
    physics(p, dt, true);
    figure(p);
  }

  // ── 墨的维持 ───────────────────────────────────────────────
  function inkUpkeep(p, dt) {
    if (p.observing) p.spendSoft(OBS_INK * dt);

    // 枯墨：每秒掉 1 血，但最低掉到 1 点血为止，永不致死（DESIGN §9.3）
    if (p.ink <= 0 && p.hp > 1) {
      p.dryAcc += dt;
      while (p.dryAcc >= 1) {
        p.dryAcc -= 1;
        p.hp = Math.max(1, p.hp - 1);
        SJ.FX.burst(p.cx(), p.cy(), {
          n: 2, color: SJ.C.cinnabar, speed: 40, spread: 3,
          life: 0.7, size: 2, gravity: 200
        });
      }
    } else {
      p.dryAcc = 0;
    }
  }

  // ── 控制 ───────────────────────────────────────────────────
  function control(p, dt) {
    var I = SJ.Input, ax = I.axis();

    // 观势：长按 guard。按下即入，格挡的手感不能有入场延迟。
    var wantObs = I.down('guard') && p.state !== 'atk1' && p.state !== 'atk2' && p.state !== 'atk3';
    if (wantObs && !p.observing) {
      p.observing = true; p.obsT = 0;
      SJ.Audio.sfx('guard', { vol: 0.7 });
    } else if (!wantObs && p.observing) {
      p.observing = false;
    }
    p.parryWindow = p.observing;
    if (p.observing) {
      p.obsT += dt;
      // 每帧只挂 2 帧的慢镜：松手立刻恢复，slows 数组也不会堆积
      SJ.Game.slowmo(OBS_SCALE, 0.034);
    }

    // 招式槽
    var TK = ['t1', 't2', 't3', 't4'];
    for (var i = 0; i < 4; i++) {
      if (I.pressed(TK[i]) && p.slots[i]) {
        if (SJ.Tech.use(p, p.slots[i])) { I.consume(TK[i]); return; }
      }
    }

    // 攻击
    if (isAtk(p.state)) { atkTick(p, dt); return; }
    if (I.buffered('attack', 120) && p.dashT <= 0) {
      I.consume('attack');
      p.observing = false; p.parryWindow = false;
      startAtk(p, p.comboT > 0 ? p.atkIdx % 3 : 0);
      return;
    }

    // 身法
    if (I.pressed('dash') && p.dashCd <= 0) {
      I.consume('dash');
      startDash(p, ax);
      return;
    }

    // 走
    var spd = p.observing ? RUN * 0.45 : RUN;
    if (ax !== 0) {
      p.vx += ax * ACC * dt;
      if (Math.abs(p.vx) > spd) p.vx = ax * spd;
      p.facing = ax;
    } else {
      var f = FRIC * dt;
      if (Math.abs(p.vx) <= f) p.vx = 0; else p.vx -= Math.sign(p.vx) * f;
    }

    // 跳（土狼时间 + 跳跃缓冲 + 可变跳高）
    if (p.onGround) { p.coyote = COYOTE; p.airJumps = p.maxAirJumps + p.bonusJumps; }
    else p.coyote = Math.max(0, p.coyote - dt);

    if (I.buffered('jump', JBUF * 1000)) {
      if (I.down('down') && p.onGround) {
        I.consume('jump');
        p.dropThrough = true;                 // 下穿单向平台
        p.y += 1;
      } else if (p.coyote > 0) {
        I.consume('jump');
        jump(p, JUMP, 'jump');
      } else if (p.airJumps > 0) {
        I.consume('jump');
        p.airJumps--;
        jump(p, JUMP2, 'jump');
        SJ.FX.ring(p.cx(), p.footY(), { r: 4, r1: 34, color: SJ.C.inkLight, life: 0.28, w: 1.6 });
      }
    }
    if (I.released('jump') && p.vy < JUMP_SHORT) p.vy = JUMP_SHORT;

    // 蹲
    var crouch = I.down('down') && p.onGround && Math.abs(p.vx) < 20;

    // 状态选择
    if (p.observing) p.setState('observe');
    else if (!p.onGround) p.setState(p.vy < 0 ? 'jump' : 'fall');
    else if (p.landT > 0) p.setState('land');
    else if (crouch) p.setState('crouch');
    else if (Math.abs(p.vx) > 12) p.setState('run');
    else p.setState('idle');
  }

  function jump(p, v, snd) {
    p.vy = v;
    p.coyote = 0;
    p.onGround = false;
    p.setState('jump');
    SJ.Audio.sfx('jump', { vol: 0.75 });
    SJ.FX.dust(p.cx(), p.footY(), 0);
  }

  // ── 身法 ───────────────────────────────────────────────────
  function startDash(p, ax) {
    p.spendSoft(DASH_INK);
    p.dashDir = ax !== 0 ? ax : p.facing;
    p.facing = p.dashDir;
    p.dashT = DASH_T;
    p.dashCd = DASH_CD;
    p.dashTrail = 0;
    p.invuln = Math.max(p.invuln, DASH_INV);
    p.observing = false; p.parryWindow = false;
    cancelAtk(p);
    p.setState('dash');
    p.vy = 0;
    SJ.Audio.sfx('dash', { vol: 0.9 });
    SJ.FX.dust(p.cx(), p.footY(), -p.dashDir);
    SJ.Game.shake(2.2, 0.10);
  }

  function dash(p, dt) {
    p.dashT -= dt;
    p.vx = p.dashDir * DASH_V;
    p.vy = 0;
    p.dashTrail += dt;
    if (p.dashTrail >= 0.025) {
      p.dashTrail = 0;
      figure(p);                       // 残影读的是 figOpts（决议 001 §4）
      SJ.FX.trail(p, { life: 0.26, alpha: 0.30, color: SJ.C.ink });
    }
    physics(p, dt, false);
    if (p.dashT <= 0) {
      p.vx *= 0.42;
      p.setState(p.onGround ? 'idle' : 'fall');
    }
  }

  // ── 普攻三连 ───────────────────────────────────────────────
  function isAtk(s) { return s === 'atk1' || s === 'atk2' || s === 'atk3'; }

  function startAtk(p, idx) {
    var a = ATK[idx];
    p.atkIdx = idx + 1;
    p.atkPhase = 'wind';
    p.atkT = 0;
    p.atkHb = null;
    p.setState('atk' + (idx + 1));
    if (SJ.Input.axis() !== 0) p.facing = SJ.Input.axis();
    SJ.Audio.sfx(a.sfx, { vol: idx === 2 ? 1.0 : 0.8, rate: 1 + idx * 0.05 });
  }

  function cancelAtk(p) {
    if (p.atkHb) { p.atkHb.dead = true; p.atkHb = null; }
    p.atkPhase = 'wind';
  }

  function atkTick(p, dt) {
    var idx = p.atkIdx - 1, a = ATK[idx], I = SJ.Input;
    p.atkT += dt;

    // 攻击中的移动：极大衰减，但保留一点点操控
    var ax = I.axis();
    if (ax !== 0 && p.atkPhase !== 'hit') p.vx += ax * ACC * 0.18 * dt;
    p.vx *= Math.pow(0.02, dt);

    if (p.atkPhase === 'wind') {
      if (p.atkT >= a.wind) {
        p.atkPhase = 'hit'; p.atkT = 0;
        p.vx += p.facing * a.lunge;                       // 出剑的前冲
        p.atkHb = SJ.Combat.hit({
          x: p.cx() + (p.facing > 0 ? a.ox - a.hw / 2 : -a.ox - a.hw / 2),
          y: p.cy() + a.oy - a.hh / 2,
          w: a.hw, h: a.hh,
          dmg: a.dmg, team: 'player', owner: p, ttl: a.act,
          knock: a.knock, stun: 0.18 + idx * 0.06, type: 'slash',
          weight: a.weight, ink: a.ink, pierce: idx === 2,
          guardBreak: idx === 2,
          onHit: function () { }
        });
        // 挥毫弧线：第三下明显更大更重
        var tipx = p.cx() + p.facing * a.ox, tipy = p.cy() + a.oy;
        SJ.FX.slash(tipx, tipy, a.arc[0] * p.facing, a.arc[1] * p.facing,
          a.hw * 0.62, { color: SJ.C.ink, w: 4 + idx * 2.4, life: 0.13 + idx * 0.04 });
      }
    } else if (p.atkPhase === 'hit') {
      if (p.atkT >= a.act) { p.atkPhase = 'rec'; p.atkT = 0; p.atkHb = null; p.comboT = COMBO_WIN; }
    } else {
      // 后摇可被下一段取消 —— 三连打起来的干脆全靠这条
      if (p.atkIdx < 3 && I.buffered('attack', 120)) {
        I.consume('attack');
        startAtk(p, p.atkIdx);
        return;
      }
      if (p.atkT >= a.rec) {
        p.atkIdx = p.atkIdx >= 3 ? 0 : p.atkIdx;
        p.setState(p.onGround ? 'idle' : 'fall');
      }
    }
  }

  // ── 物理 ───────────────────────────────────────────────────
  function physics(p, dt, gravity) {
    // 环境力（风、水流…）：无论这一帧走不走时间都要清掉，
    // 否则 hitstop 期间 G 累加的风会攒起来，解冻那一帧把人吹飞。
    var eax = p.envAx, eay = p.envAy;
    p.envAx = 0; p.envAy = 0;

    if (dt <= 0) return;
    if (gravity) {
      p.vy += SJ.GRAVITY * dt;
      if (p.vy > SJ.MAXFALL) p.vy = SJ.MAXFALL;
    }

    // 环境速度单独存，不并进 p.vx：
    // 走路的摩擦是 3200，任何小于它的风都会被当帧抹平，
    // 于是 3200 以下毫无反应、以上直接失控 —— 那不是旋钮，是悬崖。
    // 分开积分后风是线性可调的：稳态速度 = ax / ENV_DRAG。
    p.envVx += eax * dt;
    p.envVy += eay * dt;
    var ed = Math.exp(-ENV_DRAG * dt);
    p.envVx *= ed;
    p.envVy *= ed;
    if (Math.abs(p.envVx) < 0.5) p.envVx = 0;
    if (Math.abs(p.envVy) < 0.5) p.envVy = 0;

    p.wasGround = p.onGround;
    SJ.World.moveX(p, (p.vx + p.envVx) * dt);
    var fell = p.vy;
    SJ.World.moveY(p, (p.vy + p.envVy) * dt);

    if (p.onGround && !p.wasGround) {
      p.airJumps = p.maxAirJumps + p.bonusJumps;
      if (fell > 320) {
        p.landT = 0.09;
        SJ.FX.dust(p.cx(), p.footY(), 0);
        SJ.Audio.sfx('land', { vol: SJ.clamp(fell / 1100, 0.3, 1) });
        if (fell > 780) SJ.Game.shake(3, 0.12);
      }
    }
  }

  function die(p) {
    p.hp = 0;
    p.dead = false;                 // 不从实体表里移除，尸体要留在场上
    p.setState('dead');
    p.vx = -p.facing * 120;
    p.vy = -260;
    p.observing = false; p.parryWindow = false;
    SJ.Game.slowmo(0.25, 0.9);
    SJ.Game.shake(9, 0.5);
    SJ.Audio.sfx('death', { vol: 1 });
    SJ.FX.splash(p.cx(), p.cy(), 0, { n: 12, color: SJ.C.cinnabar, speed: 260 });
  }

  // ── 姿势与绘制 ─────────────────────────────────────────────

  // 每帧维护 figOpts（决议 001 §4）—— 残影/分身/瞬移全靠它
  function figure(p) {
    var name = 'idle', prog = 0, t = p.animT;

    switch (p.state) {
      case 'run':
        p.runPhase += Math.abs(p.vx) * 0.0022;
        name = 'run'; prog = p.runPhase % 1; break;
      case 'jump': name = p.vy < -120 ? 'jump' : 'rise'; prog = SJ.clamp(p.st / 0.28, 0, 1); break;
      case 'fall': name = 'fall'; prog = SJ.clamp(p.st / 0.35, 0, 1); break;
      case 'land': name = 'land'; prog = SJ.clamp(1 - p.landT / 0.09, 0, 1); break;
      case 'crouch': name = 'crouch'; prog = SJ.clamp(p.st / 0.12, 0, 1); break;
      case 'dash': name = 'dashF'; prog = SJ.clamp(1 - p.dashT / DASH_T, 0, 1); break;
      case 'observe': name = 'observe'; prog = SJ.clamp(p.obsT / 0.3, 0, 1); break;
      case 'hurt': name = 'hurt'; prog = SJ.clamp(1 - p.hurtT / HURT_STUN, 0, 1); break;
      case 'dead': name = p.st > 0.5 ? 'dead' : 'down'; prog = SJ.clamp(p.st / 0.6, 0, 1); break;
      case 'cast': name = p.castPose || 'castWind'; prog = SJ.clamp(p.st / 0.3, 0, 1); break;
      case 'atk1': case 'atk2': case 'atk3': {
        var i = p.atkIdx - 1, a = ATK[i];
        var ph = p.atkPhase, dur = ph === 'wind' ? a.wind : ph === 'hit' ? a.act : a.rec;
        name = 'atk' + (i + 1) + '_' + (ph === 'hit' ? 'hit' : ph);
        prog = SJ.clamp(p.atkT / dur, 0, 1);
        break;
      }
      default:
        name = 'idle'; prog = (t * 0.42) % 1;
    }

    var o = p.figOpts;
    if (!o) o = p.figOpts = {};
    o.x = p.footX();
    o.y = p.footY();
    o.facing = p.facing;
    o.scale = p.scale;
    o.pose = SJ.Figure.pose(name, prog, t);
    o.poseName = name;
    o.weapon = 'jian';
    o.color = SJ.C.ink;
    o.alpha = 1;
    o.lineScale = 1;
    o.cloth = SJ.clamp(0.25 + Math.abs(p.vx) / RUN * 0.7 + (p.onGround ? 0 : 0.35), 0, 1.4);
    o.t = t;
  }

  function render(p, g) {
    var o = p.figOpts;
    if (!o) return;

    // 无敌帧：一闪一闪，但不要闪到看不见人
    var a = 1;
    if (p.invuln > 0 && p.state !== 'dash' && p.hp > 0) {
      a = (Math.floor(SJ.Game.time * 22) % 2) ? 0.42 : 1;
    }

    // 观势：主角自身反而更实，画面其余部分褪去（G 负责世界褪色）
    if (p.observing) {
      g.save();
      g.globalAlpha = 0.14;
      SJ.Ink.blob(g, p.cx(), p.cy(), 42 + Math.sin(SJ.Game.time * 3) * 3,
        7, { color: SJ.C.stone, alpha: 0.14 });
      g.restore();
    }

    if (p.parryGlow > 0) {
      g.save();
      g.globalAlpha = p.parryGlow / 0.5 * 0.5;
      SJ.Ink.blob(g, p.cx(), p.cy(), 30 + (1 - p.parryGlow / 0.5) * 42,
        13, { color: SJ.C.cinnabar, alpha: 0.5 });
      g.restore();
    }

    o.alpha = a;
    SJ.Figure.draw(g, o);
    o.alpha = 1;
  }

  // ── 模块出口 ───────────────────────────────────────────────

  SJ.Player = {

    create: function (x, y) {
      var p = make(x, y);
      var d = SJ.Save.data;
      if (d.maxHp) { p.maxHp = d.maxHp; p.hp = SJ.clamp(d.hp || d.maxHp, 1, d.maxHp); }
      SJ.player = p;
      SJ.Ent.add(p);
      return p;
    },

    // 1 = 墨满，0 = 枯墨。G 在 Level.draw 末尾据此覆盖纸色。
    inkTint: function () {
      var p = SJ.player;
      if (!p) return 1;
      return Math.pow(SJ.clamp(p.ink / p.maxInk, 0, 1), 0.7);
    },

    // 决议 007 §1：招式槽的唯一写入者。H 的换招菜单调这个，不要自己写 Save.data.slots。
    setSlot: function (i, moveId) {
      if (i < 0 || i > 3) return false;
      var p = SJ.player;
      if (moveId && SJ.Save.data.known.indexOf(moveId) < 0) return false;
      // 同一招不能占两个槽：先把它从别的槽里摘掉
      if (moveId) {
        for (var k = 0; k < 4; k++) {
          if (k !== i && SJ.Save.data.slots[k] === moveId) SJ.Save.data.slots[k] = null;
        }
      }
      SJ.Save.data.slots[i] = moveId || null;
      if (p) p.slots[i] = moveId || null;      // p.slots 是取值器，指向同一份，这行是显式冗余
      SJ.Save.save();
      return true;
    },

    // 决议 009 §1：外部环境加速度（第四回的风、第三回的浮筏）。
    // 每帧累加，physics 消费后清零 —— G 不要直接改 p.vx。
    envForce: function (ax, ay) {
      var p = SJ.player;
      if (!p) return;
      p.envAx += ax || 0;
      p.envAy += ay || 0;
    }
  };

})(window.SJ = window.SJ || {});
