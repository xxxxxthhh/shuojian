#!/usr/bin/env node
/* dev/respawn-audit.js  【T1】死亡复活审计
 *
 *   node dev/respawn-audit.js [关卡号]
 *
 * 两段：
 *   A 静态 —— 每一关每一个检查点：复活点是不是站得住、有没有埋在墙里、
 *              有没有落在水/火里、有没有落在还没打开的 blocker 之后。
 *   B 动态 —— 每一关每一波：让机器人打到那一波，然后**当场把玩家打死**，
 *              点掉死亡界面，检查复活之后：波次/门/敌人是否一致地重置、
 *              人在哪儿、还走不走得动（真的再跑 3 秒看位移）。
 *
 * 为什么要动态那一半：静态只能证明「这个坐标合法」，证明不了
 * 「死一次之后这一关还能继续玩」。第二回那类软锁全出在后者。
 */
'use strict';
const { boot } = require('./harness.js');
const AP = require('./autoplay.js');

const ONLY = process.argv[2] !== undefined ? Number(process.argv[2]) : null;
const errs = [], warns = [];
const E = m => { errs.push(m); console.log('✗ ' + m); };
const W = m => { warns.push(m); console.log('⚠ ' + m); };

function hits(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function box(p) { return { x: p.x, y: p.y, w: p.w, h: p.h }; }

/* ── A 静态：每个检查点 ───────────────────────────────────────────── */
function staticAudit(H, idx) {
  const def = H.SJ.Levels[idx];
  const P = `[${idx} ${def.id}]`;
  for (let i = 0; i < def.checkpoints.length; i++) {
    H.SJ.Save.data.flags.cp = i;
    H.load(idx, true);
    const p = H.player(), cp = def.checkpoints[i];
    const b = box(p);

    const stuck = H.SJ.World.solids.filter(s => !s.gone && !s.oneway && hits(b, s));
    if (stuck.length) E(`${P} 检查点#${i} @${cp} 复活点埋在实心块里：${JSON.stringify(stuck.map(s => [s.x, s.y, s.w, s.h]))}`);

    const gy = H.SJ.World.groundAt(p.cx(), p.y + p.h - 4);
    if (gy === null) E(`${P} 检查点#${i} @${cp} 脚下没有地面（会一直往下掉）`);
    else if (Math.abs(gy - (p.y + p.h)) > 6) W(`${P} 检查点#${i} @${cp} 复活点离地 ${(gy - (p.y + p.h)).toFixed(0)}px（会掉一下）`);

    for (const h of def.hazards) {
      if (!hits(b, h)) continue;
      if (h.kind === 'water') E(`${P} 检查点#${i} @${cp} 复活点在水里 —— 复活即落水，无限循环`);
      else if (h.kind === 'fire') W(`${P} 检查点#${i} @${cp} 复活点在火区里（起火后复活会立刻被烧）`);
    }

    for (const bl of (def.blockers || [])) {
      if (cp[0] > bl.x) W(`${P} 检查点#${i} @${cp} 落在 blocker "${bl.flag}"@${bl.x} 之后 —— 若该 flag 未设，复活后会被推回门前`);
    }
    if (cp[0] < 0 || cp[0] > def.w) E(`${P} 检查点#${i} @${cp} 出界`);
  }
}

/* ── B 动态：每一波死一次 ─────────────────────────────────────────── */
function dynamicAudit(idx, waveId, maxSec) {
  const H = boot({ seed: 21, render: false });
  H.reset();
  H.load(idx);
  const bot = new AP.Bot(H, { kill: false });
  const def = H.SJ.Levels[idx];
  const P = `[${idx} ${def.id}] wave${waveId}`;

  // 1 打到这一波正在进行
  let f = 0, reached = false;
  for (; f < maxSec * 60; f++) {
    H.hold(bot.tick()); H.step();
    if (H.SJ.Level.current !== idx || H.where() === 'ending') break;
    if (H.dbg().activeWave === waveId) { reached = true; break; }
  }
  if (!reached) { W(`${P} 机器人没能把这一波打出来（${(f / 60) | 0}s 内），本波跳过`); return; }

  const before = H.dbg();
  const cpIdx = H.SJ.Save.data.flags.cp | 0;

  // 2 当场打死（forced 绕过无敌帧）
  const p = H.player();
  const corpse = p;                       // 记住尸体：重载会造一个新的 SJ.player
  p.hurt(9999, null, { forced: true });
  for (let i = 0; i < 600 && H.where() === 'level'; i++) { H.hold({}); H.step(); }
  if (H.where() !== 'overlay') { E(`${P} 玩家死了却没有进入死亡界面（where=${H.where()}）`); return; }

  /* 3 点掉死亡界面。
   * ★ 不能只等 where()==='level'：gameoverScene 是先 Game.pop() 再
   *   Level.restartFromCheckpoint()，中间有**一帧**栈已经回到关卡层、
   *   但重载还没发生 —— 那一帧上的玩家还是尸体、gate 还锁着、旧敌人还在。
   *   在那一帧取样，下面所有断言查的都是重生**之前**的状态，全是假绿。
   *   真正的信号是 SJ.player 换了一个对象（Level.load → Player.create）。 */
  let ok = false;
  for (let i = 0; i < 900; i++) {
    H.hold(i % 6 === 0 ? { confirm: 1 } : {});
    H.step();
    if (H.where() === 'level' && H.player() && H.player() !== corpse) { ok = true; break; }
  }
  if (!ok) { E(`${P} 死亡界面点不掉 / 检查点没有重载（where=${H.where()}）`); return; }
  H.levelScene = H.SJ.Game.stack[0];

  // 4 复活后的一致性
  const q = H.player(), d = H.dbg(), b = box(q);
  const spawnAt = [q.x | 0, q.y | 0];        // 快照：q 是活引用，跑完之后再读就是终点了
  if (!q || q.hp <= 0) { E(`${P} 复活后 hp=${q ? q.hp : '?'}`); return; }
  // 决议 022：死亡复活满血。原来 Player.create 读的是「上一关通关时存下的 hp」，
  // 残血通关会把后面整局锁死在那个血量上，而游戏没有任何回血手段。
  if (q.hp !== q.maxHp) E(`${P} 决议 022：复活后 hp=${q.hp}，不是满血 ${q.maxHp}`);
  const stuck = H.SJ.World.solids.filter(s => !s.gone && !s.oneway && hits(b, s));
  if (stuck.length) E(`${P} 复活点埋在实心块里 x=${q.x | 0} y=${q.y | 0}`);
  for (const h of def.hazards) {
    if (h.kind === 'water' && hits(b, h)) E(`${P} 复活在水里 x=${q.x | 0}`);
  }
  if (d.gate) E(`${P} 复活后 gate 还锁着 ${JSON.stringify(d.gate)} —— 门不会自己开`);
  if (d.activeWave !== null) E(`${P} 复活后还挂着 activeWave=${d.activeWave}`);
  if (H.foes().length) E(`${P} 复活后场上还留着 ${H.foes().length} 个旧敌人`);
  if (d.busy) E(`${P} 复活后 busy 还是 true —— 关卡逻辑不会推进`);
  if ((H.SJ.Save.data.flags.cp | 0) !== cpIdx) W(`${P} 复活后检查点序号从 ${cpIdx} 变成 ${H.SJ.Save.data.flags.cp | 0}`);

  // blocker 开着的不能被复活关回去
  for (let i = 0; i < (before.blockers || []).length; i++) {
    if (before.blockers[i].open && !d.blockers[i].open)
      E(`${P} 复活后 blocker "${d.blockers[i].flag}" 又关上了 —— 玩家会被关在自己已经打开过的门后面`);
  }

  /* 5 「死一次之后这一关还能不能玩完」—— 这才是真问题。
   *   位移 ≥ 20px 只能证明没当场卡死，证明不了后面走得通：
   *   例如第五回若检查点在 fireStart 之后，复活时 R.fireT 回到 -1，火再也不会起，
   *   挂在 when:'burn' 上的东西就永远触发不了。只有真跑到通关才看得出来。 */
  const x0 = q.x;
  let moved = 0, done = false, f2 = 0;
  for (; f2 < 600 * 60; f2++) {
    H.hold(bot.tick()); H.step();
    if (H.player()) moved = Math.max(moved, Math.abs(H.player().x - x0));
    if (H.SJ.Level.current !== idx || H.where() === 'ending') { done = true; break; }
  }
  if (!done) {
    E(`${P} 复活后跑不完这一关（${(f2 / 60) | 0}s 超时，x=${H.player() ? H.player().x | 0 : '?'}）：${AP.classify(H, bot)}`);
    return;
  }
  console.log(`  ✓ ${P} 复活后能跑完：复活点 ${spawnAt[0]},${spawnAt[1]} (cp#${cpIdx} @${def.checkpoints[cpIdx]})，再用 ${(f2 / 60).toFixed(0)}s 通关`);
}

/* ── 跑 ──────────────────────────────────────────────────────────── */
const H0 = boot({ seed: 21, render: false });
const N = H0.SJ.Levels.length;
console.log('── A 静态：检查点复活点 ───────────────────────────────');
for (let i = 0; i < N; i++) {
  if (ONLY !== null && i !== ONLY) continue;
  H0.reset();
  staticAudit(H0, i);
}
console.log('  （无输出 = 全部合格）');

console.log('\n── B 动态：每一波死一次 ───────────────────────────────');
for (let i = 0; i < N; i++) {
  if (ONLY !== null && i !== ONLY) continue;
  const waves = H0.SJ.Levels[i].waves || [];
  if (!waves.length) { console.log(`  [${i} ${H0.SJ.Levels[i].id}] 无战斗波次，跳过`); continue; }
  for (const w of waves) dynamicAudit(i, w.id, 420);
}

console.log(`\n复活审计：${errs.length} 个错误 / ${warns.length} 个提醒`);
process.exit(errs.length ? 1 : 0);
