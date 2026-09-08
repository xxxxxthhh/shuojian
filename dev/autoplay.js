#!/usr/bin/env node
/* dev/autoplay.js  【T1】能通关的机器人
 *
 *   node dev/autoplay.js [关卡号|all] [--kill|--mercy] [--seed N] [--max 秒] [-v]
 *
 * 与 dev/walk.js 的区别（walk.js 保留，它是「笨机器人」的基线）：
 *   1. 输入走 dev/harness.js 的如实输入模型 —— 按下沿/抬起沿/缓冲/consume 都对，
 *      不会因为 buffered 恒真而每次落地都重跳（walk.js 在第一回跳了 967 次）。
 *   2. 移动走 dev/nav.js 的表面图 + Dijkstra，跳跃包络由 dev/jumpcal.js 在真沙盒标定。
 *      「路线找不到」本身就是证据 —— 那是真软锁，不是机器人笨。
 *   3. 认得对白层 / 生杀抉择 / 死亡 / **结局**。结局走的是 setScene 不是 push，
 *      栈会被整个换掉，只看「关卡序号变了」的机器人在终章会一直撞墙（walk.js 卡 x=3248 的真因）。
 */
'use strict';
const { boot } = require('./harness.js');
const nav = require('./nav.js');

/* ── 参数 ─────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const flag = n => argv.indexOf(n) >= 0;
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const positional = argv.filter(a => !a.startsWith('-') &&
  argv[argv.indexOf(a) - 1] !== '--seed' && argv[argv.indexOf(a) - 1] !== '--max');
const WHICH = positional[0] === undefined ? 'all' : positional[0];
const KILL = flag('--kill');
const SEED = Number(val('--seed', 7));
const MAXSEC = Number(val('--max', 900));
const VERBOSE = flag('-v') || flag('--verbose');
const CP = val('--cp', null);
const NORENDER = flag('--norender');
const TRACE = Number(val('--trace', 0));

/* ── 机器人 ───────────────────────────────────────────────────────── */
/* 观势的三个阈值 —— 都是在第六回 Boss（师兄，520 血）上实测扫出来的，不是拍的：
 *   frac 0.30→0.01（起手式一出现就举手）：格挡 60→110，死 43→33
 *   melee 0→140（贴身兜底举手，不等起手式）：挨打 199→24，死 33→3
 * 结论是这套战斗里「完美观势」强得离谱（全额免伤 + 回墨 + 硬直 0.9s），
 * 而机器人每死一次就要从检查点重打一遍，死亡的时间成本远高于打得慢。 */
const TUNE = { frac: 0.01, dist: 260, melee: 260 };   // 观势的触发阈值，dev 调参用
const HOLDJ = 14;              // 按住跳跃键的帧数：与 nav.simJump / jumpcal 同一策略
const REPLAN = 8;              // 每几帧重建一次表面图（浮筏在动，门在开）

function Bot(H, opt) {
  this.H = H;
  this.kill = !!(opt && opt.kill);
  this.jumpTimer = 0;
  this.jumpRest = 0;
  this.dblUsed = false;
  this.upPhase = 0;
  this.guardLatch = 0;
  this.airTarget = null;      // 起跳那一刻锁定的目标面（空中不许改主意）
  this.foeIdle = 0; this.foeHpIdle = 0; this.hpRefFoe = null; this.hpRefVal = 0;
  this.planAge = 1e9;
  this.surf = null; this.adj = null;
  this.stuckRef = null; this.stuckFrames = 0; this.escalate = 0;
  this.log = [];
  this.noRoute = 0;
  this.deaths = 0;
  this.lastGoal = null;
}

Bot.prototype.note = function (s) { if (this.log[this.log.length - 1] !== s) this.log.push(s); };

/* ── 目标：这一刻该往哪儿去 ──────────────────────────────────────── */
Bot.prototype.goal = function () {
  const H = this.H, d = H.dbg(), def = H.SJ.Level.def, p = H.player();

  // Boss 在场 → 打 Boss
  if (d.boss && !d.bossDown) return { x: d.boss.x + 14, y: d.boss.y + 56, kind: 'boss' };

  // 波次门锁着 → 去打门里的敌人（够不到就是真软锁，让 nav 去证明）
  if (d.gate) {
    const f = this.pickFoe(true);
    if (f) return { x: f.cx(), y: f.y + f.h, kind: 'foe' };
    return { x: (d.gate[0] + d.gate[1]) / 2, kind: 'gate-empty' };
  }

  // blocker 挡路 → 去触发能开它的那个 trigger
  for (const b of d.blockers) {
    if (b.open) continue;
    if (p.x + p.w <= b.x - 2 || true) {
      const t = d.triggers.filter(t => t.flag && t.flag[0] === b.flag && t.flag[1] && !t.fired)[0];
      if (t) return { x: t.x + t.w / 2, y: t.y + t.h, kind: 'blocker-trigger', t };
    }
  }

  // 有 Boss 还没刷出来 → 去触发 bossScript.pre
  if (def.boss && !d.boss) {
    const pre = def.bossScript && def.bossScript.pre;
    const t = d.triggers.filter(t => t.play === pre && !t.fired)[0];
    if (t) return { x: t.x + t.w / 2, y: t.y + t.h, kind: 'boss-trigger', t };
    return { x: def.bossArena[0] + 30, y: def.bossY, kind: 'boss-arena' };
  }

  // 挡路的敌人：同层且在去路上
  const f = this.pickFoe(false);
  if (f) return { x: f.cx(), y: f.y + f.h, kind: 'foe' };

  return { x: def.exitX + 24, kind: 'exit' };
};

