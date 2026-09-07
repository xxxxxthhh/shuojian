// 【E】命中判定 / 起手式（telegraph）/ 观势格挡 / 学习进度派发。
//
// 判定顺序（CONTRACTS 硬性）：
//   目标处于「完美观势」窗口 → 格挡成功（走 SJ.Player.onParry）；否则 target.hurt(...)
//
// 本文件同时是「命中三件套」的唯一出口：任何一次命中都会产生
// hitstop + 屏幕轻震 + 墨点飞溅。别的模块不要各自实现。
(function (SJ) {
  'use strict';

  var hits = [];      // 活着的 hitbox
  var tgs = [];       // 活着的 telegraph
  var burns = [];     // 点燃 DoT（fenshu / type:'fire'）
  var uid = 1;
  var lastParry = null;   // {owner,t} 一次挥砍只结算一次格挡奖励

  // ── 命中确认的四档（增强波次 P1-7）──────────────────────────
  //
  //   轻击 light   —— 普攻前两段、擦到的杂招
  //   重击 heavy   —— 招式命中、破防斩
  //   完美格挡 parry —— 观势读中的那一下
  //   处决 execute  —— 全场最重的一击（镇山、说剑的重斩、Boss 破防）
  //
  // 改造之前这四种反馈是散在三个地方的裸数字（WEIGHT 表、parryFx 里的字面量、
  // 各招 exec 里自己调的 slowmo），没有「档」的概念，所以谁比谁重说不清楚。
  // 现在四档收进一张表，**数值一个都没动**：
  //   45 → 90 → 100 → 140ms，严格递增，每一档都等于改造前的原值（Δ=0ms）。
  // 这条「不许变粘」的约束由 dev/player-check.js §10 用字面量钉死。
  // 五个轴全部**严格递增**，一档一档看得出来：
  //   停顿 45 → 90 → 100 → 140ms       （Δ=0，与改造前逐位相同，手感不许变粘）
  //   震幅  3 →  7 →  10 →  13         （峰值仍是 13，没有新的最大值）
  //   墨点  3 →  8 →  12 →  16
  //   甩速 180 → 320 → 400 → 480       （原来是 200+震幅×20 推出来的，现在显式分档）
  //   音量 .70 → .85 → .95 → 1.00      （原来是 0.8/1/1/1，四档里三档一个值）
  // 改造前这四档在震幅/墨点/音量上几乎分不出来：轻击与重击的音量一样响，
  // 完美格挡的震幅比重击还小。停顿是唯一有层次的轴，而停顿恰恰是最不该动的那个。
  var TIER = {
    light: { key: 'light', name: '轻击', stop: 0.045, shake: 3.0, splash: 3, spray: 180, sfx: 'hit', vol: 0.70 },
    heavy: { key: 'heavy', name: '重击', stop: 0.090, shake: 7.0, splash: 8, spray: 320, sfx: 'hitHeavy', vol: 0.85 },
    parry: { key: 'parry', name: '完美格挡', stop: 0.100, shake: 10.0, splash: 12, spray: 400, sfx: 'parry', vol: 0.95 },
    execute: { key: 'execute', name: '处决', stop: 0.140, shake: 13.0, splash: 16, spray: 480, sfx: 'hitHeavy', vol: 1.00 }
  };

  // 「挡开」：**不是第五档**。四档说的是「这一下有多重」，挡开说的是「这一下不算数」。
  // 触发条件是 hitbox 命中了一个 invuln 的目标（Boss 换势、身法无敌、受击无敌帧）。
  // 改造前这条分支是**静默 return**：没停顿、没墨点、没声音，玩家分不清自己是挥空了
  // 还是被挡开了。Boss 换势有 1.0–1.3s 无敌，一顿砍下去屏幕上什么都不发生。
  // hitstop 取 **0**：换势期间玩家可能连着砍中七八下，哪怕一帧一次也会糊成一片粘滞。
  // 不掉血、不进任何进度统计（Tech.gain 在这条分支之后，天然不会走到）。
  var DEFLECT = { key: 'deflect', name: '挡开', stop: 0, shake: 2.0, sfx: 'block', vol: 0.55 };

  // hitbox 的 weight 是四级细分，落到上面的档上。
  // mid 是**过渡**不是独立档：它只为三连第二段而存在（45→60→90 让第三下明显更重，
  // 90 以上会把连段切成三次独立挥砍——notes-E 实测过 110ms，退回来了）。
  var WEIGHT = {
    light: TIER.light,
    mid: { key: 'mid', name: '轻击·中', stop: 0.060, shake: 5.0, splash: 5, spray: 250, sfx: 'hit', vol: 0.78 },
    heavy: TIER.heavy,
    huge: TIER.execute
  };

  function cx(e) { return e.cx ? e.cx() : e.x + e.w / 2; }
  function cy(e) { return e.cy ? e.cy() : e.y + e.h / 2; }

  var Combat = {

    // 命中确认四档（只读；T3 / 测试按 key 取值，别改表里的数）
    TIER: TIER,
    // 「挡开」反馈的参数（不是第五档，见上方注释）
    DEFLECT: DEFLECT,

    // 起手式全表，供渲染与 AI 读取
    tgList: tgs,
    hitList: hits,

    // 最近一次「对玩家生效」的敌方招式 id（被打中或被格挡都算）。说剑靠它复制。
    lastFoeMove: null,

    // 最近一次玩家「使出」的招式 id（决议 008 §1，师兄 P3 现学现用靠它）。
    // 注意是创建 hitbox 时就记，不是命中时 —— 你挥空了他也看见了。
    lastPlayerMove: null,

    // 调试开关，dev/player.html 用
    debug: { hitbox: false, tgAlways: false },

    // ── hitbox ────────────────────────────────────────────────
    // o = {x,y,w,h, dmg, team, owner, ttl, knock:[kx,ky], stun, type,
    //      pierce, moveId, onHit(target,hb), hitstop}
    // 扩展（可选）：follow/ox/oy 跟随 owner、weight 反馈分级、ink 命中回墨、
    //              guardBreak 破防、launch 浮空、burn 点燃、maxHits、silent
    hit: function (o) {
      o = o || {};
      var hb = {
        id: uid++,
        x: o.x || 0, y: o.y || 0, w: o.w || 0, h: o.h || 0,
        dmg: o.dmg || 0,
        team: o.team || 'foe',
        owner: o.owner || null,
        ttl: o.ttl === undefined ? 0.08 : o.ttl,
        knock: o.knock || [0, 0],
        stun: o.stun === undefined ? 0.2 : o.stun,
        type: o.type || 'slash',
        pierce: !!o.pierce,
        moveId: o.moveId || null,
        onHit: o.onHit || null,
        hitstop: o.hitstop,
        weight: o.weight || null,
        ink: o.ink === undefined ? null : o.ink,
        guardBreak: !!o.guardBreak,
        launch: !!o.launch,
        burn: o.burn === undefined ? (o.type === 'fire' ? 2.5 : 0) : o.burn,
        maxHits: o.maxHits === undefined ? (o.pierce ? 99 : 99) : o.maxHits,
        silent: !!o.silent,
        follow: o.follow || null,
        ox: o.ox || 0, oy: o.oy || 0,
        t: 0,
        struck: [],
        n: 0,
        dead: false
      };
      // 决议 008 §1：玩家用出一招的唯一记录点（创建即记录，挥空也算）
      if (hb.team === 'player' && hb.moveId) Combat.lastPlayerMove = hb.moveId;

      if (hb.follow) place(hb);
      hits.push(hb);
      return hb;
    },

    // ── telegraph ─────────────────────────────────────────────
    // o = {owner, moveId, dur, path:[[x,y],...]（相对 owner 中心，x 按 facing 镜像）,
    //      danger:true, tier:'light'|'heavy'|'grab'}
    // danger:false = 守势型起手式（守阁人）：可被观势读取，但不会打人。
    //
    // 决议 014：tier 只管**画法**，不动 path / dur / danger 的语义，
    // 也不动「这一招能不能格挡」的规则。缺省 'light' = 完全向后兼容。
    // 拼错的 tier 一律退回 'light'（不报错但也不静默变成别的画法）。
    telegraph: function (o) {
      o = o || {};
      var tg = {
        id: uid++,
        owner: o.owner || null,
        moveId: o.moveId || null,
        dur: o.dur === undefined ? 0.5 : o.dur,
        path: o.path || [],
        danger: o.danger !== false,
        tier: TIER_STYLE[o.tier] ? o.tier : 'light',
        color: o.color || null,
        t: 0,
        obs: 0,          // 玩家观势累计读取时间
        read: false,     // 守势型是否已经给过进度
        window: false,   // 判定命中的那一帧
        dead: false
      };
      tgs.push(tg);
      return tg;
    },

    // 起手式的绝对轨迹点（世界坐标）
    tgPoints: function (tg) {
      var e = tg.owner, out = [], i, p;
      if (!e) return out;
      var ex = cx(e), ey = cy(e), f = e.facing || 1;
      for (i = 0; i < tg.path.length; i++) {
        p = tg.path[i];
        out.push([ex + (p.length ? p[0] : p.x) * f, ey + (p.length ? p[1] : p.y)]);
      }
      return out;
    },

    // 找 owner 当前活着的起手式（F 结算招式时用来标 window）
    tgOf: function (owner, moveId) {
      for (var i = 0; i < tgs.length; i++) {
        if (tgs[i].owner === owner && (!moveId || tgs[i].moveId === moveId)) return tgs[i];
      }
      return null;
    },

    // 硬直的统一入口：复用 hurt(0,...) 契约，不新增字段（见 notes-E.md）
    stun: function (ent, sec, src) {
      if (!ent || ent.dead) return;
      if (ent.hurt) ent.hurt(0, src || null, { stun: sec, parried: true, knock: [0, 0] });
    },

    burn: function (ent, sec, src) {
      if (!ent || ent.dead || sec <= 0) return;
      for (var i = 0; i < burns.length; i++) {
        if (burns[i].ent === ent) { burns[i].t = Math.max(burns[i].t, sec); return; }
      }
      burns.push({ ent: ent, t: sec, acc: 0, src: src || null });
    },

    // ── 每帧解算 ───────────────────────────────────────────────
    update: function (dt) {
      var i, j;

      // 起手式推进
      for (i = tgs.length - 1; i >= 0; i--) {
        var tg = tgs[i];
        if (tg.dead || !tg.owner || tg.owner.dead) { tgs.splice(i, 1); continue; }
        tg.t += dt;

        // 观势读取：守势型（danger:false）靠「看满」拿进度，这是无锋的唯一学习路径
        if (observing()) {
          tg.obs += dt;
          if (!tg.danger && !tg.read && tg.obs >= tg.dur * 0.5 &&
              Math.abs(cx(tg.owner) - SJ.player.cx()) < 400) {
            tg.read = true;
            if (tg.moveId) SJ.Tech.gain(tg.moveId, 34);
            SJ.Audio.sfx('qi', { vol: 0.7 });
            SJ.FX.ring(cx(tg.owner), cy(tg.owner), { r: 26, r1: 70, color: SJ.C.stone, life: 0.5 });
          }
        }
        if (tg.t >= tg.dur) { tg.dead = true; tgs.splice(i, 1); }
      }

      // hitbox 解算
      for (i = hits.length - 1; i >= 0; i--) {
        var hb = hits[i];
        if (hb.dead) { hits.splice(i, 1); continue; }
        if (hb.follow) {
          if (hb.follow.dead) { hits.splice(i, 1); continue; }
          place(hb);
        }
        resolve(hb);
        hb.t += dt;
        if (hb.t >= hb.ttl || hb.dead) { hits.splice(i, 1); }
      }

      // 点燃 DoT：3 点/秒
      for (i = burns.length - 1; i >= 0; i--) {
        var b = burns[i];
        if (!b.ent || b.ent.dead || b.ent.hp <= 0) { burns.splice(i, 1); continue; }
        b.t -= dt; b.acc += dt;
        if (b.acc >= 0.5) {
          b.acc -= 0.5;
          b.ent.hurt(1.5, b.src, { type: 'fire', stun: 0, knock: [0, 0], silent: true });
          SJ.FX.burst(cx(b.ent), cy(b.ent), {
            n: 3, color: SJ.C.cinnabar, speed: 70, spread: 2.4, angle: -Math.PI / 2,
            life: 0.4, size: 2.4, gravity: -120
          });
        }
        if (b.t <= 0) burns.splice(i, 1);
      }
    },

    clear: function () {
      hits.length = 0;
      tgs.length = 0;
      burns.length = 0;
      lastParry = null;
      Combat.lastFoeMove = null;
      Combat.lastPlayerMove = null;
    },

    // ── 起手式渲染（世界坐标，由 Level.draw 在 camera 变换内调用）─────
    // 这是「观势」在视觉上唯一的教学手段：
    //   不观势 → 断续、模糊、抖，读不出来
    //   观势   → 完整、清晰、一颗光珠沿轨迹走完 = 这一招落下的时刻
    draw: function (g) {
      var obs = observing() || Combat.debug.tgAlways;
      for (var i = 0; i < tgs.length; i++) drawTg(g, tgs[i], obs);
      if (Combat.debug.hitbox) drawDebug(g);
    }
  };

  // ── 内部 ───────────────────────────────────────────────────

  function observing() {
    var p = SJ.player;
    return !!(p && !p.dead && p.observing);
  }

  function place(hb) {
    var e = hb.follow, f = e.facing || 1;
    hb.x = cx(e) + hb.ox * f - hb.w / 2;
    hb.y = cy(e) + hb.oy - hb.h / 2;
  }

  function resolve(hb) {
    var list = SJ.Ent.list, i, e;
    for (i = 0; i < list.length; i++) {
      e = list[i];
      if (e.dead || !e.hurt) continue;
      if (e.team === hb.team) continue;
      if (e === hb.owner) continue;
      if (e.hp !== undefined && e.hp <= 0) continue;
      if (!SJ.aabb(hb, e)) continue;
      if (hb.struck.indexOf(e) >= 0) continue;   // 同一 hitbox 对同一目标只结算一次

      hb.struck.push(e);
      strike(hb, e);
      hb.n++;
      if (!hb.pierce && hb.n >= 1) { hb.dead = true; return; }
      if (hb.n >= hb.maxHits) { hb.dead = true; return; }
    }
  }

  function strike(hb, e) {
    var p = SJ.player, isPlayer = (e === p);
    var px = (hb.x + hb.w / 2 + cx(e)) / 2;
    var py = (hb.y + hb.h / 2 + cy(e)) / 2;
    var dir = cx(e) < hb.x + hb.w / 2 ? -1 : 1;

    // 敌方招式打到玩家 → 记下 moveId，说剑要复制它
    if (isPlayer && hb.moveId) Combat.lastFoeMove = hb.moveId;

    // ①「完美观势」优先于一切（必须排在无敌帧之前：身法残留的无敌不能吃掉格挡）
    if (isPlayer && p.parryWindow) {
      var tg = hb.owner ? Combat.tgOf(hb.owner, hb.moveId) : null;
      if (tg) tg.window = true;

      // 一次挥砍可能有多个 hitbox（力士三连踢）。伤害每个都要挡掉，
      // 但奖励只能结算一次 —— 否则三脚被格挡 = 34×3 = 直接学会。
      // 窗口用游戏时间 0.25s：多段招的分段间隔都在 0.2s 以内，
      // 而我给 F 的建议是同一敌人两次起手式至少隔 0.9s，不会误伤真正的第二次格挡。
      // （不能放大到 0.4s：观势时游戏时间只走 0.35×，0.4s 相当于真实 1.1s。）
      var now = SJ.Game.time;
      var fresh = !lastParry || lastParry.owner !== hb.owner || (now - lastParry.t) > 0.25;
      if (fresh) {
        lastParry = { owner: hb.owner, t: now };
        p.onParry(hb.owner, hb);          // 回墨 + 无敌 + 敌人硬直（stun 在 onParry 内，别在这里再调一次）
        if (hb.moveId) SJ.Tech.gain(hb.moveId, 34);
        parryFx(px, py, dir, e);
      }
      return;
    }

    // ② 无敌帧（身法 / 受击后 / Boss 换势）—— 不掉血。
    //
    // **只在玩家打人时给「挡开」回馈**（`!isPlayer`），玩家自己在受击无敌 0.6s
    // 或冲刺无敌里被打时保持静默。理由：那不是「挡住了」，那是无敌帧；
    // 响一声 block 等于告诉玩家「你挡住了」，会把他往错的方向教
    //（真正的「挡」是观势格挡，有完全不同的一整套反馈），多敌围攻时还吵。
    //
    // 反过来玩家砍无敌目标必须给：Boss 换势有 1.0–1.3s 无敌，
    // 「什么都没发生」和「挥空了」在屏幕上长得一模一样，玩家没法学。
    if (e.invuln > 0) {
      if (!isPlayer && !hb.silent) deflectFx(hb, e, px, py, dir);
      return;
    }

    // ③ 正常受击
    var opt = {
      knock: hb.knock, stun: hb.stun, type: hb.type, moveId: hb.moveId,
      guardBreak: hb.guardBreak, launch: hb.launch, dir: dir, hb: hb
    };
    var dmg = hb.dmg;
    if (hb.owner === p && p.dmgMul !== undefined) dmg = dmg * p.dmgMul;   // 枯墨 -40%
    e.hurt(dmg, hb.owner, opt);

    // 挨打也在学：残墨 +12
    if (isPlayer && hb.moveId) SJ.Tech.gain(hb.moveId, 12);

    if (hb.burn > 0) Combat.burn(e, hb.burn, hb.owner);
    if (hb.ink && hb.owner === p) p.addInk(hb.ink);
    if (hb.onHit) hb.onHit(e, hb);

    if (!hb.silent) hitFx(hb, e, px, py, dir, dmg);
  }

  // 墨点该落到哪条线上：优先取命中点正下方真正的地面，
  // 找不到（悬空、深坑）再退回目标脚底。
  function groundLine(x, y, e) {
    var gy = SJ.World.groundAt(x, y);
    return gy == null ? e.y + e.h : gy;
  }

  // SJ.FX.splash 的第三参是**弧度角**，不是 ±1（fx.js 里 base = dir）。
  // y 向下为正，所以「朝斜上方甩开」：dir>0 取 -0.6，dir<0 取 -(π-0.6)。
  // 传 ±1 的话 1 和 -1 会甩向同一侧（cos1 与 cos(-1) 同号），墨点方向就永远是错的。
  function sprayAngle(dir) {
    return dir > 0 ? -0.6 : -(Math.PI - 0.6);
  }

  // 命中三件套：hitstop + 屏幕轻震 + 墨点飞溅。缺一不可。
  // 四档里的「轻击 / 重击 / 处决」三档从这里出；「完美格挡」走 parryFx。
  function hitFx(hb, e, px, py, dir, dmg) {
    var w = WEIGHT[hb.weight] || (dmg >= 14 ? WEIGHT.heavy : dmg >= 9 ? WEIGHT.mid : WEIGHT.light);
    var stop = hb.hitstop === undefined ? w.stop : hb.hitstop;

    SJ.Game.slowmo(0, stop);
    SJ.Game.shake(w.shake, 0.16 + stop);
    // groundY 必须传：不传墨点只在半空原地晕开，
    // DESIGN §1 要的「飞出去、落地晕开、留在纸上」就少了三分之一。
    SJ.FX.splash(px, py, sprayAngle(dir), {
      n: w.splash, color: SJ.C.ink, speed: w.spray,
      groundY: groundLine(px, py, e)
    });
    SJ.FX.slash(px, py, -0.9 * dir, 0.9 * dir, 26 + w.shake * 2.2,
      { color: SJ.C.ink, w: 5 + w.shake * 0.45 });
    SJ.Audio.sfx(w.sfx, { vol: w.vol, pan: SJ.clamp((px - SJ.Camera.x - SJ.W / 2) / (SJ.W / 2), -1, 1) });
  }

  // 「完美格挡」档。数值全部来自 TIER.parry —— 这一档比重击更长（100 > 90ms）
  // 是有意的：格挡是玩家做对了一件难事，那一下要比他自己砍中更响。
  // 定格之后再挂半拍 0.25× 慢镜，是格挡独有的「回味」，不属于四档表。
  // 「挡开」：一圈淡墨环 + 一笔短横 + block 音。没有停顿、没有墨点飞溅
  //（墨点是「见血」的语言，这一下没见血），不掉血、不给进度。
  // 单向：只在玩家的攻击被无敌目标吃掉时出现，见调用点的注释。
  function deflectFx(hb, e, px, py, dir) {
    var w = DEFLECT;
    SJ.Game.shake(w.shake, 0.10);
    SJ.FX.ring(px, py, { r: 5, r1: 34, color: SJ.C.inkLight, life: 0.26, w: 2.0 });
    SJ.FX.slash(px, py, -0.35 * dir, 0.35 * dir, 18, { color: SJ.C.inkLight, w: 3.0, life: 0.10 });
    SJ.Audio.sfx(w.sfx, {
      vol: w.vol, rate: 1.15,
      pan: SJ.clamp((px - SJ.Camera.x - SJ.W / 2) / (SJ.W / 2), -1, 1)
    });
  }

  function parryFx(px, py, dir, e) {
    var w = TIER.parry;
    SJ.Game.slowmo(0, w.stop);
    SJ.Game.slowmo(0.25, 0.22);
    SJ.Game.shake(w.shake, 0.22);
    SJ.Game.flash(SJ.C.paper, 0.18, 0.42);
    SJ.FX.ring(px, py, { r: 8, r1: 96, color: SJ.C.cinnabar, life: 0.42, w: 3.4 });
    SJ.FX.burst(px, py, {
      n: 14, color: SJ.C.cinnabar, speed: 340, spread: Math.PI * 2,
      life: 0.5, size: 3, gravity: 900, drag: 2.4
    });
    SJ.FX.slash(px, py, -1.5 * dir, 1.5 * dir, 46, { color: SJ.C.cinnabar, w: 7 });
    SJ.FX.splash(px, py, sprayAngle(dir), {
      n: w.splash, color: SJ.C.cinnabar, speed: w.spray, groundY: groundLine(px, py, e)
    });
    SJ.Audio.sfx(w.sfx, { vol: w.vol });
  }

  // 决议 014（修订版）：三档预警的画法。改颜色/线宽只动这张表，别散到 drawTg 里去。
  //   light 可格挡的普通招 —— **现状一模一样**：朱砂细线，×1.0，单笔
  //   heavy superArmor / 不可挡的大招 —— 朱砂 ×1.6 + 路径端点一个实心朱砂「势」点
  //   grab  突进 / 抓取 —— 朱砂主线 + 外圈淡墨线（双线）
  //
  // 分层是往「更重」做，不往「更淡」做：墨线画在墨画的世界里显著性掉一截，
  // 而玩家已经学会了「红线 = 来招」。把普通招降成墨线是拿可读性换分层，方向反了。
  // 所以 light 的颜色与线宽必须**逐位等于改造前**——dev/player-check.js §11 钉死了这条。
  // 端点那个实心「势」点是 heavy 的关键：只靠线宽 1.6 在 0.3s 内是分不出来的。
  //
  // 守势型（danger:false，守阁人）不吃 tier，永远是石青细线：它根本不会打人，
  // 用朱砂加粗或双线去画等于骗玩家躲一记不存在的招。
  var TIER_STYLE = {
    light: { mul: 1.0, twin: false, shi: 0 },
    heavy: { mul: 1.6, twin: false, shi: 1 },
    grab: { mul: 1.0, twin: true, shi: 0 }
  };

  function tgStyle(tg) {
    var st = TIER_STYLE[tg.tier] || TIER_STYLE.light;
    // 颜色只由 danger 与显式 color 决定，**tier 完全不参与**：
    // 于是「落点小点跟 danger 走、不随 tier 变」这条自动成立。
    var col = tg.color || (tg.danger ? SJ.C.cinnabar : SJ.C.stone);
    return {
      color: col,
      mul: tg.danger ? st.mul : 1.0,
      twin: tg.danger && st.twin,
      shi: tg.danger ? st.shi : 0
    };
  }

  function drawTg(g, tg, obs) {
    var pts = Combat.tgPoints(tg);
    if (pts.length < 2) return;
    var p = SJ.clamp(tg.t / tg.dur, 0, 1);
    var sty = tgStyle(tg);
    var col = sty.color, mul = sty.mul;
    var end = pts[pts.length - 1];

    g.save();

    if (obs) {
      // ── 观势：完整、清晰 ──
      // grab 的外圈淡线先画（垫在主线下面），双线本身就是「这一记要贴上来」的形状
      if (sty.twin) {
        SJ.Ink.stroke(g, pts, {
          w0: 8.2, w1: 3.4, color: SJ.C.ink, alpha: (0.22 + 0.12 * p),
          seed: tg.id * 7 + 3, wobble: 1.5, hairs: 0
        });
      }
      SJ.Ink.stroke(g, pts, {
        w0: 3.4 * mul, w1: 1.2 * mul, color: col, alpha: 0.55 + 0.2 * p,
        seed: tg.id * 7, wobble: 0.6, hairs: 1
      });
      // 光珠：走到轨迹尽头 = 这一招落下的时刻。
      // 这里要的是「一颗准确的珠子」，不是墨团——所以用干净的圆，不用 Ink.blob。
      var bead = along(pts, p);
      var rr = 3.2 + 3.4 * SJ.ease.in(p);
      g.fillStyle = col;
      g.strokeStyle = col;
      g.globalAlpha = 0.22 * (0.4 + 0.6 * p);
      g.beginPath(); g.arc(bead.x, bead.y, rr * 2.5, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.95;
      g.beginPath(); g.arc(bead.x, bead.y, rr, 0, Math.PI * 2); g.fill();

      // 落点的收束环：闭合即命中。grab 多套一圈，heavy 加粗。
      g.globalAlpha = 0.42 + 0.34 * p;
      g.lineWidth = (1.4 + 1.2 * p) * mul;
      g.beginPath();
      g.arc(end[0], end[1], 32 * (1 - p) + 8, 0, Math.PI * 2);
      g.stroke();
      if (sty.twin) {
        g.strokeStyle = SJ.C.ink;
        g.globalAlpha = (0.22 + 0.20 * p);
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(end[0], end[1], 32 * (1 - p) + 17, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = col;
      }
      // heavy 的「势」点：一个真的墨团（不是几何圆），越临近落下越实。
      // 这是 heavy 与 light 在 0.3s 内唯一真正拉得开的差别。
      if (sty.shi) {
        SJ.Ink.blob(g, end[0], end[1], 4.5 + 5.0 * p, tg.id * 3 + 1,
          { color: SJ.C.cinnabar, alpha: 0.45 + 0.45 * p });
      }
      if (tg.danger) {
        g.globalAlpha = 0.20 + 0.42 * p;
        g.beginPath(); g.arc(end[0], end[1], 3.4, 0, Math.PI * 2); g.fill();
      }
    } else {
      // ── 不观势：断续、模糊、抖 ──
      // 必须「看得见但读不懂」：完全看不见就钩不起好奇心，观势永远没人发现。
      var CH = 7, i, a, b, k;
      for (i = 0; i < CH; i++) {
        k = SJ.hash(tg.id * 3.7 + i);
        if (k < 0.40) continue;                     // 随机缺段
        a = along(pts, i / CH);
        b = along(pts, (i + 0.62) / CH);
        var jj = (SJ.hash(tg.id + i * 5.1) - 0.5) * 9;
        // 每帧换一次抖动种子：线在原地哆嗦，看得见轮廓但描不出轨迹
        var fz = (SJ.Game.frame >> 2) * 0.37;
        if (sty.twin) {
          SJ.Ink.stroke(g, [[a.x + Math.sin(fz + i) * 2.5, a.y + jj - 5],
                            [b.x - Math.sin(fz + i * 2) * 2.5, b.y - jj - 5]], {
            w0: 2.0, w1: 0.6, color: SJ.C.ink, alpha: (0.20 + 0.12 * k),
            seed: tg.id * 13 + i + 91, wobble: 2.8, hairs: 0
          });
        }
        SJ.Ink.stroke(g, [[a.x + Math.sin(fz + i) * 2.5, a.y + jj],
                          [b.x - Math.sin(fz + i * 2) * 2.5, b.y - jj]], {
          w0: 2.8 * mul, w1: 0.8 * mul, color: col, alpha: 0.30 + 0.16 * k,
          seed: tg.id * 13 + i, wobble: 2.8, hairs: 0
        });
      }
      // 落点在临出手时透出朱砂：给不观势的玩家一个「要挨打了」的钩子，
      // 但只给「哪里」，不给「什么时候、走哪条线」——那是观势才有的信息。
      // heavy 的「势」点在不观势时也画：玩家没进观势也得看得出「这一记挡不住」，
      // 否则「0.3 秒内决定挡还是闪」这个能力在最需要它的时候不存在。
      if (sty.shi) {
        SJ.Ink.blob(g, end[0], end[1], 3.6 + 4.4 * p, tg.id * 3 + 1,
          { color: SJ.C.cinnabar, alpha: 0.30 + 0.42 * p });
      }
      // 落点提示只跟 danger 走、不跟 tier 走：它回答的是「哪里要挨打」，
      // 那是规则；tier 回答的是「什么性质的招」，那是画法。
      if (tg.danger && p > 0.5) {
        var q = (p - 0.5) / 0.5;
        g.fillStyle = col;
        g.globalAlpha = q * 0.5;
        g.beginPath(); g.arc(end[0], end[1], 2.6 + q * 2.4, 0, Math.PI * 2); g.fill();
        g.globalAlpha = q * 0.16;
        g.beginPath(); g.arc(end[0], end[1], 9 + q * 8, 0, Math.PI * 2); g.fill();
      }
    }

    g.restore();
    g.globalAlpha = 1;
  }

  // 沿折线取 t=0..1 处的点
  function along(pts, t) {
    var segs = [], tot = 0, i, d;
    for (i = 0; i < pts.length - 1; i++) {
      d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      segs.push(d); tot += d;
    }
    if (tot <= 0) return { x: pts[0][0], y: pts[0][1] };
    var want = SJ.clamp(t, 0, 1) * tot, acc = 0;
    for (i = 0; i < segs.length; i++) {
      if (acc + segs[i] >= want) {
        var k = segs[i] > 0 ? (want - acc) / segs[i] : 0;
        return {
          x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k,
          y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k
        };
      }
      acc += segs[i];
    }
    var L = pts[pts.length - 1];
    return { x: L[0], y: L[1] };
  }

  function drawDebug(g) {
    var i, hb;
    g.save();
    g.lineWidth = 1;
    for (i = 0; i < hits.length; i++) {
      hb = hits[i];
      g.strokeStyle = hb.team === 'player' ? '#2f7d3a' : '#b03a2b';
      g.globalAlpha = 0.9;
      g.strokeRect(hb.x + 0.5, hb.y + 0.5, hb.w, hb.h);
      g.globalAlpha = 0.12;
      g.fillStyle = g.strokeStyle;
      g.fillRect(hb.x, hb.y, hb.w, hb.h);
    }
    var list = SJ.Ent.list;
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead) continue;
      g.globalAlpha = 0.75;
      g.strokeStyle = '#4a6f7c';
      g.strokeRect(e.x + 0.5, e.y + 0.5, e.w, e.h);
    }
    g.restore();
    g.globalAlpha = 1;
  }

  SJ.Combat = Combat;

})(window.SJ = window.SJ || {});
