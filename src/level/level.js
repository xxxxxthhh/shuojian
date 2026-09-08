/* src/level/level.js  【G · 关卡运行时】
 *
 * 依据：_spec/CONTRACTS.md 决议 002 §2（mercy 单一写入者）/ 决议 003（时序）/
 *       决议 005 §3（每帧调用顺序，一行不能漏）/ 决议 008 §5（提灯人照明）/
 *       决议 009 §1（环境力只能走 E 的接口）；DESIGN §1 留白、§9.5 墨褪色。
 *
 * ── 三条最容易静默出错的地方，写在最前面 ───────────────────────────
 * 1. 决议 005 §3 的调用顺序是**照抄**的。漏掉任何一行都不会报错，只会让某个系统
 *    静默消失。其中 SJ.Combat.draw(g) 画的是敌人起手式的朱砂轨迹 —— 那是「观势」
 *    唯一的视觉教学手段（DESIGN §0 铁律 3 不许做教程弹窗）。这条线一断，
 *    玩家永远不会发现该按住那个键，整个学招系统变成死代码，而游戏照样跑、不崩、不报错。
 * 2. bossDefeated 只调 SJ.Story.mercyChoice，**绝不自己写 SJ.Save.data.mercy**（决议 002 §2）。
 *    时序：Boss 倒地 → play(down) → mercyChoice → 回调里演出 → complete() → 播 outro → 存档。
 *    outro 在存档**之前**播，所以 mercy 必须在回调那一刻就已经在内存里。
 * 3. 环境力（第四回的风、浮筏的带载）只能走 SJ.Player.envForce / p.inkDrainMul（决议 009 §1）。
 *    直接改 p.vx 会和玩家自己的加速度/摩擦抢同一个字段，表现是「风时有时无」且无法复现。
 *
 * ── SJ.Level.load(idx, checkpoint) 的第二个参数 ────────────────────
 * `checkpoint` 为真 = 从最近的检查点复活（不重播 intro）。
 * 这个语义是 H 的 SJ.Menu.gameover() 定下的：它死后调 SJ.Level.load(chapter, true)。
 * 检查点序号存在 SJ.Save.data.flags.cp（DESIGN §8 的九个字段不加新的顶层字段）。
 */