Bot.prototype.pickFoe = function (any) {
  const H = this.H, p = H.player(), foes = H.foes();
  let best = null, bd = 1e9;
  for (const e of foes) {
    const dx = Math.abs(e.cx() - p.cx());
    const dy = Math.abs((e.y + e.h) - (p.y + p.h));
    if (!any && (dx > 420 || dy > 150)) continue;
    const score = dx + dy * 2;
    if (score < bd) { bd = score; best = e; }
  }
  return best;
};

/* ── 表面图 ───────────────────────────────────────────────────────── */
Bot.prototype.plan = function () {
  const H = this.H, def = H.SJ.Level.def, d = H.dbg();
  const raftSolids = new Set();
  const surf = [];
  for (const r of d.rafts) raftSolids.add(r.x + '|' + r.y + '|' + r.w);
  for (const s of H.SJ.World.solids) {
    if (s.gone) continue;
    surf.push({ x0: s.x, x1: s.x + s.w, y: s.y, lx0: s.x, lx1: s.x + s.w,
                oneway: !!s.oneway, solid: s });
  }
  // 浮筏：规划用整段行程（等它过来就是路），执行用它此刻的实际位置
  for (const r of d.rafts) {
    for (const q of surf) {
      if (q.solid && q.solid.x === r.x && q.solid.y === r.y && q.solid.w === r.w) {
        q.x0 = r.ax; q.x1 = r.bx + r.w; q.raft = true;
      }
    }
  }
  this.surf = surf;
  this.adj = nav.buildGraph(surf, { windAx: (def.env && def.env.windAx) || 0,
                                   hazards: def.hazards, solids: H.SJ.World.solids });
  this.planAge = 0;
};

/* 目标 x（可选 y）所在的那些面 */
Bot.prototype.targetsFor = function (gx, gy) {
  const out = [];
  for (let i = 0; i < this.surf.length; i++) {
    const q = this.surf[i];
    if (gx < q.x0 - 24 || gx > q.x1 + 24) continue;
    if (gy !== undefined && Math.abs(q.y - gy) > 120) continue;
    out.push(i);
  }
  if (!out.length) {                       // 目标不在任何一块面的正上方：退而求其次取最近的
    let bi = -1, bd = 1e9;
    for (let i = 0; i < this.surf.length; i++) {
      const q = this.surf[i];
      const dx = gx < q.x0 ? q.x0 - gx : (gx > q.x1 ? gx - q.x1 : 0);
      const dy = gy === undefined ? 0 : Math.abs(q.y - gy);
      if (dx + dy < bd) { bd = dx + dy; bi = i; }
    }
    if (bi >= 0) out.push(bi);
  }
  return out;
};

/* ── 地形探测 ─────────────────────────────────────────────────────── */
Bot.prototype.wallAhead = function (dir) {
  const p = this.H.player(), footY = p.y + p.h;
  const x = dir > 0 ? p.x + p.w : p.x;
  for (const s of this.H.SJ.World.solids) {
    if (s.gone || s.oneway) continue;
    const near = dir > 0 ? (s.x >= x - 2 && s.x <= x + 14) : (s.x + s.w <= x + 2 && s.x + s.w >= x - 14);
    if (!near) continue;
    if (s.y < footY - 8 && s.y + s.h > p.y + 6) return s;
  }
  return null;
};
Bot.prototype.groundAhead = function (dir, dist) {
  const p = this.H.player(), footY = p.y + p.h;
  const x = p.cx() + dir * dist;
  for (const s of this.H.SJ.World.solids) {
    if (s.gone) continue;
    if (x < s.x || x > s.x + s.w) continue;
    if (Math.abs(s.y - footY) <= 10) return s;
  }
  return null;
};
Bot.prototype.inUpdraft = function () {
  const p = this.H.player();
  for (const h of this.H.SJ.Level.def.hazards) {
    if (h.kind !== 'updraft') continue;
    if (p.x < h.x + h.w && p.x + p.w > h.x && p.y < h.y + h.h && p.y + p.h > h.y) return h;
  }
  return null;
};
Bot.prototype.waterAhead = function (dir) {
  const p = this.H.player(), footY = p.y + p.h;
  const x = p.cx() + dir * 40;
  for (const h of this.H.SJ.Level.def.hazards) {
    if (h.kind !== 'water') continue;
    if (x > h.x && x < h.x + h.w && footY > h.y - 60 && footY < h.y + h.h) return h;
  }
  return null;
};

