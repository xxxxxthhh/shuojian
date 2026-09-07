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

  // 命中反馈分级：hitstop 秒 / 震幅 / 墨点数 / 音效。
  // 停顿档位对齐 DESIGN §7：普攻 45ms、招式 90ms、破防 140ms。
  // 三连的一/二/三段走 light/mid/heavy，靠 45→60→90 拉出「第三下明显更重」，
  // 而不是把第三下拖到 110ms 以上——那会把连段打断成三次独立的挥砍。
  var WEIGHT = {
    light: { stop: 0.045, shake: 3.0, splash: 3, sfx: 'hit', vol: 0.8 },
    mid: { stop: 0.060, shake: 5.0, splash: 5, sfx: 'hit', vol: 1.0 },
    heavy: { stop: 0.090, shake: 8.0, splash: 8, sfx: 'hitHeavy', vol: 1.0 },
    huge: { stop: 0.140, shake: 13.0, splash: 11, sfx: 'hitHeavy', vol: 1.0 }
  };

  function cx(e) { return e.cx ? e.cx() : e.x + e.w / 2; }
  function cy(e) { return e.cy ? e.cy() : e.y + e.h / 2; }

  var Combat = {

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
    //      danger:true}
    // danger:false = 守势型起手式（守阁人）：可被观势读取，但不会打人。
    telegraph: function (o) {
      o = o || {};
      var tg = {
        id: uid++,
        owner: o.owner || null,
        moveId: o.moveId || null,
        dur: o.dur === undefined ? 0.5 : o.dur,
        path: o.path || [],
        danger: o.danger !== false,
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
        parryFx(px, py, dir);
      }
      return;
    }

    // ② 无敌帧（身法 / 受击后）
    if (e.invuln > 0) return;

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

    if (!hb.silent) hitFx(hb, px, py, dir, dmg);
  }

  // 命中三件套：hitstop + 屏幕轻震 + 墨点飞溅。缺一不可。
  function hitFx(hb, px, py, dir, dmg) {
    var w = WEIGHT[hb.weight] || (dmg >= 14 ? WEIGHT.heavy : dmg >= 9 ? WEIGHT.mid : WEIGHT.light);
    var stop = hb.hitstop === undefined ? w.stop : hb.hitstop;

    SJ.Game.slowmo(0, stop);
    SJ.Game.shake(w.shake, 0.16 + stop);
    SJ.FX.splash(px, py, dir, { n: w.splash, color: SJ.C.ink, speed: 200 + w.shake * 20 });
    SJ.FX.slash(px, py, -0.9 * dir, 0.9 * dir, 26 + w.shake * 2.2,
      { color: SJ.C.ink, w: 5 + w.shake * 0.45 });
    SJ.Audio.sfx(w.sfx, { vol: w.vol, pan: SJ.clamp((px - SJ.Camera.x - SJ.W / 2) / (SJ.W / 2), -1, 1) });
  }

  function parryFx(px, py, dir) {
    SJ.Game.slowmo(0, 0.10);
    SJ.Game.slowmo(0.25, 0.22);          // 定格后再半拍慢镜，格挡的「回味」
    SJ.Game.shake(7, 0.22);
    SJ.Game.flash(SJ.C.paper, 0.18, 0.42);
    SJ.FX.ring(px, py, { r: 8, r1: 96, color: SJ.C.cinnabar, life: 0.42, w: 3.4 });
    SJ.FX.burst(px, py, {
      n: 14, color: SJ.C.cinnabar, speed: 340, spread: Math.PI * 2,
      life: 0.5, size: 3, gravity: 900, drag: 2.4
    });
    SJ.FX.slash(px, py, -1.5 * dir, 1.5 * dir, 46, { color: SJ.C.cinnabar, w: 7 });
    SJ.Audio.sfx('parry', { vol: 1 });
  }

  function drawTg(g, tg, obs) {
    var pts = Combat.tgPoints(tg);
    if (pts.length < 2) return;
    var p = SJ.clamp(tg.t / tg.dur, 0, 1);
    // 守势型用石青（不会打人）；攻击型用朱砂。颜色本身就是一句话。
    var col = tg.color || (tg.danger ? SJ.C.cinnabar : SJ.C.stone);
    var end = pts[pts.length - 1];

    g.save();

    if (obs) {
      // ── 观势：完整、清晰 ──
      SJ.Ink.stroke(g, pts, {
        w0: 3.4, w1: 1.2, color: col, alpha: 0.55 + 0.2 * p,
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

      // 落点的收束环：闭合即命中
      g.globalAlpha = 0.42 + 0.34 * p;
      g.lineWidth = 1.4 + 1.2 * p;
      g.beginPath();
      g.arc(end[0], end[1], 32 * (1 - p) + 8, 0, Math.PI * 2);
      g.stroke();
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
        SJ.Ink.stroke(g, [[a.x + Math.sin(fz + i) * 2.5, a.y + jj],
                          [b.x - Math.sin(fz + i * 2) * 2.5, b.y - jj]], {
          w0: 2.8, w1: 0.8, color: col, alpha: 0.30 + 0.16 * k,
          seed: tg.id * 13 + i, wobble: 2.8, hairs: 0
        });
      }
      // 落点在临出手时透出朱砂：给不观势的玩家一个「要挨打了」的钩子，
      // 但只给「哪里」，不给「什么时候、走哪条线」——那是观势才有的信息。
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