(function (SJ) {
  'use strict';

  var C = SJ.C;
  var PLAY_W = 26, PLAY_H = 54;          // 玩家包围盒，用于 hazard 相交判定

  // ── 运行时状态 ────────────────────────────────────────────────
  var R = {
    def: null, idx: -1,
    spawnX: 0, spawnY: 0,
    waves: [], active: null, gate: null,
    triggers: [], pickups: [], rafts: [],
    fireT: -1,                            // 火势开始后的秒数；-1 = 还没起火
    burners: [],                          // flag=2 的 solid，等 fireT 到 burnAt 就撤掉
    boss: null, bossDown: false, pendingBoss: false,
    busy: false,                          // 剧情/抉择叠加层在栈上时为真，关卡逻辑暂停推进
    firstInk: false, firstHurt: false, firstBurn: false,
    burnCd: 0, t: 0, fog: 0, ended: false
  };

  function data() { return SJ.Save.data; }
  function flags() { return data().flags || (data().flags = {}); }

  function box(p) { return { x: p.x, y: p.y, w: p.w, h: p.h }; }
  function hitsRect(p, r) {
    return p.x < r.x + r.w && p.x + p.w > r.x && p.y < r.y + r.h && p.y + p.h > r.y;
  }

  // ── 建关 ──────────────────────────────────────────────────────
  function buildPickups(def) {
    var out = [];
    def.deco.forEach(function (d, i) {
      if (!d.ink && !d.refill) return;
      out.push({
        i: i, kind: d.kind, x: d.x, y: d.y,
        ink: d.ink || 0, refill: !!d.refill,
        taken: false, hitT: 0
      });
    });
    return out;
  }

  function buildRafts(def) {
    var out = [];
    def.deco.forEach(function (d) {
      if (d.kind !== 'raft') return;
      var s = SJ.World.addSolid([d.x, d.y, d.w, d.h, 1]);
      out.push({ def: d, solid: s, prevX: d.x, phase: SJ.hash(d.x) * Math.PI * 2 });
    });
    return out;
  }

  function reset(def) {
    SJ.Ent.clear();
    SJ.Combat.clear();
    SJ.FX.clear();
    SJ.Tech.clear();
    SJ.World.load(def);

    R.def = def;
    R.waves = def.waves.map(function (w) { return { def: w, started: false, cleared: false, foes: [] }; });
    R.active = null; R.gate = null;
    R.triggers = def.triggers.map(function (t) { return { def: t, fired: false, armed: true }; });
    R.pickups = buildPickups(def);
    R.rafts = buildRafts(def);
    R.fireT = -1;
    // World.load 按 def.solids 的顺序 push，且丢掉了第 6 位（burnAt）——按下标接回来
    R.burners = [];
    def.solids.forEach(function (q, i) {
      if (q[4] === 2) R.burners.push({ solid: SJ.World.solids[i], at: q[5] });
    });
    R.boss = null; R.bossDown = false; R.pendingBoss = false;
    R.busy = false; R.burnCd = 0; R.t = 0; R.fog = 0; R.ended = false;
    R.firstInk = false; R.firstHurt = false; R.firstBurn = false;
  }

  // ── 剧情：统一入口，保证 busy 标志与回调都不漏 ────────────────
  function play(key, done) {
    if (!key) { if (done) done(); return; }
    R.busy = true;
    SJ.Story.play(key, function () {
      R.busy = false;
      if (done) done();
    });
  }

  function runEvent(ev, done) {
    // 顺序：先播台词，再演「悟」——两个都会 push 叠加层，不能同时发
    play(ev.play, function () {
      if (ev.flag) SJ.Story.flag(ev.flag[0], ev.flag[1]);
      if (ev.fireStart && R.fireT < 0) { R.fireT = 0; SJ.Audio.sfx('fire', { vol: 0.9 }); }
      if (ev.music) SJ.Audio.music(ev.music);
      if (ev.gain) SJ.Tech.gain(ev.gain[0], ev.gain[1]);
      if (done) done();
    });
  }

  // ── 波次 ──────────────────────────────────────────────────────
  function spawnWave(w) {
    var rec = R.waves.filter(function (r) { return r.def === w || r.def.id === w.id; })[0];
    if (!rec || rec.started) return;
    rec.started = true;
    rec.foes = [];
    R.def.spawns.forEach(function (sp) {
      if (sp.wave !== w.id) return;
      // 决议 012 路径三：sp.only 把这个敌人的招表钉死成一个子集（ai.js:166）。
      // 第一回第一个刀客只出破雨 —— 玩家反复看到同一条朱砂虚线，
      // 观势才有被发现的可能。不传就是原来的整套招表。
      var e = SJ.Enemies.spawn(sp.type, sp.x, sp.y - 1,
                               { facing: -1, only: sp.only || null });
      if (e) rec.foes.push(e);
    });
    R.active = rec;
    R.gate = w.gate || null;
    SJ.Audio.intensity(0.75);
  }


  /* ── 防止敌人掉出世界（Lead 补）───────────────────────────────────
   * 实测：Boss 被击退到地图边缘外会一直下落（y 到过 88 万），hp 不减、
   * 波次永远清不掉 → 门两侧都锁死 → 玩家前后都走不了，画面上还什么都没有。
   * 这是会毁掉一次通关的软锁，且不报任何错。
   * 处理：把所有敌人水平夹回地图内；掉到世界底下的，捞回最近的地面。 */
  /* 这个敌人属于哪一波（找不到就是 null，例如游荡兵与 Boss）*/
  function waveOf(e) {
    for (var i = 0; i < R.waves.length; i++) {
      if (R.waves[i].foes.indexOf(e) >= 0) return R.waves[i];
    }
    return null;
  }

  /* 把 e 放回 y=fy 这一层、且落在 [lo,hi] 里离他最近的一块地面上。
   * 直接写 e.y = fy - e.h 会把人塞进墙里，所以要先找到那一层真的有地面的一段。*/
  function putBackOn(e, fy, lo, hi) {
    var sl = SJ.World.solids, best = null, bd = 1e9, i, s, a, b, x;
    for (i = 0; i < sl.length; i++) {
      s = sl[i];
      if (s.gone || Math.abs(s.y - fy) > 3) continue;
      a = Math.max(s.x, lo);
      b = Math.min(s.x + s.w, hi) - e.w;
      if (b < a) continue;
      x = SJ.clamp(e.x, a, b);
      if (Math.abs(x - e.x) < bd) { bd = Math.abs(x - e.x); best = x; }
    }
    if (best === null) return false;
    e.x = best; e.y = fy - e.h; e.vy = 0; e.onGround = true;
    return true;
  }

  function rescueFoes() {
    var def = R.def;
    if (!def) return;
    var foes = SJ.Ent.by('foe'), maxY = (def.h || SJ.H) + 260;
    var pf = SJ.player ? SJ.player.y + SJ.player.h : null;
    for (var i = 0; i < foes.length; i++) {
      var e = foes[i];
      if (!e || e.dead) continue;
      if (e.x < 8) { e.x = 8; if (e.vx < 0) e.vx = 0; }
      if (e.x + e.w > def.w - 8) { e.x = def.w - 8 - e.w; if (e.vx > 0) e.vx = 0; }

      var rec = waveOf(e);
      // 这个人应该站在哪一层：Boss 看 bossY，波次敌人看本波楼层，其余看玩家脚下
      var homeY = null;
      if (R.boss === e && def.bossY !== undefined) homeY = def.bossY;
      else if (rec) homeY = waveFloorY(rec.def);
      if (homeY === null) homeY = pf;

      if (e.y > maxY) {
        // ★ 从 homeY 往下找落脚面。原来写的是 groundAt(e.cx(), 0)：yFrom=0 等于
        //   「从天上往下找第一块地」——多层关卡里那是**屋顶**。Boss 掉出世界后被捞到
        //   屋顶上，玩家在 bossArena 里永远打不到他，一样是死局，且什么都不报。
        var gy = SJ.World.groundAt(e.cx(), homeY === null ? 0 : homeY - 40);
        if (gy === null) gy = SJ.World.groundAt(e.cx(), 0);
        if (gy === null && SJ.player) gy = SJ.World.groundAt(SJ.player.cx(), homeY === null ? 0 : homeY - 40);
        if (gy !== null) { e.y = gy - e.h; e.vy = 0; e.onGround = true; }
        else if (SJ.player) { e.x = SJ.player.x; e.y = SJ.player.y; e.vy = 0; }
      }

      /* ── 战场泄漏（T1 实测补）─────────────────────────────────
       * 活跃波次的敌人一旦走出 gate、或掉到别的楼层，玩家就永远够不到他，
       * 门永远不开，前后都走不了 —— 和 Boss 掉出世界是同一类死局。
       * 实测：第二回第 5 波的力士从三层左沿（x=1400，正好是 gate 的左边界）
       * 走下二层，玩家被锁在三层，四百秒过去还在等一个够不到的人。
       * 敌人不受 clampPlayer 约束，所以只能在这里兜。 */
      if (rec && R.active === rec && R.gate) {
        var lo = R.gate[0], hi = R.gate[1];
        if (e.x < lo) { e.x = lo; if (e.vx < 0) e.vx = 0; }
        if (e.x + e.w > hi) { e.x = hi - e.w; if (e.vx > 0) e.vx = 0; }
        var fy = waveFloorY(rec.def);
        // ★ 只捞**掉下去**的，不动站高处的。
        //   第四、六回故意把弓手放在比战场高一层的挑台上（「弓手在挑台上：第一次退无可退」），
        //   用双向判定会把他每帧拽下来 —— 那是改玩法，不是修 bug。
        //   而软锁只来自「掉到玩家够不到的下层」这一个方向（第二回第 5 波的力士）。
        if (fy !== null && (e.y + e.h) - fy > FLOOR_TOL && e.onGround) {
          putBackOn(e, fy, lo, hi);
        }
      }
      // Boss 同理：别被打出场地，也别掉到场地之外的楼层
      if (R.boss === e && def.bossArena) {
        if (e.x < def.bossArena[0]) { e.x = def.bossArena[0]; if (e.vx < 0) e.vx = 0; }
        if (e.x + e.w > def.bossArena[1]) { e.x = def.bossArena[1] - e.w; if (e.vx > 0) e.vx = 0; }
        if (def.bossY !== undefined && (e.y + e.h) - def.bossY > FLOOR_TOL && e.onGround) {
          putBackOn(e, def.bossY, def.bossArena[0], def.bossArena[1]);
        }
      }
    }
  }


  /* ── 波次的「同层」判定（Lead 补）──────────────────────────────
   * 实测软锁：第二回是三层客栈，而波次触发原本只判 x。玩家在地面走到 x=1500
   * 会触发「三层那一波」——敌人刷在两层之上，gate 却锁在玩家身边，
   * 玩家永远够不到他们，门永远不开，前后都走不了，且不报任何错。
   * 修法：波次的敌人在哪一层，就要求玩家也在那一层才触发。
   * 单层关卡的 spawn y 与玩家脚底本来就同高，此判定自动恒真，不影响其它七关。 */
  function waveFloorY(w) {
    var sp = R.def.spawns, y = null, i;
    for (i = 0; i < sp.length; i++) {
      if (sp[i].wave !== w.id) continue;
      if (y === null || sp[i].y > y) y = sp[i].y;      // 取最低的那个作为该波的地面
    }
    return y;
  }
  // ★ 这个 130 在 dev/level-check.js（规则 17/18/20）里有一份同值副本，改一处要改两处
  var FLOOR_TOL = 130;                                  // 一层楼的高度量级，宽松到不误伤斜坡
  function onSameFloor(p, w) {
    var fy = waveFloorY(w);
    if (fy === null) return true;                       // 没有 spawn 的波次（纯事件）不受限
    return Math.abs((p.y + p.h) - fy) <= FLOOR_TOL;
  }

  function nextWaveAt(p, skip) {
    for (var i = 0; i < R.waves.length; i++) {
      var r = R.waves[i], w = r.def;
      if (r.started || r === skip) continue;
      if (p.x + p.w > w.x && p.x < w.x + w.w && onSameFloor(p, w)) return w;
    }
    return null;
  }

  function updateWaves() {
    var p = SJ.player, w;
    if (R.active) {
      var alive = R.active.foes.filter(function (e) { return !e.dead && e.hp > 0; });
      if (!alive.length) {
        R.active.cleared = true;
        R.active = null; R.gate = null;
        SJ.Audio.intensity(0.15);
        return;
      }
      /* ★ 决议 023：**无门**的波次不阻塞后面的波。
       * 原来是「一次只跑一波」无条件 return —— 而没有 gate 的波次玩家本来就跑得掉：
       * 只要留一个活口不打死，后面所有波次就永远不刷。实测第五回把第 2 波的僧人
       * 打到 1 血就走人，第 3 波（Boss 前那三个）整场再没出现过，不报错、玩家也不会察觉。
       * 现在：玩家走到后一波的触发区就视这一波结束，敌人留在原地当散兵。
       * 有 gate 的波语义不变（清完才能走，这是设计要的压力）。 */
      if (!R.active.def.gate) {
        w = nextWaveAt(p, R.active);
        if (w) {
          R.active.cleared = true;              // 视为结束：afterWave 之类的条件照常成立
          R.active = null; R.gate = null;
          spawnWave(w);
        }
      }
      return;
    }
    w = nextWaveAt(p, null);
    if (w) spawnWave(w);
  }

  function waveById(id) {
    for (var i = 0; i < R.waves.length; i++) if (R.waves[i].def.id === id) return R.waves[i];
    return null;
  }

  // when 的四种非位置条件 + 两种波次条件（决议 004 §1 靠这个成立）
  function whenOk(t) {
    var w = t.def.when;
    if (!w) return true;
    var m = /^wave:(\d+)$/.exec(w);
    if (m) { var r = waveById(+m[1]); return !!(r && r.started && !r.cleared); }
    m = /^afterWave:(\d+)$/.exec(w);
    if (m) { var r2 = waveById(+m[1]); return !!(r2 && r2.cleared); }
    if (w === 'firstInk') return R.firstInk;
    if (w === 'firstHurt') return R.firstHurt;
    if (w === 'burn') return R.firstBurn;
    return true;
  }

  function updateTriggers() {
    var p = SJ.player;
    for (var i = 0; i < R.triggers.length; i++) {
      var t = R.triggers[i], d = t.def;
      if (t.fired) continue;
      if (!whenOk(t)) continue;
      if (d.x !== undefined) {
        if (!hitsRect(p, d)) continue;
        if (d.interact && !SJ.Input.pressed('interact')) continue;
      }
      t.fired = true;
      // 搬开挡路物的那一下：木头擦过地面 + 一点尘。不写字（决议 011 / DESIGN §0 铁律 3）
      if (d.event.flag && (R.def.blockers || []).some(function (b) { return b.flag === d.event.flag[0]; })) {
        SJ.Audio.sfx('door', { vol: 0.8, rate: 0.85 });
        SJ.FX.dust(d.x + d.w / 2, d.y + d.h, 0);
      }
      (function (ev) {
        runEvent(ev, function () {
          // Boss 的开场白播完才把人放出来（决议 003 的时序从这里起算）
          if (R.def.bossScript && ev.play === R.def.bossScript.pre) spawnBoss();
        });
      })(d.event);
      return;                                   // 一帧只放一个，避免两段台词叠在一起
    }
  }

  // ── 拾取物：可击碎回墨物件与石砚（DESIGN §9.3.3/§9.3.4）────────
  function updatePickups(dt) {
    var p = SJ.player;
    for (var i = 0; i < R.pickups.length; i++) {
      var k = R.pickups[i];
      if (k.taken) { k.hitT += dt; continue; }
      var r = { x: k.x - 17, y: k.y - 34, w: 34, h: 34 };
      if (k.refill) {
        if (!hitsRect(p, r)) continue;
        k.taken = true; k.hitT = 0;
        p.addInk(p.maxInk);
        SJ.Audio.sfx('bell', { vol: 0.8 });
        SJ.FX.burst(k.x, k.y - 16, { n: 14, color: C.stone, speed: 120,
          spread: Math.PI * 2, life: 0.7, size: 2.4, gravity: 260, drag: 2 });
      } else {
        // 可击碎：玩家的攻击判定碰到就碎（不需要精确到帧，只要手感是「一刀一个」）
        if (!p.atkHb || !hitsRect(p.atkHb, r)) continue;
        k.taken = true; k.hitT = 0;
        p.addInk(k.ink);
        SJ.Audio.sfx('hit', { vol: 0.5, rate: 1.25 });
        SJ.FX.splash(k.x, k.y - 16, p.facing > 0 ? -0.6 : -(Math.PI - 0.6), { n: 10, groundY: k.y });
        SJ.FX.word(k.x, k.y - 40, '墨', { color: C.ink, screen: false });
      }
    }
  }

  // ── hazard ────────────────────────────────────────────────────
  function updateHazards(dt) {
    var p = SJ.player, def = R.def;
    if (R.burnCd > 0) R.burnCd -= dt;

    for (var i = 0; i < def.hazards.length; i++) {
      var h = def.hazards[i];
      if (h.kind === 'fire' && (R.fireT < 0 || R.fireT < (h.startAt || 0))) continue;
      if (!hitsRect(p, h)) continue;

      if (h.kind === 'water') {
        // 落水：扣一颗心，回最近的检查点。永远不会摔出图（关卡数据保证 hazard 铺满）
        p.hp = Math.max(1, p.hp - 20);
        SJ.Audio.sfx('water', { vol: 0.9 });
        SJ.Game.flash(C.stone, 0.25, 0.35);
        p.respawn(R.spawnX - PLAY_W / 2, R.spawnY - PLAY_H);
        p.hp = Math.max(1, p.hp);
        return;
      }
      if (h.kind === 'fire') {
        if (R.burnCd <= 0) {
          R.burnCd = 0.55;
          SJ.Combat.burn(p, 1.4, null);
          R.firstBurn = true;                   // 喂给 when:'burn'（焚书，DESIGN §9.2）
        }
      }
      if (h.kind === 'updraft') {
        // 决议 009 §1：只能给加速度，不能直接写 vy。
        // 一直往上推到 h.vy 这个速度为止，到了就不再加——所以是「被托住」不是「被弹飞」
        if (p.vy > h.vy) SJ.Player.envForce(0, -(SJ.GRAVITY + 1600));
        if (SJ.Game.frame % 4 === 0) {
          SJ.FX.leaf(h.x + SJ.rand(h.w), h.y + h.h - SJ.rand(60), 1, 'snow');
        }
      }
    }
  }

  // ── 火势：烧穿 flag=2 的木板 ──────────────────────────────────
  function updateFire(dt) {
    if (R.fireT < 0) return;
    R.fireT += dt;
    for (var i = 0; i < R.burners.length; i++) {
      var b = R.burners[i];
      if (!b.solid || b.solid.gone) continue;
      if (R.fireT < b.at) continue;
      b.solid.gone = true;
      SJ.Audio.sfx('fire', { vol: 0.7, rate: 0.9 });
      for (var k = 0; k < 6; k++) {
        SJ.FX.leaf(b.solid.x + SJ.rand(b.solid.w), b.solid.y, 1, 'paper');
      }
    }
  }

  // ── 浮筏：World.moveX 不管载具，站上去的位移要自己给（notes-G 记过的坑）──
  function updateRafts(dt) {
    var p = SJ.player;
    for (var i = 0; i < R.rafts.length; i++) {
      var r = R.rafts[i], d = r.def, s = r.solid;
      var u = (Math.sin(R.t * Math.PI * 2 / d.period + r.phase) + 1) / 2;
      var nx = d.ax + (d.bx - d.ax) * u;
      var dx = nx - s.x;
      s.x = nx;
      // 站在筏上（脚底贴着筏顶，且水平重叠）→ 把筏的位移带给玩家
      var onIt = p.onGround &&
                 Math.abs((p.y + p.h) - s.y) <= 6 &&
                 p.x + p.w > s.x - dx && p.x < s.x - dx + s.w;
      if (onIt && dx) SJ.World.moveX(p, dx);
      r.prevX = nx;
    }
  }

  // ── 环境力（决议 009 §1）────────────────────────────────────
  function updateEnv() {
    var e = R.def.env;
    var p = SJ.player;
    p.inkDrainMul = (e && e.inkDrainMul) || 1;
    if (e && e.windAx) SJ.Player.envForce(e.windAx, 0);
  }

  // ── 关住玩家：波次 gate 与 blocker（软墙，不是实体）──────────
  function clampPlayer() {
    var p = SJ.player, def = R.def;
    var lo = 0, hi = def.w - p.w;
    if (R.gate) { lo = Math.max(lo, R.gate[0]); hi = Math.min(hi, R.gate[1] - p.w); }
    (def.blockers || []).forEach(function (b) {
      if (!SJ.Story.get(b.flag)) hi = Math.min(hi, b.x - p.w);
    });
    if (R.boss && !R.bossDown) {
      lo = Math.max(lo, def.bossArena[0]);
      hi = Math.min(hi, def.bossArena[1] - p.w);
    }
    if (p.x < lo) { p.x = lo; if (p.vx < 0) p.vx = 0; }
    if (p.x > hi) { p.x = hi; if (p.vx > 0) p.vx = 0; }
  }

  /* ── 检查点（T1 实测补：也要判同层）─────────────────────────────
   * 原来只比 x。第二回的检查点是按**推进顺序**写的，不是按 x 排的：
   *   [[100,760],[2100,820],[1500,600],[1450,380]]  ← 三层客栈，先右后上再往回
   * 于是玩家在**一层**走过 x=1450（第 1 波的 gate 右界是 1500，必然会走到），
   * 就把检查点设成了**三层**的 [1450,380]，而且 cp 只增不减，再也回不去。
   * 之后在一层任何地方死一次，都会复活到三层 —— 第二、三、四波连同它们的
   * 剧情与教学整段被跳过，玩家还以为自己打过了。不报错，也没人会发现。
   * 修法与波次的 onSameFloor 同源：脚底得真的在那一层上。 */
  function updateCheckpoints() {
    var p = SJ.player, cps = R.def.checkpoints;
    for (var i = cps.length - 1; i >= 0; i--) {
      if (p.x + p.w / 2 < cps[i][0]) continue;
      if (Math.abs((p.y + p.h) - cps[i][1]) > FLOOR_TOL) continue;
      if ((flags().cp | 0) >= i) return;
      SJ.Level.checkpoint(cps[i][0], cps[i][1]);
      flags().cp = i;
      SJ.Save.save();
      // 反馈要有，但不写字（DESIGN §0 铁律 3）：一圈淡墨晕开就够
      SJ.FX.ring(cps[i][0], cps[i][1] - 26,
        { r: 8, r1: 54, color: C.ink, life: 0.7, w: 1.6 });
      SJ.Audio.sfx('woodclap', { vol: 0.35, rate: 0.8 });
      return;
    }
  }

  // ── Boss（决议 002 §2 / 决议 003 的时序全在这一段）──────────────
  function spawnBoss() {
    var def = R.def;
    if (!def.boss || R.boss) return;
    var bx = (def.bossArena[0] + def.bossArena[1]) / 2 + 90;
    R.boss = SJ.Bosses.spawn(def.boss, bx, def.bossY - 1, { facing: -1 });
    if (!R.boss) return;
    R.boss.onDefeat = function () { SJ.Level.bossDefeated(def.boss); };
    SJ.Audio.music(def.bossMusic || 'boss');
    SJ.Audio.intensity(0.9);
  }

  // ── 场景 ──────────────────────────────────────────────────────
  var scene = {
    countsPlaytime: true,               // 决议 006：Game 据此累加 playtimeSec

    enter: function () {},
    exit: function () {},

    // ══ 决议 005 §3：这六步的顺序是照抄的，不要重排 ══════════════
    update: function (dt) {
      var p = SJ.player;

      if (R.busy) return;               // 剧情/生杀抉择在栈顶时，关卡逻辑整体暂停
      if (SJ.Input.pressed('pause')) { SJ.Menu.pause(); return; }

      R.t += dt;

      SJ.Ent.updateAll(dt);             // 1 玩家与敌人；产生 hitbox 与 telegraph
      SJ.Tech.update(dt);               // 2 招式执行；也产生 hitbox —— 必须在 Combat 之前
      SJ.Combat.update(dt);             // 3 统一结算所有 hitbox 与观势格挡
      SJ.FX.update(dt);                 // 4
      SJ.Camera.follow(p, dt);          // 5

      // 6 关卡自身
      if (p.state === 'dead') {
        if (!R.ended) {
          R.ended = true;
          data().deaths = (data().deaths | 0) + 1;
          SJ.Save.save();
          SJ.Menu.gameover();
        }
        return;
      }

      // 「第一次积到残墨」「第一次挨打也涨进度」——喂给 learn_ink / learn_hurt
      if (!R.firstInk) {
        for (var k in SJ.Tech.progress) {
          if (SJ.Tech.progress[k] > 0) { R.firstInk = true; break; }
        }
      }
      if (!R.firstHurt && p.hp < p.maxHp) R.firstHurt = true;

      updateEnv();
      updateRafts(dt);
      updateFire(dt);
      updateHazards(dt);
      rescueFoes();
      updateWaves();
      updatePickups(dt);
      updateTriggers();
      updateCheckpoints();
      clampPlayer();

      // 走到出口：无 Boss 的关卡（楔子/终回）由这里通关；
      // 有 Boss 的关卡由 bossDefeated 通关，exitX 只是个出口标记
      if (!R.def.boss && !R.ended && p.x + p.w / 2 >= R.def.exitX) {
        R.ended = true;
        SJ.Level.complete();
      }
    },

    draw: function (g) { drawLevel(g); }
  };

  // ── 背景（DESIGN §1：任何一屏纸色空白必须占 50% 以上）──────────
  // ★ 决议 015：远景交给 T4 的 SJ.Scenery。它不存在或抛错时必须退回下面那套 switch ——
  //   呈现层挂了游戏还得能玩，所以这里吞异常，只在控制台警告一次。
  var sceneryDead = false;
  function drawBackground(g) {
    var def = R.def, cx = SJ.Camera.x, cy = SJ.Camera.y, t = SJ.Game.time;
    SJ.Ink.paper(g, cx, cy);

    if (!sceneryDead && SJ.Scenery && typeof SJ.Scenery.draw === 'function') {
      try {
        SJ.Scenery.draw(def.bg, g, cx, cy, t, def);
        drawWeather(g, def, cx, t);
        return;
      } catch (err) {
        sceneryDead = true;                 // 只报一次，别每帧刷屏
        console.warn('[G] SJ.Scenery.draw 抛错，本局改用旧远景：' + (err && err.message));
      }
    }

    switch (def.bg) {
      case 'bamboo':
        SJ.Ink.mountains(g, cx, 2, { alpha: 0.10 });
        SJ.Ink.bamboo(g, cx, 1, { alpha: 0.22 });
        break;
      case 'inn':
        SJ.Ink.mountains(g, cx, 2, { alpha: 0.09 });
        break;
      case 'river':
        SJ.Ink.mountains(g, cx, 2, { alpha: 0.10 });
        SJ.Ink.mountains(g, cx, 1, { alpha: 0.14 });
        break;
      case 'snow':
        SJ.Ink.mountains(g, cx, 2, { alpha: 0.08 });
        SJ.Ink.mountains(g, cx, 1, { alpha: 0.12 });
        break;
      case 'wall':
        SJ.Ink.mountains(g, cx, 2, { alpha: 0.09 });
        SJ.Ink.blob(g, SJ.W - 150, 86, 30, 4.2, { color: C.gamboge, alpha: 0.30, rough: 0.05 });
        break;
      case 'library':
        SJ.Ink.wash(g, 0, SJ.H * 0.55, SJ.W, SJ.H * 0.45, { color: C.ink, alpha: 0.05 });
        break;
      case 'tea':
        SJ.Ink.wash(g, 0, SJ.H * 0.6, SJ.W, SJ.H * 0.4, { color: C.ink, alpha: 0.05 });
        break;
    }
    drawWeather(g, def, cx, t);
  }

  // 天气粒子不属于远景（决议 015 只接管 def.bg 那一层），两条路径共用这一份
  function drawWeather(g, def, cx, t) {
    if (def.weather === 'rain') SJ.Ink.rain(g, cx, t, 0.7, -0.35);
    if (def.weather === 'snow') SJ.Ink.snow(g, cx, t, 0.6, -0.5);
    if (def.weather === 'wind') SJ.Ink.snow(g, cx, t, 0.10, -1.1);
  }

  // ── 地形：绝不填死 ────────────────────────────────────────────
  // 大块实心（第四回整座山、客栈的楼板）如果 fillRect 成黑块，一屏就没有纸色了。
  // 所以只画「顶面那一笔 + 往下很快淡掉的渲染」，山体内部留白，靠几处飞白点出体积。
  function drawSolids(g) {
    var cx = SJ.Camera.x, cy = SJ.Camera.y, sl = SJ.World.solids;
    for (var i = 0; i < sl.length; i++) {
      var s = sl[i];
      if (s.gone) continue;
      if (s.x + s.w < cx - 40 || s.x > cx + SJ.W + 40) continue;
      if (s.y > cy + SJ.H + 40 || s.y + s.h < cy - 40) continue;

      if (s.oneway) {
        SJ.Ink.line(g, s.x, s.y + 2, s.x + s.w, s.y + 2, 3.2,
          { color: C.ink2, alpha: 0.70, taper: true, seed: i });
        continue;
      }
      if (s.vanish) {                        // 会烧掉的板：焦边，看得出它是暂时的
        SJ.Ink.line(g, s.x, s.y + 2, s.x + s.w, s.y + 2, 3.0,
          { color: C.cinnabar, alpha: 0.55, taper: true, seed: i });
        continue;
      }

      // 顶面：一道有粗细变化的毛笔线
      SJ.Ink.line(g, s.x, s.y + 1.5, s.x + s.w, s.y + 1.5, 4.2,
        { color: C.ink, alpha: 0.85, taper: true, seed: i * 7 + 1 });
      // 体积：只在顶面下方 90px 内渲染，再往下留白
      var hh = Math.min(s.h, 90);
      SJ.Ink.wash(g, s.x, s.y, s.w, hh,
        // Ink.wash 只认 dir==='v'（ink.js:401），'down' 会被当成横向 —— 体积渲染
        // 一直是从左到右淡出，不是设计要的往下淡出。T4 发现。
        { color: C.ink, alpha: 0.16, dir: 'v' });
      // 几点飞白，点出这是石/木不是空气
      var n = Math.min(5, Math.max(1, (s.w / 220) | 0));
      for (var k = 0; k < n; k++) {
        var hx = s.x + s.w * ((k + 0.5) / n) + (SJ.hash(i * 13 + k) - 0.5) * 40;
        SJ.Ink.blob(g, hx, s.y + 16 + SJ.hash(i * 17 + k) * 26,
          8 + SJ.hash(i * 19 + k) * 12, i * 31 + k,
          { color: C.ink, alpha: 0.12, rough: 0.34 });
      }
    }
  }

  function drawDeco(g) {
    var def = R.def, t = SJ.Game.time, cx = SJ.Camera.x;
    for (var i = 0; i < def.deco.length; i++) {
      var d = def.deco[i];
      if (d.x < cx - 80 || d.x > cx + SJ.W + 80) continue;
      switch (d.kind) {
        case 'pine': SJ.Ink.pine(g, d.x, d.y, 1, i * 3 + 1); break;
        case 'raft': break;                                   // 由 solids 画（它是真的地面）
        case 'stele':
          SJ.Ink.wash(g, d.x - 13, d.y - 62, 26, 62, { color: C.ink, alpha: 0.30 });
          SJ.Ink.line(g, d.x - 13, d.y - 62, d.x + 13, d.y - 62, 2.4, { color: C.ink, alpha: 0.7 });
          break;
        case 'shelf':
          if (d.fallen) {
            // ★ 决议 011：倒下的一架，横躺在路上。玩家的动作是「搬」，不是「读」——
            //   所以它画成一个**障碍**（横着、挡住去路），搬开之后就不在了。
            //   这里不画任何提示字：没有「阅读」「查看」，也没有按键提示（DESIGN §0 铁律 3）。
            if (SJ.Story.get('c5_page')) break;
            SJ.Ink.wash(g, d.x - 54, d.y - 40, 108, 40, { color: C.ink, alpha: 0.24 });
            for (var q = 0; q < 3; q++) {
              SJ.Ink.line(g, d.x - 54, d.y - 34 + q * 13, d.x + 54, d.y - 34 + q * 13, 2.0,
                { color: C.ink, alpha: 0.5, taper: true, seed: q * 5 + 1 });
            }
            // 散出来的册页，压在架子下面
            for (var q2 = 0; q2 < 4; q2++) {
              SJ.Ink.blob(g, d.x - 40 + q2 * 26, d.y - 6, 7, q2 * 9 + 2,
                { color: C.ink, alpha: 0.30, rough: 0.35, squash: 0.4 });
            }
            break;
          }
          SJ.Ink.wash(g, d.x - 30, d.y - 96, 60, 96, { color: C.ink, alpha: 0.20 });
          for (var r = 1; r < 4; r++) {
            SJ.Ink.line(g, d.x - 30, d.y - 96 + r * 24, d.x + 30, d.y - 96 + r * 24, 1.8,
              { color: C.ink, alpha: 0.45 });
          }
          break;
        case 'table':
          SJ.Ink.line(g, d.x - 26, d.y - 26, d.x + 26, d.y - 26, 3.2, { color: C.ink, alpha: 0.7 });
          SJ.Ink.line(g, d.x - 18, d.y - 26, d.x - 18, d.y, 2.2, { color: C.ink, alpha: 0.5 });
          SJ.Ink.line(g, d.x + 18, d.y - 26, d.x + 18, d.y, 2.2, { color: C.ink, alpha: 0.5 });
          break;
        case 'seat':
          SJ.Ink.line(g, d.x - 12, d.y - 16, d.x + 12, d.y - 16, 2.6, { color: C.ink, alpha: 0.55 });
          break;
        case 'flag':
          SJ.Ink.line(g, d.x, d.y, d.x, d.y - 110, 2.6, { color: C.ink, alpha: 0.7 });
          SJ.Ink.wash(g, d.x, d.y - 108, 46 + Math.sin(t * 1.6) * 8, 34,
            { color: C.ink, alpha: 0.28 });
          break;
      }
      if (!d.ink && !d.refill && d.kind === 'lantern') SJ.Ink.lantern(g, d.x, d.y - 40, 26, t);
    }
  }

  function drawPickups(g) {
    var t = SJ.Game.time, cx = SJ.Camera.x;
    for (var i = 0; i < R.pickups.length; i++) {
      var k = R.pickups[i];
      if (k.x < cx - 60 || k.x > cx + SJ.W + 60) continue;
      if (k.taken) continue;
      if (k.refill) {
        // 石砚：一方石头，一汪墨，静止的东西才像能蘸笔
        SJ.Ink.wash(g, k.x - 18, k.y - 16, 36, 16, { color: C.ink, alpha: 0.45 });
        SJ.Ink.blob(g, k.x, k.y - 14, 9, i * 5 + 2,
          { color: C.stone, alpha: 0.55 + 0.1 * Math.sin(t * 2 + i), rough: 0.14 });
      } else if (k.kind === 'lantern') {
        SJ.Ink.lantern(g, k.x, k.y - 40, 26, t);
      } else {
        var col = (k.kind === 'snowpile') ? C.stone : C.ink;
        SJ.Ink.blob(g, k.x, k.y - 14, 13, i * 11 + 3, { color: col, alpha: 0.55, rough: 0.3 });
      }
    }
  }

  function drawHazards(g) {
    var def = R.def, t = SJ.Game.time;
    for (var i = 0; i < def.hazards.length; i++) {
      var h = def.hazards[i];
      if (h.kind === 'water') {
        SJ.Ink.water(g, h.x, h.y, h.w, h.h, t, { color: C.stone, alpha: 0.5 });
      } else if (h.kind === 'fire') {
        if (R.fireT < 0 || R.fireT < (h.startAt || 0)) continue;
        for (var k = 0; k < 4; k++) {
          var fx = h.x + h.w * (k + 0.5) / 4;
          SJ.Ink.blob(g, fx, h.y + h.h - 6 - Math.abs(Math.sin(t * 3 + k)) * 16,
            9 + Math.sin(t * 5 + k * 2) * 3, i * 7 + k,
            { color: C.cinnabar, alpha: 0.5, rough: 0.4 });
        }
      } else if (h.kind === 'updraft') {
        for (var m = 0; m < 3; m++) {
          var ux = h.x + h.w * (m + 0.5) / 3;
          var uy = h.y + h.h - ((t * 260 + m * 190) % h.h);
          SJ.Ink.line(g, ux, uy, ux, uy - 40, 1.6, { color: C.stone, alpha: 0.22 });
        }
      }
    }
  }

  // ── 雾（决议 008 §5）：提灯人是雪山唯一的光源 ────────────────
  // 光位由 F 的敌人在自己的 draw 里写进 e.light.x/y，所以这一层必须在 Ent.drawAll 之后画。
  // 又必须在墨褪色之前 —— 雾是世界的一部分，褪色作用于整个世界。
  var fogCv = null, fogCtx = null;
  function drawFog(g) {
    if (R.fog <= 0) return;
    if (!fogCv) {
      fogCv = document.createElement('canvas');
      fogCv.width = SJ.W; fogCv.height = SJ.H;
      fogCtx = fogCv.getContext('2d');
    }
    var f = fogCtx;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, SJ.W, SJ.H);
    f.globalCompositeOperation = 'source-over';
    f.fillStyle = C.paper;
    f.globalAlpha = 0.80 * R.fog;
    f.fillRect(0, 0, SJ.W, SJ.H);

    // 挖洞：玩家自己一小圈 + 每个还提着灯的人一大圈
    f.globalCompositeOperation = 'destination-out';
    f.globalAlpha = 1;
    // 与 Camera.apply 完全一致：它做的是 translate(-round(x + shakeOffset))
    var camx = Math.round(SJ.Camera.x + SJ.Camera.shakeOffset.x);
    var camy = Math.round(SJ.Camera.y + SJ.Camera.shakeOffset.y);
    function hole(wx, wy, r, soft) {
      var sx = wx - camx, sy = wy - camy;
      if (sx < -r || sx > SJ.W + r || sy < -r || sy > SJ.H + r) return;
      var gr = f.createRadialGradient(sx, sy, 0, sx, sy, r);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(soft, 'rgba(0,0,0,0.92)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = gr;
      f.beginPath(); f.arc(sx, sy, r, 0, 7); f.fill();
    }
    var p = SJ.player;
    if (p) hole(p.cx(), p.cy(), 150, 0.35);
    var foes = SJ.Ent.by('foe');
    for (var i = 0; i < foes.length; i++) {
      var e = foes[i];
      if (!e.light) continue;
      var fade = (e.mem && e.mem.fade !== undefined) ? SJ.clamp(1 - e.mem.fade, 0, 1) : 1;
      if (e.hp <= 0 && fade <= 0) continue;
      hole(e.light.x || e.cx(), e.light.y || e.cy(),
           e.light.r * (0.35 + 0.65 * fade), 0.45);
    }
    f.globalCompositeOperation = 'source-over';
    g.drawImage(fogCv, 0, 0);
  }

  // ══ 决议 005 §3：这九步的顺序也是照抄的 ══════════════════════
  function drawLevel(g) {
    if (!R.def) return;
    drawBackground(g);                  // 1 背景（camera 之外）

    SJ.Camera.apply(g);                 // 2
    drawHazards(g);                     // 3 地形 / deco / pickups
    drawSolids(g);
    drawDeco(g);
    drawPickups(g);
    SJ.Ent.drawAll(g);                  // 4
    SJ.Combat.draw(g);                  // 5 ★ 起手式轨迹 —— 观势唯一的视觉教学手段，绝不能漏
    SJ.FX.draw(g);                      // 6 世界坐标粒子
    SJ.Camera.restore(g);               // 7

    drawFog(g);                         // 7.5 雾（世界的一部分，要在褪色之前）

    // 8 墨褪色覆盖层（DESIGN §9.5 / 决议 003）
    var tint = SJ.Player.inkTint();
    if (tint < 1) {
      g.save();
      g.globalAlpha = (1 - tint) * 0.72;
      g.fillStyle = C.paper;
      g.fillRect(0, 0, SJ.W, SJ.H);
      g.restore();
    }

    SJ.HUD.draw(g, SJ.player);          // 9 在褪色之后 —— HUD 不受褪色影响
  }

  // ── 出口 ──────────────────────────────────────────────────────
  SJ.Level = {
    current: -1,
    def: null,
    pickups: R.pickups,

    /* 决议 007 §2：H 的 gameover 确认后只调这一个函数。
     * 语义 = 回到本关最近检查点，不回退章节、不清存档。 */
    /* 只读调试口（Lead 补；T1 扩充）：给自动机器人做规划与失败分类用。
     * 只读快照，不暴露 R 本身的引用（数组一律 slice/map 出新对象），
     * 任何调用都不改运行时状态 —— 加/删字段都不许影响游戏行为。 */
    _debug: function () {
      return {
        gate: R.gate ? R.gate.slice() : null,
        activeWave: R.active ? R.active.def.id : null,
        busy: !!R.busy, bossDown: !!R.bossDown, ended: !!R.ended,
        spawn: [R.spawnX, R.spawnY],
        fireT: R.fireT, fog: R.fog, t: R.t,
        firstInk: !!R.firstInk, firstHurt: !!R.firstHurt, firstBurn: !!R.firstBurn,
        boss: R.boss ? { id: R.def.boss, x: R.boss.x, y: R.boss.y,
                         hp: R.boss.hp, maxHp: R.boss.maxHp,
                         phase: R.boss.phase, act: R.boss.act, dead: !!R.boss.dead } : null,
        waves: R.waves.map(function (r) {
          return { id: r.def.id, x: r.def.x, w: r.def.w,
                   gate: r.def.gate ? r.def.gate.slice() : null,
                   floorY: waveFloorY(r.def),
                   started: r.started, cleared: r.cleared,
                   alive: r.foes.filter(function (e) { return !e.dead && e.hp > 0; }).length };
        }),
        triggers: R.triggers.map(function (t, i) {
          var d = t.def;
          return { i: i, fired: t.fired, ok: whenOk(t), when: d.when || null,
                   interact: !!d.interact,
                   x: d.x, y: d.y, w: d.w, h: d.h,
                   play: (d.event && d.event.play) || null,
                   flag: (d.event && d.event.flag) ? d.event.flag.slice() : null };
        }),
        blockers: (R.def.blockers || []).map(function (b) {
          return { x: b.x, flag: b.flag, open: !!SJ.Story.get(b.flag) };
        }),
        rafts: R.rafts.map(function (r) {
          return { x: r.solid.x, y: r.solid.y, w: r.solid.w, h: r.solid.h,
                   ax: r.def.ax, bx: r.def.bx, period: r.def.period };
        }),
        pickups: R.pickups.map(function (k) {
          return { x: k.x, y: k.y, refill: k.refill, taken: k.taken };
        })
      };
    },

    /* 决议 022：死亡复活满血。
     * 原来 Player.create 读的是 Save.data.hp，而那个字段只在 complete() 里写过一次 ——
     * 于是「上一关残 2 血通关」会把后面整局锁死在 2 血，且游戏没有任何回血手段。
     * 实测：第一回残 2 血通关 → 第二回死 16 次 417s → 第三回死 54 次 900s 没打完。 */
    restartFromCheckpoint: function () {
      var idx = SJ.Level.current >= 0 ? SJ.Level.current : (SJ.Save.data.chapter | 0);
      var d = SJ.Save.data;
      d.hp = d.maxHp;
      SJ.Level.load(idx, true);
    },

    load: function (idx, checkpoint) {
      var def = SJ.Levels[idx];
      if (!def) { console.warn('[G] 没有第 ' + idx + ' 关'); return; }

      reset(def);
      R.idx = idx;
      SJ.Level.current = idx;
      SJ.Level.def = def;
      SJ.Level.pickups = R.pickups;

      data().chapter = idx;
      if (!checkpoint) flags().cp = 0;
      var ci = SJ.clamp(flags().cp | 0, 0, def.checkpoints.length - 1);
      var cp = def.checkpoints[ci];
      R.spawnX = cp[0]; R.spawnY = cp[1];

      var p = SJ.Player.create(cp[0] - PLAY_W / 2, cp[1] - PLAY_H);
      p.inkDrainMul = 1;
      R.fog = (def.weather === 'snow') ? 1 : 0;

      SJ.Camera.setBounds(0, def.w, 0, def.h);
      SJ.Camera.snap(p.cx(), p.cy());
      SJ.Audio.music(def.music);
      SJ.Audio.intensity(0.15);

      SJ.Game.setScene(scene);
      // 重生不重播开场；第一次进这一关才播（intro 链里带章节卡）
      if (!checkpoint) play(def.intro);
    },

    checkpoint: function (x, y) {
      R.spawnX = x; R.spawnY = y;
    },

    spawnWave: function (waveDef) { spawnWave(waveDef); },

    // ★ 决议 002 §2：mercy 的唯一写入者是 SJ.Story.mercyChoice。
    //   这里绝不出现 SJ.Save.data.mercy = ... —— 方向写反会让不可靠叙述者静默失效。
    // ★ 决议 003 的时序：倒地 → down → mercyChoice（内部当场写入并存档）
    //   → 回调里演出 → complete() → 播 outro（读得到刚写下的值）→ 存档
    bossDefeated: function (id) {
      if (R.bossDown) return;
      R.bossDown = true;
      R.gate = null;
      SJ.Audio.intensity(0.1);

      play(R.def.bossScript && R.def.bossScript.down, function () {
        R.busy = true;
        SJ.Story.mercyChoice(id, function (killed) {
          R.busy = false;
          if (killed) {
            SJ.Audio.sfx('hitHeavy', { vol: 1 });
            SJ.Game.shake(7, 0.35);
            if (R.boss) SJ.FX.splash(R.boss.cx(), R.boss.cy(), -0.6,
              { n: 16, color: C.cinnabar, speed: 240, groundY: R.boss.y + R.boss.h });
          } else {
            SJ.Audio.sfx('sheathe', { vol: 0.9 });
          }
          SJ.Game.slowmo(0.35, 0.8);
          SJ.Level.complete();
        });
      });
    },

    complete: function () {
      var idx = R.idx, def = R.def;
      SJ.Audio.intensity(0);

      if (idx >= SJ.Levels.length - 1) {
        SJ.Story.ending();                     // 内部就是 play('f_end') + Menu.ending
        return;
      }
      R.busy = true;
      SJ.Story.play(def.outro, function () {   // 决议 003：先播 outro，再存档
        R.busy = false;
        var d = data();
        d.chapter = idx + 1;
        d.hp = d.maxHp;                        // 决议 022：进新章满血
        d.flags.cp = 0;
        SJ.Save.save();
        SJ.Game.fade('out', 0.6, function () {
          SJ.Level.load(idx + 1, false);
          SJ.Game.fade('in', 0.6);
        });
      });
    }
  };

})(window.SJ = window.SJ || {});