/* ── 起跳 ──────────────────────────────────────────────────────────
 * 起跳键必须「按住 HOLDJ 帧 → 松开至少 3 帧」。
 * 第一版忘了留松开的那几帧：jumpTimer 归零那一帧 want.jump 还是 1，
 * 紧接着 doJump 又填满 14 —— 于是跳跃键**一辈子按着**，
 * 只有开局那一次按下沿。游戏里 buffered('jump') 只认按下沿，
 * 所以机器人从此再也跳不起来，表现是「顶着 60px 的石台原地跑」，不报任何错。 */
Bot.prototype.doJump = function () {
  if (this.jumpTimer <= 0 && this.jumpRest <= 0) {
    this.jumpTimer = HOLDJ;
    if (this.pendingTarget) this.airTarget = this.pendingTarget;   // 锁定这一跳的落点
  }
};

/* 空中预判：照当前速度自由落到 B 的高度，落点在不在 B 上。
 * 「到了顶点还差多少」比「我在不在 B 下面」靠谱得多 —— 后者在顶点时恒为假，
 * 于是二段跳永远不放，第二回那 130px 的水面就永远过不去。 */
Bot.prototype.landingX = function (B, dir) {
  const p = this.H.player(), def = this.H.SJ.Level.def;
  const env = ((def.env && def.env.windAx) || 0) / nav.P.ENV_DRAG;
  const dt = nav.P.DT;
  let vy = p.vy, y = p.y + p.h, x = p.cx();
  const vx = dir * nav.P.RUN + env;
  for (let i = 0; i < 240; i++) {
    vy += nav.P.G * dt;
    if (vy > nav.P.MAXFALL) vy = nav.P.MAXFALL;
    x += vx * dt; y += vy * dt;
    if (vy > 0 && y >= B.y) return x;
  }
  return x;
};

/* ── 每帧 ─────────────────────────────────────────────────────────── */
Bot.prototype.tick = function () {
  const H = this.H, w = H.where();
  if (w === 'overlay') return this.overlay();
  if (w !== 'level') return {};
  return this.level();
};

Bot.prototype.overlay = function () {
  // 对白层只读 confirm；生杀抉择只读 attack（杀）/ left·right·dash·down（饶）；
  // 死亡与暂停只读 confirm。三者互不干扰，所以一起按最省事，也不会误触。
  const every = this.H.frame % 6 === 0;
  if (!every) return {};
  const want = { confirm: 1 };
  if (this.H.dbg().bossDown) { if (this.kill) want.attack = 1; else want.left = 1; }
  return want;
};

