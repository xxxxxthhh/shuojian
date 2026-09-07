/* 【T3】敌人与 Boss 自检：预警分层 tier / 公平性（反应窗口）/ 阶段换势演出。
 *
 * 用法: node dev/enemy-check.js            全跑
 *       node dev/enemy-check.js --table    只打公平性审计表
 * 退出码非 0 = 失败。
 *
 * 教训（写在最前面）：不抛异常 ≠ 在运行。
 * 所以这里不读招表里的字面量来「证明」招表自己 —— 每一招都真的在沙盒里起手、跑帧，
 * 拦下它实际创建的 telegraph 与 hitbox，再拿这些跑出来的数据去判。
 *
 * 自建试炼场（不 load 关卡）：一条 4000px 的平地 + 一个玩家。
 * 好处是没有 Game.slowmo / 命中停顿掺进来，每帧就是 1/60，时间量得准。
 */
'use strict';
const fs = require('fs'), path = require('path');
const head = fs.readFileSync(path.join(__dirname, 'smoke.js'), 'utf8').split('/* ══ 第二阶段')[0]
  .replace(/process\.exit\([^)]*\);?/g, '').replace(/console\.log\(errors[\s\S]*$/, '');
eval(head + '\nglobalThis.__sb={SJ:SJ,mainCanvas:mainCanvas};');
const SJ = globalThis.__sb.SJ, mainCanvas = globalThis.__sb.mainCanvas;

const errors = [], notes = [];
const bad = m => errors.push(m);
const TABLE_ONLY = process.argv.includes('--table');

try { SJ.Audio.init(); } catch (e) { /* 沙盒无 AudioContext，预期 */ }
SJ.Game.init(mainCanvas);
// 命中停顿会把帧的 dt 缩小，时间就量不准了。测量期间关掉。
SJ.Game.slowmo = function () { };
SJ.Game.shake = function () { };

const TIERS = ['light', 'heavy', 'grab'];
const DT = 1 / 60;
const MIN_WIND = SJ.AI.MIN_WIND;          // 决议 018：下限只有 ai.js 一个定义处
if (!(MIN_WIND > 0)) bad('SJ.AI.MIN_WIND 不存在 —— 决议 018 的下限没有单一定义处');

/* ── 试炼场 ─────────────────────────────────────────────────── */

const FLOOR_Y = 600;
function arena() {
  SJ.Combat.clear();
  SJ.FX.clear();
  SJ.Ent.clear();
  SJ.World.load({ solids: [[0, FLOOR_Y, 4000, 80]] });
  const p = SJ.Player.create(300, FLOOR_Y);
  p.hp = p.maxHp; p.ink = p.maxInk;
  return p;
}

// 决议 005 §3 的每帧顺序（去掉关卡与相机）
function step(dt) {
  dt = dt || DT;
  SJ.Ent.updateAll(dt);
  SJ.Tech.update(dt);
  SJ.Combat.update(dt);
  SJ.FX.update(dt);
  SJ.Game.time += dt;
  // 玩家不该参与这场测量：挨打会触发硬直、格挡、命中停顿
  if (SJ.player) { SJ.player.invuln = 99; SJ.player.hp = SJ.player.maxHp; }
}

/* ── 拦截：谁在什么时候建了 telegraph / hitbox ───────────────── */

let clock = 0, rec = null;
const rawTg = SJ.Combat.telegraph.bind(SJ.Combat);
const rawHit = SJ.Combat.hit.bind(SJ.Combat);
SJ.Combat.telegraph = function (o) {
  const tg = rawTg(o);
  if (rec && o.owner === rec.owner) rec.tgs.push({ t: clock, tier: o.tier, dur: tg.dur, danger: tg.danger });
  return tg;
};
SJ.Combat.hit = function (o) {
  const hb = rawHit(o);
  if (rec && o.owner === rec.owner && hb.team === 'foe') rec.hits.push({ t: clock, hb: hb });
  return hb;
};

/* ── 单招试跑 ───────────────────────────────────────────────── */

function trial(kind, id, moveId, phase) {
  const p = arena();
  const e = kind === 'boss'
    ? SJ.Bosses.spawn(id, 900, FLOOR_Y, { facing: -1 })
    : SJ.Enemies.spawn(id, 900, FLOOR_Y, { facing: -1 });
  if (!e) { bad(`spawn 失败: ${id}`); return null; }
  e.onDefeat = function () { };
  // 只借 onPhase 的 windMul / speed，不走 setPhase 的换势演出（那条单独测）
  if (phase > 1) { e.phase = phase; if (e.def.onPhase) e.def.onPhase(e, phase); }
  for (let i = 0; i < 20; i++) step();          // 落地站稳

  e.vx = 0;                                     // 清掉走位攒下的速度，量的才是招本身的位移
  rec = { owner: e, tgs: [], hits: [] };
  clock = 0;
  const x0 = e.x, y0 = e.y;
  let disp = 0;
  const m = SJ.AI.moves[moveId];
  if (!m) { bad(`招不存在: ${moveId}`); rec = null; return null; }
  if (!SJ.AI.start(e, m)) { bad(`AI.start 失败: ${id}/${moveId}`); rec = null; return null; }
  disp = Math.abs(e.x - x0) + Math.abs(e.y - y0);   // onStart 里的瞬移（孤影/闪）

  // 跑到这一招彻底结束（含被 fire 换掉的后继招，如「说剑」→「横云断」）
  for (let f = 0; f < 400 && e.mv; f++) {
    step();
    clock += DT;
    disp = Math.max(disp, Math.abs(e.x - x0) + Math.abs(e.y - y0));
  }
  const out = {
    id: id, kind: kind, move: m, phase: phase || 1,
    windMul: e.windMul || 1,
    tgs: rec.tgs, hits: rec.hits, disp: disp, ownerRef: e,
    superArmor: !!e.superArmor
  };
  rec = null;
  return out;
}

/* ── 1. tier 标签完整性（读招表，但只判「有没有、合不合法」）──── */

const moves = SJ.AI.moves;
const moveIds = Object.keys(moves).sort();
let tierMissing = 0;
for (const k of moveIds) {
  const t = moves[k].tier;
  if (t === undefined) { bad(`招「${k}」没有 tier（决议 014 要求每招显式标）`); tierMissing++; }
  else if (TIERS.indexOf(t) < 0) { bad(`招「${k}」的 tier 非法: ${JSON.stringify(t)}`); tierMissing++; }
}
if (!TABLE_ONLY) console.log(`招表 ${moveIds.length} 招，tier 缺失/非法 ${tierMissing} 处`);

/* ── 2. 谁会用哪些招（从 defs 读，不硬编码名字）───────────────── */

const jobs = [];
for (const id in SJ.Enemies.defs) {
  const d = SJ.Enemies.defs[id];
  for (const mid of (d.moves || [])) jobs.push({ kind: 'mob', id: id, move: mid, phase: 1 });
}
for (const id in SJ.Bosses.defs) {
  const d = SJ.Bosses.defs[id];
  if (d.sets) {
    d.sets.forEach((set, i) => set.forEach(mid => jobs.push({ kind: 'boss', id: id, move: mid, phase: i + 1 })));
  }
  for (const mid of (d.moves || [])) jobs.push({ kind: 'boss', id: id, move: mid, phase: 1 });
}
// 师兄 P3 会现学玩家的招（决议 008 §1），以 moveId:'shuojian' 打出来。
// 这条路径走的还是同一张招表，招本身已在别处测过，这里只补一次「说剑」本体。
if (SJ.AI.moves.shuojian) jobs.push({ kind: 'boss', id: 'shixiong', move: 'shuojian', phase: 3 });

const results = [];
for (const j of jobs) {
  const r = trial(j.kind, j.id, j.move, j.phase);
  if (r) results.push(r);
}

/* ── 3. 逐条断言 ────────────────────────────────────────────── */

// heavy 的数据佐证：得是「站着挡不划算」的招，而不是随手标的。
// 全部从跑出来的 hitbox 上读，不认招名。
function heavyEvidence(hits, owner) {
  const why = [], byT = {};
  for (const h of hits) {
    const hb = h.hb;
    if (hb.guardBreak) why.push('破防');
    if (hb.launch) why.push('浮空');
    if (hb.weight === 'heavy') why.push('重击分级');
    if (hb.pierce && hb.w >= 150) why.push(`贯穿${hb.w | 0}px`);
    // 投射物（箭 / 气劲）的 ttl 是它的飞行寿命，不是「判定赖在原地不走」，不算证据
    const projectile = hb.follow && hb.follow !== owner;
    if (!projectile && hb.ttl > 0.20) why.push(`判定${hb.ttl.toFixed(2)}s>身法无敌0.20s`);
    const k = h.t.toFixed(3);
    byT[k] = (byT[k] || 0) + 1;
    if (byT[k] >= 3) why.push(`${byT[k]}道齐发`);
  }
  return [...new Set(why)];
}

const seen = {};
const audit = [];
for (const r of results) {
  const m = r.move, tier = m.tier, key = `${r.id}/${m.id}/P${r.phase}`;
  if (seen[key]) continue;
  seen[key] = 1;

  // 3a 每招真的登记了起手式，且 telegraph 上的 tier 与招表一致
  const own = r.tgs.filter(t => t.danger !== undefined);
  if (!own.length) {
    bad(`${key}：起手时没有登记任何 telegraph —— 这一招没有预警`);
  } else {
    for (const t of own) {
      if (TIERS.indexOf(t.tier) < 0) bad(`${key}：telegraph 的 tier 非法 ${JSON.stringify(t.tier)}`);
    }
    if (own[0].tier !== tier) bad(`${key}：telegraph.tier=${own[0].tier} 与招表 tier=${tier} 不一致`);
  }

  // 3b heavy 必须有数据佐证
  const why = heavyEvidence(r.hits, r.ownerRef);
  if (tier === 'heavy' && !why.length) {
    bad(`${key}：标了 heavy，但跑出来的 hitbox 里没有任何「不可挡」证据` +
        `（破防/浮空/重击/贯穿≥150px/判定>0.20s 都没有）`);
  }
  // 3c 破防招绝不能画成「可格挡的普通招」——朱砂是用来喊狼来了的，不能反过来骗人
  if (tier === 'light' && r.hits.some(h => h.hb.guardBreak)) {
    bad(`${key}：带 guardBreak 却标了 light`);
  }
  // 3d grab 必须真的位移（不是「看起来像突进」）
  if (tier === 'grab' && r.disp < 60) {
    bad(`${key}：标了 grab，但整招只位移了 ${r.disp.toFixed(0)}px（<60px）`);
  }
  if (tier !== 'grab' && r.disp >= 400 && m.danger !== false) {
    notes.push(`${key}：位移 ${r.disp | 0}px 却不是 grab（tier=${tier}）—— 确认是有意的`);
  }
  if (tier === 'light' && why.length) {
    notes.push(`${key}：标 light，但有 ${why.join('/')} —— 若是有意（可跳/可挡）就留着`);
  }

  // 3e 决议 018：夹紧之后，**最终**起手（含 windMul）必须 ≥ MIN_WIND。
  //     telegraph.dur 就是最终 wind，所以直接量它 —— 以后谁把第六回的 windMul
  //     调低，会在这里被接住，而不是在玩家手上。
  if (own.length && m.danger !== false && own[0].dur < MIN_WIND - 1e-6) {
    bad(`${key}：最终起手 ${own[0].dur.toFixed(3)}s < MIN_WIND ${MIN_WIND}s（决议 018 的夹紧没生效）`);
  }

  // 3f 公平性：telegraph 出现 → 第一次判定生效 ≥ 0.25s
  if (own.length && r.hits.length) {
    audit.push({
      key: key, name: m.name, tier: tier, wind: m.wind, windMul: r.windMul,
      win: r.hits[0].t - own[0].t, disp: r.disp | 0
    });
  } else if (own.length && !r.hits.length) {
    audit.push({ key: key, name: m.name, tier: tier, wind: m.wind, windMul: r.windMul, win: null, disp: r.disp | 0 });
  }
}

const MIN_REACT = 0.25;    // Lead 的规则
const DESIGN_MIN = 0.35;   // DESIGN §3.2 的起手式下限
for (const a of audit) {
  if (a.win === null) continue;                     // 无判定的招（召唤/位移/守势）
  if (a.win < MIN_REACT - 1e-6) {
    bad(`${a.key}「${a.name}」预警到判定只有 ${a.win.toFixed(3)}s < ${MIN_REACT}s`);
  } else if (a.win < DESIGN_MIN - 1e-6) {
    notes.push(`${a.key}「${a.name}」反应窗口 ${a.win.toFixed(3)}s：过了 0.25s 的线，但低于 DESIGN §3.2 的 0.35s`);
  }
}

/* ── 4. 阶段换势演出 ────────────────────────────────────────── */

const shiftRows = [];
for (const id in SJ.Bosses.defs) {
  const d = SJ.Bosses.defs[id];
  if (!d.phases || !d.phases.length) continue;
  arena();
  const e = SJ.Bosses.spawn(id, 900, FLOOR_Y, { facing: -1 });
  e.onDefeat = function () { };
  for (let i = 0; i < 20; i++) step();

  // 掉到阈值以下，让 tick 里的自动推进把他推进换势
  e.hp = Math.max(1, Math.floor(e.maxHp * d.phases[0]) - 1);
  e.mem.lastHurt = SJ.Game.time;                // 别让守阁人的「合十」把血养回阈值之上
  rec = { owner: e, tgs: [], hits: [] };
  let wait = 0;
  for (; wait < 600 && e.act !== 'shift'; wait++) step();
  if (e.act !== 'shift') { bad(`${id}：血量掉到 P2 阈值之下，10s 内没有进入换势`); rec = null; continue; }
  if (wait > 90) notes.push(`${id}：血量到阈值后过了 ${(wait * DT).toFixed(2)}s 才换势` +
    `（阶段推进要等 e.mv 为空的空档，他的招首尾相接）`);

  const hp0 = e.hp, phase0 = e.phase;

  // ai.js 的 hurt() 顶部那一行 shift 分支挡的是**硬直**这条路：伤害有 invuln 挡，
  // 但 Combat.stun 走的是 hurt(0,{parried:true})，不吃 invuln。没有那一行，
  // 一次硬直就能把换势掐掉。必须在换势**窗口里**测 —— 放到 while 之后测等于没测。
  SJ.Combat.stun(e, 0.9, SJ.player);
  if (e.act !== 'shift' || e.stunT > 0) {
    bad(`${id}：换势被一次 Combat.stun 掐掉了（act=${e.act} stunT=${e.stunT.toFixed(2)}）`);
  }
  let frames = 0, tgIn = 0, hitIn = 0, atk = 0;
  rec.tgs.length = 0; rec.hits.length = 0;
  let leak = 0;
  while (e.act === 'shift' && frames < 200) {
    // 换势期间狂砍：不许掉血，也不许「什么都没发生」
    SJ.Combat.hit({
      x: e.x - 4, y: e.y - 4, w: e.w + 8, h: e.h + 8, dmg: 40, team: 'player',
      owner: SJ.player, ttl: DT, knock: [0, 0], stun: 0.3, weight: 'mid',
      moveId: 'wufeng'          // 守阁人只认无锋（决议 008 §2），不带的话这条测试对他是空的
    });
    const hpF = e.hp;
    step(); frames++;
    // 收尾那一帧他已经从换势里出来了，那一下打中是应该的 —— 只查「还在换势时」掉的血
    if (e.act === 'shift' && e.hp !== hpF) leak += hpF - e.hp;
    tgIn += rec.tgs.length; rec.tgs.length = 0;
    hitIn += rec.hits.length; rec.hits.length = 0;
    if (e.mv) atk++;
  }
  const secs = frames * DT;
  if (leak) bad(`${id}：换势期间掉了血 ${leak} 点`);
  if (tgIn) bad(`${id}：换势期间创建了 ${tgIn} 个 telegraph（应当停手）`);
  if (hitIn || atk) bad(`${id}：换势期间还在出招（hitbox ${hitIn} / 帧 ${atk}）`);
  // 决议 019：换势用各 Boss 现有的 shiftSec（1.0–1.3s），不缩短
  const want = d.shiftSec || 1.0;
  if (Math.abs(secs - want) > DT * 1.5) bad(`${id}：换势时长 ${secs.toFixed(3)}s，应为 def.shiftSec=${want}s`);
  if (e.phase !== phase0) bad(`${id}：换势期间阶段又变了 ${phase0} → ${e.phase}`);

  // 0.6s 之后必须真的恢复：能出招、能挨打
  let back = 0;
  for (let i = 0; i < 300 && !back; i++) { step(); if (e.mv) back = 1; }
  if (!back) bad(`${id}：换势结束后 5s 内一招没出 —— 没有恢复`);
  const hpBefore = e.hp;
  SJ.Combat.hit({
    x: e.x - 4, y: e.y - 4, w: e.w + 8, h: e.h + 8, dmg: 7, team: 'player',
    owner: SJ.player, ttl: DT, knock: [0, 0], stun: 0.2, weight: 'mid',
    moveId: 'wufeng'
  });
  step();
  if (e.hp >= hpBefore) bad(`${id}：换势结束后仍然免疫伤害（hp ${hpBefore} → ${e.hp}）`);
  shiftRows.push(`  ${id.padEnd(11)} 等 ${(wait * DT).toFixed(2)}s · ${secs.toFixed(3)}s · 掉血 0 · telegraph 0 · 姿势 ${e.def.shiftPose || 'guard'} · 恢复 ✓`);
  rec = null;
}

/* ── 5. 瞬移守卫（rescueFoes 把敌人传送到玩家身边）───────────── */
{
  arena();
  const e = SJ.Enemies.spawn('lishi', 1200, FLOOR_Y, { facing: -1 });
  for (let i = 0; i < 20; i++) step();
  SJ.AI.start(e, SJ.AI.moves.k_zhuang);          // 冲锋中（hitbox 是 follow:e）
  for (let i = 0; i < 45; i++) step();
  const hbLive = () => SJ.Combat.hitList.filter(h => h.owner === e && !h.dead).length;
  if (!hbLive()) notes.push('瞬移守卫：冲撞跑到第 45 帧还没有判定，测点可能选偏了');
  // 模拟 level.js:151 的 rescueFoes：掉出世界 → 传送到玩家脚边
  e.x = SJ.player.x; e.y = SJ.player.y; e.vy = 0; e.onGround = true;
  step();
  if (e.mv) bad('瞬移守卫：被传送到玩家身边之后，冲撞还在跑（招没有作废）');
  if (hbLive()) bad('瞬移守卫：被传送之后，冲撞的 hitbox 还活着 —— 会贴脸打中玩家');
  if (SJ.Combat.tgList.some(t => t.owner === e && !t.dead)) bad('瞬移守卫：传送后起手式残留');

  // 硬直中被传送：招要清，但 act 不许被改回 idle
  // （同理适用于倒地的 Boss —— 他站起来，生杀抉择就毁了）
  arena();
  const h = SJ.Enemies.spawn('lishi', 1200, FLOOR_Y, { facing: -1 });
  for (let i = 0; i < 20; i++) step();
  h.hurt(3, SJ.player, { stun: 0.5, knock: [80, -30] });
  step();
  if (h.act !== 'stun') notes.push('瞬移守卫：没能把力士打进硬直，这条测点选偏了');
  h.x = SJ.player.x; h.y = SJ.player.y; h.vy = 0;
  step();
  if (h.act !== 'stun') bad(`瞬移守卫：硬直中被传送后 act 被改成了 ${h.act}（应保持 stun）`);

  // 反面：自己的瞬移（孤影/闪）不许被守卫误伤
  arena();
  const c = SJ.Enemies.spawn('cike', 1200, FLOOR_Y, { facing: -1 });
  for (let i = 0; i < 20; i++) step();
  SJ.AI.start(c, SJ.AI.moves.k_shan);
  step();
  if (!c.mv) bad('瞬移守卫：把刺客自己的「闪」也当成外部传送给作废了');
}

/* ── 6. 受击 / 死亡表现分层 ─────────────────────────────────── */
{
  const massOf = {};
  for (const id in SJ.Enemies.defs) massOf[id] = SJ.Enemies.defs[id].mass;
  for (const id in SJ.Bosses.defs) massOf[id] = SJ.Bosses.defs[id].mass;
  for (const id in massOf) {
    if (['light', 'mid', 'heavy'].indexOf(massOf[id]) < 0) bad(`${id}：mass 缺失或非法（${massOf[id]}）`);
  }
  // 受击姿势：三种体重必须给出三种不同的姿势名
  const poses = {};
  for (const mass of ['light', 'mid', 'heavy']) {
    arena();
    const src = { id: 'daoke', cx: () => 0, cy: () => 0 };
    const e = SJ.Enemies.spawn('daoke', 900, FLOOR_Y, { facing: -1 });
    for (let i = 0; i < 20; i++) step();
    e.mass = mass;
    e.hurt(3, SJ.player, { stun: 0.4, knock: [100, -40] });
    step();
    poses[mass] = e.figOpts.poseName;
    // 中量级后半段才架回来，多跑几帧取「后段」的姿势
    for (let i = 0; i < 14; i++) step();
    poses[mass + '_late'] = e.figOpts.poseName;
  }
  const set = new Set([poses.light, poses.mid, poses.mid_late, poses.heavy]);
  if (set.size < 3) bad(`受击姿势没有分层：${JSON.stringify(poses)}`);

  // 死姿至少两种（杂兵），Boss 必须停在 down（倒地未死，等生杀）
  const seenPose = new Set();
  for (let i = 0; i < 40; i++) {
    arena();
    const e = SJ.Enemies.spawn('daoke', 900, FLOOR_Y, { facing: -1 });
    for (let k = 0; k < 20; k++) step();
    e.hurt(999, SJ.player, {});
    for (let k = 0; k < 32; k++) step();          // 越过 0.45s
    if (e.figOpts) seenPose.add(e.figOpts.poseName);
  }
  if (seenPose.size < 2) bad(`杂兵死姿只有 ${seenPose.size} 种：${[...seenPose].join(',')}`);

  arena();
  const b = SJ.Bosses.spawn('yuzhongdao', 900, FLOOR_Y, { facing: -1 });
  b.onDefeat = function () { };
  for (let k = 0; k < 20; k++) step();
  b.hurt(9999, SJ.player, {});
  for (let k = 0; k < 60; k++) step();
  if (b.figOpts.poseName !== 'down') {
    bad(`Boss 倒地未死应停在 down（撑手抬头，生杀就看这一下），实际 ${b.figOpts.poseName}`);
  }
  if (!TABLE_ONLY) {
    console.log(`受击姿势   : 轻 ${poses.light} / 中 ${poses.mid}→${poses.mid_late} / 重 ${poses.heavy}`);
    console.log(`杂兵死姿   : ${[...seenPose].join(' / ')}   Boss: down（倒地未死）`);
  }
}

/* ── 6b. 纸上墨重（Lead 拍板方案 B）──────────────────────────────
 * figure.js 在 g.scale(scale) 之后按 w*lineScale 落笔，所以纸上的实际墨重
 * = scale × lineScale。低于 1.0 太多，小个子的手臂在游戏内尺寸下细得像发丝。
 * 刻意加重的（力士 / 僧人 / 守阁人）允许高于 1.0，这里只钉下限。 */
{
  const INK_MIN = 0.99;
  const all = Object.assign({}, SJ.Enemies.defs, SJ.Bosses.defs);
  const rows = [];
  for (const id in all) {
    const d = all[id], ink = (d.scale || 0.86) * (d.lineScale || 1);
    rows.push(`${id}=${ink.toFixed(2)}`);
    if (ink < INK_MIN - 1e-6) {
      bad(`${id}：纸上墨重 ${ink.toFixed(2)} < ${INK_MIN}（scale ${d.scale} × lineScale ${d.lineScale || 1}）` +
          ` —— 方案 B 要求抬到 1.0，见 notes-T3 §6`);
    }
  }
  if (!TABLE_ONLY) console.log(`纸上墨重   : ${rows.join(' ')}`);
}

/* ── 7. 姿势名只准用现有的（figure.js 是 T2 的文件，我只引用）───── */
{
  const P = (SJ.Figure && SJ.Figure.poses) || {};
  const used = {};
  const use = (name, where) => { if (name) (used[name] = used[name] || []).push(where); };
  for (const k of moveIds) {
    const m = moves[k];
    use(m.poseW, `${k}.poseW`); use(m.poseA, `${k}.poseA`); use(m.poseR, `${k}.poseR`);
  }
  const allDefs = Object.assign({}, SJ.Enemies.defs, SJ.Bosses.defs);
  for (const id in allDefs) {
    use(allDefs[id].shiftPose, `${id}.shiftPose`);
    use(allDefs[id].guardPose, `${id}.guardPose`);
  }
  // ai.js 的 poseSpec 里写死的那几个（受击分层 / 死姿 / 兜底）
  ['idle', 'walk', 'run', 'jump', 'fall', 'guard', 'hurt', 'crouch', 'down', 'dead', 'sit',
   'atk1_wind', 'atk1_hit', 'atk1_rec'].forEach(n => use(n, 'ai.js/poseSpec'));
  let miss = 0;
  for (const n in used) {
    if (typeof P[n] !== 'function') { bad(`姿势名不存在: ${n}（来自 ${used[n].join(', ')}）`); miss++; }
  }
  if (!TABLE_ONLY) console.log(`姿势引用   : ${Object.keys(used).length} 个名字，缺失 ${miss} 个`);
}

/* ── 输出 ───────────────────────────────────────────────────── */

audit.sort((a, b) => (a.win === null ? 9 : a.win) - (b.win === null ? 9 : b.win));
console.log('\n【公平性审计】预警出现 → 判定生效（越靠前越危险；规则 ≥0.25s，DESIGN §3.2 ≥0.35s）');
console.log('  反应窗口  tier   基础wind×倍率      位移   招');
for (const a of audit) {
  const w = a.win === null ? '   —   ' : (a.win.toFixed(3) + 's');
  const mark = a.win === null ? ' ' : a.win < MIN_REACT ? '✗' : a.win < DESIGN_MIN ? '!' : ' ';
  console.log(`${mark} ${w.padStart(8)}  ${(a.tier || '?').padEnd(5)}  ` +
    `${String(a.wind === undefined ? '-' : a.wind).padStart(4)}×${a.windMul.toFixed(2)}  ` +
    `${String(a.disp).padStart(5)}px  ${a.key}「${a.name}」`);
}

if (shiftRows.length) {
  console.log('\n【阶段换势】期间掉血 / telegraph 必须为 0，之后必须恢复');
  shiftRows.forEach(r => console.log(r));
}

if (notes.length) {
  console.log('\n【提示】（不算失败，人来判断是不是有意的）');
  notes.forEach(n => console.log('  · ' + n));
}

console.log(errors.length ? '\n✗ 失败：\n  ' + errors.join('\n  ') : '\n✓ 全部通过');
process.exit(errors.length ? 1 : 0);