Bot.prototype.level = function () {
  const H = this.H, p = H.player(), d = H.dbg(), def = H.SJ.Level.def;
  const want = {};
  if (p.hp <= 0) return want;

  if (p.onGround) this.dblUsed = false;
  if (this.jumpTimer > 0) { this.jumpTimer--; if (this.jumpTimer === 0) this.jumpRest = 3; }
  else if (this.jumpRest > 0) this.jumpRest--;
  if (this.planAge++ >= REPLAN) this.plan();

  const goal = this.goal();
  this.lastGoal = goal;

  /* —— 路线 ——
   * ★ 空中锁定目标面。surfaceUnder 在腾空时会返回「正下方那一块」，
   *   于是人还在半空、脚下刚好掠过下一块台子时，规划器就以为自己已经站上去了，
   *   立刻改planning下一跳，判定「这一跳会落短」→ 当场补一个二段跳 →
   *   200px 高地飞过目标掉进河里。第三回每一条沟都是这么掉的。
   *   起跳时把目标面锁住，落地再解锁。 */
  const cur = nav.surfaceUnder(this.surf, p.cx(), p.y + p.h, 12);
  let nextIdx = -1, edge = null;
  if (p.onGround) this.airTarget = null;
  if (!p.onGround && this.airTarget) {
    const q = this.surf[this.airTarget.i];
    if (q && Math.abs(q.y - this.airTarget.y) < 2 && Math.abs(q.x0 - this.airTarget.x0) < 2) {
      nextIdx = this.airTarget.i; edge = this.airTarget.edge;   // 浮筏会动，所以用活的 surf[i]
    } else this.airTarget = null;
  }
  if (nextIdx < 0 && cur >= 0) {
    const tg = this.targetsFor(goal.x, goal.y);
    if (tg.indexOf(cur) >= 0) nextIdx = cur;
    else {
      const r = nav.route(this.adj, cur, tg);
      if (r && r.path.length > 1) { nextIdx = r.path[1]; edge = this.adj[cur].filter(e => e.to === nextIdx)[0]; }
      else { this.noRoute++; }
    }
  }
  if (p.onGround && nextIdx >= 0 && nextIdx !== cur) {
    const q = this.surf[nextIdx];
    this.pendingTarget = { i: nextIdx, y: q.y, x0: q.x0, edge: edge };
  } else if (p.onGround) this.pendingTarget = null;

  /* —— 方向 —— */
  const A = cur >= 0 ? this.surf[cur] : null;
  let aimX, dropThrough = false;
  if (nextIdx >= 0 && nextIdx !== cur) {
    const B = this.surf[nextIdx];
    // 瞄「B 上离我最近的那一点」，不是终点 x。
    // 瞄终点 x 会让机器人在第二回一层直奔 3465 —— 而通往三层的楼梯在 960，
    // 它就一路撞到底也不回头，表现是「在一层来回跑」，永远上不了楼。
    aimX = Math.max(B.lx0 + 16, Math.min(p.cx(), B.lx1 - 16));
    if (B.raft) aimX = (B.lx0 + B.lx1) / 2;              // 浮筏：瞄中心，别踩边

    // 下一跳在脚下这块之下、又正好在同一段 x 上 → 「最近的一点」就是脚底，
    // dir 会算成 0，机器人站在柱子顶上一动不动直到超时（第二回 2600 那根柱子实测）。
    if (A && B.y > A.y + 6 && p.cx() > B.lx0 && p.cx() < B.lx1) {
      if (A.oneway) dropThrough = true;                   // 单向平台：直接下穿
      else {
        const gdir = goal.x >= p.cx() ? 1 : -1;           // 实心块：走到朝目标那一侧的边缘再迈下去
        aimX = gdir > 0 ? Math.min(B.lx1 - 8, A.lx1 + 26) : Math.max(B.lx0 + 8, A.lx0 - 26);
      }
    }
  } else {
    aimX = goal.x;
  }
  let dir = aimX > p.cx() + 6 ? 1 : (aimX < p.cx() - 6 ? -1 : 0);

  /* —— 战斗 ——
   * 完美观势 = 全额免伤 + 回墨 18 + 敌人硬直 0.9s，而观势在墨 ≤20 时**不再扣墨**，
   * 所以「见起手式就按住 guard」几乎没有代价，是这套战斗里性价比最高的一手。
   * 两个要点（第一版都错了，实测第二回第 5 波死了 84 次）：
   *   ① 要看**所有**近处敌人的起手式，不能只看最近那一个 —— 四人围殴时
   *      挨的正是另外三个人的刀；
   *   ② 起手式在 t≥dur 那一帧就被移除，而 hitbox 往往晚一两帧才落下，
   *      跟着起手式松手等于恰好在挨打那一瞬间不在观势 —— 所以要留一个后摇闩。 */
  const allFoes = H.foes();
  const foe = this.pickFoe(false);
  // ③ 起手式的**前三成**是安全的（刀还在举），这段时间该打不该守。
  //    一见起手式就守到底的话，Boss 起手式几乎不断，机器人会全程举着手站着挨时间：
  //    实测第二回 Boss 三百秒只掉 70 血。
  // 只对 200px 以内的起手式举手：观势把走速砍到 45%，
  // 对着两百步外的弓手一路举着手追，永远追不上（第二回第 5 波实测，六百秒没打完一个弓手）。
  let tele = false;
  for (const e of allFoes) {
    if (Math.abs(e.cx() - p.cx()) > TUNE.dist || Math.abs(e.cy() - p.cy()) > 170) continue;
    const tg = H.SJ.Combat.tgOf(e);
    if (tg && tg.danger && tg.t >= tg.dur * TUNE.frac) { tele = true; break; }
  }
  /* 「够得着」必须按脚底高差判，容差 44 而不是 90。
   * 用 90 会把「站在 60px 高台上的敌人」也算成够得着 —— 于是机器人贴着台子根
   * 一直挥空刀。而 player.js 的 control() 在攻击状态里直接 return，
   * 攻击把跳跃整个吃掉：机器人按了跳、jumpTimer 也在走，人就是不离地。
   * 第四回第一波实测卡了九百秒，日志里 st 永远是 atk1/atk2/atk3。 */
  const dyFoot = foe ? (foe.y + foe.h) - (p.y + p.h) : 0;   // <0 = 敌人更高
  const foeNear = foe && Math.abs(foe.cx() - p.cx()) < 96 && Math.abs(dyFoot) < 44;
  const foeAbove = foe && dyFoot < -30 && Math.abs(foe.cx() - p.cx()) < 220;
  // 格挡成功 → 对面硬直 0.9s，这是唯一稳定的输出窗口（Boss 有 superArmor，硬打不会僵）
  /* 读势：danger:false 的起手式（守阁人的「守」、僧人的架势）不会打人，
   * 但**观满它的一半就长残墨**（combat.js 里 tg.read 那一段）。
   * 无锋只能这么学，而守阁人只吃无锋 —— 不读势的机器人拿他一点办法没有：
   * 实测五百秒，Boss 320 血一滴没掉，因为普攻全被 block() 挡了。 */
  let readStance = false;
  for (const e of allFoes) {
    if (Math.abs(e.cx() - p.cx()) > 380) continue;
    const tg = H.SJ.Combat.tgOf(e);
    if (tg && !tg.danger && !tg.read) { readStance = true; break; }
  }
  const punish = (foe && foe.stunT > 0) || p.parryGlow > 0;
  // 残血时贴身多观势一些 —— 但必须留出输出窗口。
  // 写成「残血就一直守」会死锁：这游戏没有回血手段，血一旦低于线就再也上不去，
  // 机器人于是举着手站在守阁人面前三百五十秒，Boss 一滴血没掉（第五回实测）。
  const hurtBad = p.hp <= p.maxHp * 0.4 && foe &&
                  Math.abs(foe.cx() - p.cx()) < 150 && (H.frame % 48) < 30;
  // 贴身时的兜底观势：Boss 的招不全带够长的起手式，纯靠 telegraph 会漏
  /* 「对面正在出招吗」比任何占空比都准：ai.js 里敌人执行招式期间 e.mv 非空。
   * 有 e.mv 就举手（起手式还没画出来也照样举，Boss 有些招前摇极短），
   * 没 e.mv 就打。这样既不会和一个 idle 的弓手互相举手举到天荒地老，
   * 也不会在对面挥刀的半途伸手去砍。 */
  /* 贴身就举手 —— 实测这是唯一能把第六回 Boss 的挨打次数压下来的做法
   * （199 → 24，死 33 → 3）。试过用 e.mv / e.act==='idle' 挑时机放手，
   * 都明显更差：敌人真正落刀的那一帧未必带着可读的状态。
   * 代价是会和「站着不发呆的敌人」互相举手僵住 —— 所以配一个僵局闸：
   * 场上敌人总血量长时间不降，就强行开一段输出窗口。 */
  /* 贴身就举手 —— 实测这是唯一能把第六回 Boss 的挨打次数压下来的做法
   * （挨打 199→24，死 33→3）。试过按 e.mv / 瞬时 e.act==='idle' 挑时机放手，
   * 都明显更差（死 29~45）：敌人真正落刀的那一帧状态常常也是 idle。
   * 代价是会和一个真的一动不动的敌人互相举手僵住（第六回那个 22 血的弓手
   * 让机器人对着它举了两万帧）—— 所以配一个僵局闸：**连续**一秒毫无动作才放手。 */
  // 僵局闸只在**非 Boss 战**里生效，而且要求连续两秒毫无动作。
  // Boss 会有长达一秒多的「看起来没动」，在那儿放手实测死亡 3 → 41。
  const quiet = foe && !foe.mv && foe.stunT <= 0 && !H.SJ.Combat.tgOf(foe) &&
                (foe.act === 'idle' || foe.act === 'guard');
  if (quiet) this.foeIdle++; else this.foeIdle = 0;
  // 第二道闸，不看敌人内部状态只看结果：目标的血长时间不掉 = 僵住了。
  // （第五回那个僧人 act 一直是 'guard'，第一道闸认不出来，机器人对着他举了 448 次手。）
  if (foe !== this.hpRefFoe || (foe && foe.hp < this.hpRefVal - 0.5)) {
    this.hpRefFoe = foe; this.hpRefVal = foe ? foe.hp : 0; this.foeHpIdle = 0;
  } else this.foeHpIdle++;
  const deadlock = d.boss ? this.foeHpIdle > 600
                          : (this.foeIdle >= 120 || this.foeHpIdle > 300);
  const melee = !!(TUNE.melee && foe && !deadlock &&
                   Math.abs(foe.cx() - p.cx()) < TUNE.melee &&
                   Math.abs((foe.y + foe.h) - (p.y + p.h)) < 90);
  if (punish) this.guardLatch = 0;
  else if (readStance) this.guardLatch = 8;
  else if (tele || hurtBad || melee) this.guardLatch = 12;
  else if (this.guardLatch > 0) this.guardLatch--;
  const guarding = this.guardLatch > 0 && !/^atk/.test(p.state);
  if (guarding) want.guard = 1;

  if (foeNear && !guarding) {
    dir = foe.cx() > p.cx() ? 1 : -1;
    if (Math.abs(foe.cx() - p.cx()) < 34) dir = 0;
    if (H.frame % 9 === 0) want.attack = 1;
  } else if (foeAbove) {
    // 敌人在台子上：先爬上去，别在下面挥空刀（挥刀期间跳不起来）
    dir = foe.cx() > p.cx() ? 1 : -1;
    if (p.onGround) this.doJump();
  } else if (foe && !guarding && Math.abs(foe.cx() - p.cx()) < 420 &&
             Math.abs((foe.y + foe.h) - (p.y + p.h)) < 90) {
    dir = foe.cx() > p.cx() ? 1 : -1;
    // 拉开距离的敌人（弓手会一直后退）用身法贴上去，顺带吃 0.2s 无敌
    if (p.onGround && p.dashCd <= 0 && Math.abs(foe.cx() - p.cx()) > 150 && H.frame % 20 === 0) want.dash = 1;
  }

  /* —— 招式 ——
   * 守阁人 openT<=0 时普攻一律被挡（bosses.js block()），唯一能撬开他的是无锋；
   * 其余场合偶尔放一招补伤害，墨不够就不放。 */
  if (foe && !guarding && !/^atk/.test(p.state)) {
    const slots = H.SJ.Save.data.slots || [];
    const TK = ['t1', 't2', 't3', 't4'];
    /* ★ 守阁人只吃无锋，而 Tech.learn 只往**空槽**里塞：一周目走到第五回时四个槽
     * 通常已经满了，于是无锋「学会了但没装上」，Boss 变成完全无敌。
     * 真人必须自己想到「进暂停菜单换招」，游戏没有任何提示（DESIGN 铁律 3 不做教程）。
     * 机器人在这里替真人做那一次换招 —— 走契约 007 §1 唯一写入口，等价于菜单操作。
     * 这不是修 bug，是**绕过**它；问题本身已报给 Lead（见 notes-T1）。 */
    if (foe.openT !== undefined && slots.indexOf('wufeng') < 0 &&
        H.SJ.Save.data.known.indexOf('wufeng') >= 0) {
      H.SJ.Player.setSlot(3, 'wufeng');
      this.autoEquipped = (this.autoEquipped || 0) + 1;
    }
    const dist = Math.abs(foe.cx() - p.cx());
    let use = -1;
    for (let i = 0; i < 4; i++) {
      const id = slots[i];
      if (!id || !H.SJ.Tech.can(p, id)) continue;
      if (id === 'wufeng' && foe.openT !== undefined && foe.openT <= 0 &&
          dist < 140 && H.frame % 14 === 0) { use = i; break; }
      // 硬直窗口是唯一稳定的输出机会，招式伤害远高于普攻，优先在这里放
      if (use < 0 && dist < 140 && p.ink > 34 && punish && H.frame % 20 === 0) use = i;
      else if (use < 0 && dist < 140 && p.ink > 62 && H.frame % 96 === 0) use = i;
    }
    if (use >= 0) want[TK[use]] = 1;
  }

  /* —— 回墨：路过可击碎物件顺手一刀 —— */
  if (p.ink < 62 && !foeNear) {
    for (const k of d.pickups) {
      if (k.taken || k.refill) continue;
      if (Math.abs(k.x - p.cx()) < 40 && Math.abs(k.y - (p.y + p.h)) < 46) {
        if (H.frame % 8 === 0) want.attack = 1;
        break;
      }
    }
  }

  /* —— 互动 trigger：站在里面就按 —— */
  for (const t of d.triggers) {
    if (t.fired || !t.interact || !t.ok || t.x === undefined) continue;
    if (p.x < t.x + t.w && p.x + p.w > t.x && p.y < t.y + t.h && p.y + p.h > t.y) {
      if (H.frame % 4 === 0) want.interact = 1;
    }
  }

  /* —— 移动与跳 —— */
  if (dir > 0) want.right = 1; else if (dir < 0) want.left = 1;

  const up = this.inUpdraft();
  if (up) {
    // 风口：站进去 + 反复起跳。实测「只站着」只被托 108px，够不到 620px 的崖顶；
    // 反复起跳才是设计意图（每次落回崖底平台都会把二段跳还回来）。
    this.upPhase = (this.upPhase + 1) % 34;
    if (this.upPhase < 18) want.jump = 1;
    this.jumpTimer = 0;
  } else {
    const B = (nextIdx >= 0 && nextIdx !== cur) ? this.surf[nextIdx] : null;
    const needUp = !!B && B.y < (p.y + p.h) - 8;
    if (p.onGround) {
      if (dir !== 0) {
        const wall = this.wallAhead(dir);
        const edgeAhead = !this.groundAhead(dir, 22);
        const water = this.waterAhead(dir);
        if (wall) this.doJump();                                 // 顶着墙 → 跳
        else if (water) this.doJump();                           // 前面是水 → 跳
        // 脚下到头了：不论目标在上在下，跳出去都比走下去远（走下去多半是掉进水里）
        else if (edgeAhead && B) this.doJump();
        else if (needUp && Math.abs(p.cx() - (dir > 0 ? B.lx0 : B.lx1)) < 80) this.doJump();
      } else if (needUp && p.cx() >= B.lx0 - 12 && p.cx() <= B.lx1 + 12) {
        this.doJump();                                           // 目标就在正头顶，原地起跳
      }
    }
    // 二段跳：过了顶点再决定。三种情形要补第二跳：
    //   ① 图上这条边本来就标着要二段跳；② 顶点时脚还在目标面之下；③ 预判会落短。
    //   （落长了补跳只会更长，所以不补。）
    // vy 的窗口必须**卡在顶点附近**（-60 < vy < 130，也就是过顶点后的两三帧）。
    // 写成「vy > -60」就等于整个下落段都在判：人一落到目标面高度以下就补一跳，
    // 于是每次跨沟都会在半途弹起 200px 飞过目标，掉进河里（第三回实测）。
    if (!p.onGround && this.jumpTimer <= 0 && this.jumpRest <= 0 &&
        !this.dblUsed && p.vy > -60 && p.vy < 130 && p.airJumps > 0 && B) {
      let need = !!(edge && (edge.kind === 'jump2' || edge.kind === 'fall2'));
      if (!need && (p.y + p.h) > B.y + 4 && B.y < (p.y + p.h)) need = true;
      if (!need && dir !== 0) {
        const lx = this.landingX(B, dir);
        need = dir > 0 ? lx < B.lx0 + 10 : lx > B.lx1 - 10;
      }
      if (need) { this.dblUsed = true; this.jumpTimer = HOLDJ; }
    }
    if (dropThrough && p.onGround && this.jumpTimer <= 0 && this.jumpRest <= 0) {
      want.down = 1; this.doJump();                       // down + jump = 下穿单向平台
    }
    if (this.jumpTimer > 0) want.jump = 1;
  }

  /* —— 卡住升级 —— */
  const key = (goal.kind || '') + '|' + (goal.x | 0);
  const prog = Math.abs(p.cx() - goal.x) + Math.abs((p.y + p.h) - (goal.y === undefined ? p.y + p.h : goal.y));
  if (!this.stuckRef || this.stuckRef.key !== key || prog < this.stuckRef.prog - 12) {
    this.stuckRef = { key, prog }; this.stuckFrames = 0; this.escalate = 0;
  } else if (++this.stuckFrames > 110) {
    this.stuckFrames = 0; this.escalate++;
    this.note('卡在 ' + key + ' 第 ' + this.escalate + ' 次挣扎');
    this.jumpRest = 0;
    if (this.escalate % 4 === 1) this.doJump();
    else if (this.escalate % 4 === 2) { this.doJump(); this.dblUsed = false; }
    else if (this.escalate % 4 === 3) { want.dash = 1; }
    else { want.down = 1; this.doJump(); }                        // 下穿单向平台
  }
  return want;
};

/* ── 失败分类（沿用 walk.js 那套，加上路线不通这一档）─────────────── */
function classify(H, bot) {
  const p = H.player(), d = H.dbg();
  const foes = H.foes(), footY = p ? p.y + p.h : 0;
  const inGate = d.gate ? foes.filter(e => e.cx() >= d.gate[0] && e.cx() <= d.gate[1]) : foes;
  const sameFloor = inGate.filter(e => Math.abs((e.y + e.h) - footY) <= 130);
  if (d.busy && H.stack().length === 1) return '⚠ 真软锁：busy 卡住且无对话层（play() 回调没回来）';
  if (d.gate && foes.length === 0) return '⚠ 真软锁：门锁着但已无存活敌人（波次清除判定失效）';
  if (d.gate && inGate.length === 0) return `⚠ 真软锁：门锁着，${foes.length} 个敌人全在门外`;
  if (d.gate && sameFloor.length === 0) return `⚠ 真软锁：门锁着，${inGate.length} 个敌人都不在玩家这一层（跨层触发）`;
  if (bot.noRoute > 60) return `⚠ 真软锁：表面图上从脚下走不到目标（${bot.noRoute} 帧无路线，目标=${bot.lastGoal && bot.lastGoal.kind}）`;
  if (H.stack().length > 1) return '机器人问题：对话层未推进';
  if (foes.length) return `机器人问题：${sameFloor.length} 个同层敌人没打完`;
  return '未分类：无门无敌人也没前进';
}

/* ── 跑一关 ───────────────────────────────────────────────────────── */
function runLevel(idx, opt) {
  const H = boot({ seed: opt.seed, render: !NORENDER });
  H.reset();
  if (opt.cp != null) {                      // 从第 N 个检查点起跑（复活审计 / 单波压测用）
    H.SJ.Save.data.flags.cp = Number(opt.cp);
    H.load(idx, true);
  } else {
    H.load(idx);
  }
  return driveFrom(H, idx, opt);
}

function driveFrom(H, idx, opt) {
  const bot = new Bot(H, opt);
  const t0 = H.playtime();
  const maxF = Math.round(opt.maxSec * 60);
  let deaths = 0, lastDeaths = H.SJ.Save.data.deaths | 0;
  let f = 0, result = null;
  // 受击统计（Lead 要的 windMul 判据）：玩家对象在复活时会被换掉，所以要跟着换基准
  let hits = 0, dmg = 0, parries = 0;
  let refP = H.player(), lastHp = refP ? refP.hp : 0, lastGlow = 0;
  for (; f < maxF; f++) {
    H.hold(bot.tick());
    H.step();
    const pp = H.player();
    if (pp !== refP) { refP = pp; lastHp = pp ? pp.hp : 0; lastGlow = 0; }
    else if (pp) {
      if (pp.hp < lastHp) { hits++; dmg += lastHp - pp.hp; }
      lastHp = pp.hp;
      if (pp.parryGlow > lastGlow + 0.1) parries++;
      lastGlow = pp.parryGlow;
    }
    const dd = (H.SJ.Save.data.deaths | 0) - lastDeaths;
    if (dd > 0) { deaths += dd; lastDeaths += dd; }
    if (opt.trace && f % opt.trace === 0) {
      const p = H.player(), d = H.dbg();
      console.log(`f${f} p=${p.x|0},${p.y|0} st=${p.state} hp=${p.hp|0} ink=${p.ink|0} gate=${JSON.stringify(d.gate)} goal=${bot.lastGoal&&bot.lastGoal.kind}@${bot.lastGoal&&bot.lastGoal.x|0} noRoute=${bot.noRoute} where=${H.where()} foes=${H.foes().map(e=>(e.def&&e.def.id)+'@'+(e.x|0)+','+(e.y|0)+'hp'+(e.hp|0)).join(' ')}`);
    }
    if (H.where() === 'ending') { result = 'ending'; break; }
    if (H.SJ.Level.current !== idx) { result = 'next'; break; }
  }
  const sec = H.playtime() - t0;
  return { ok: !!result, result, sec, frames: f, deaths, hits, dmg, parries, bot, H,
           x: H.player() ? H.player().x | 0 : -1,
           why: result ? '' : classify(H, bot) };
}

/* ── 主 ───────────────────────────────────────────────────────────── */
function main() {
  const H0 = boot({ seed: SEED, render: false });
  const N = H0.SJ.Levels.length;
  const branch = KILL ? '杀' : '饶';

  if (WHICH !== 'all') {
    const i = Number(WHICH);
    const r = runLevel(i, { seed: SEED, maxSec: MAXSEC, kill: KILL, trace: TRACE, cp: CP });
    report(i, H0.SJ.Levels[i], r);
    process.exit(r.ok ? 0 : 1);
  }

  // all：一周目连着跑（存档连续，cond 分支才是真的）
  console.log(`══ 全流程（分支：${branch}，seed=${SEED}）═══════════════════════════`);
  const H = boot({ seed: SEED, render: !NORENDER });
  H.reset();
  H.load(0);
  const rows = [];
  let okAll = true;
  for (let i = 0; i < N; i++) {
    if (H.SJ.Level.current !== i) { H.load(i); }
    H.levelScene = H.SJ.Game.stack[0];
    const r = driveFrom(H, i, { seed: SEED, maxSec: MAXSEC, kill: KILL, trace: TRACE });
    report(i, H.SJ.Levels[i], r);
    rows.push({ i, id: H.SJ.Levels[i].id, ok: r.ok, sec: r.sec, deaths: r.deaths,
                hits: r.hits, dmg: r.dmg, parries: r.parries,
                expected: H.SJ.Levels[i].expectedSec, why: r.why });
    if (!r.ok) { okAll = false; break; }
    if (r.result === 'ending') break;
  }
  console.log('\n── 时长表 ────────────────────────────────────────────');
  let tot = 0, totE = 0;
  for (const r of rows) {
    tot += r.sec; totE += r.expected;
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.i} ${r.id.padEnd(3)} 机器人 ${r.sec.toFixed(1).padStart(6)}s   预算 ${String(r.expected).padStart(4)}s   死 ${String(r.deaths).padStart(2)}   受击 ${String(r.hits).padStart(3)} 次/${String(r.dmg).padStart(4)} 伤   完美观势 ${r.parries}`);
  }
  console.log(`  合计 机器人 ${tot.toFixed(1)}s (${(tot / 60).toFixed(1)}min) / 预算 ${totE}s (${(totE / 60).toFixed(1)}min)`);
  console.log(okAll ? '\n✓ 八关全部通过' : '\n✗ 有关卡没过');
  process.exit(okAll ? 0 : 1);
}

function report(i, def, r) {
  const tag = r.result === 'ending' ? '✓ 结局' : (r.ok ? '✓' : '✗');
  console.log(`${tag} ${i} ${def.id} 《${def.title}》 ${r.sec.toFixed(1)}s (${r.frames}f) 死${r.deaths} 受击${r.hits}次/${r.dmg}伤 观势${r.parries} ${r.ok ? '' : 'x=' + r.x + ' → ' + r.why}`);
  if (!r.ok || VERBOSE) {
    const d = r.H.dbg();
    console.log(`    gate=${JSON.stringify(d.gate)} wave=${d.activeWave} busy=${d.busy} boss=${d.boss ? d.boss.hp + '/' + d.boss.maxHp : '-'} 敌=${r.H.foes().length} 目标=${JSON.stringify(r.bot.lastGoal && r.bot.lastGoal.kind)}`);
    if (r.bot.log.length) console.log('    ' + r.bot.log.slice(-6).join('\n    '));
  }
}

module.exports = { Bot, driveFrom, runLevel, classify, TUNE };
if (require.main === module) main();
