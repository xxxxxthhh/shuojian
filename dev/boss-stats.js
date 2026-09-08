#!/usr/bin/env node
/* dev/boss-stats.js  【T1】Boss 公平性实测数据（交给 T3）
 *
 *   node dev/boss-stats.js [关卡号]
 *
 * 量三件事，都在真沙盒里由机器人打出来：
 *   1. **反应窗口** —— 每一招起手式的 dur。REVIEW §2 第 11 条要求 ≥0.25s；
 *      这里按 moveId 统计次数与 dur（起手式在观势时游戏时间走 0.35×，
 *      所以对玩家而言真实窗口更长，表里给的是游戏内秒数，是下界）。
 *   2. **格挡 / 挨打** —— 机器人打完一场的完美观势次数与被打中次数。
 *   3. **耗时与死亡** —— 从 Boss 出场到倒地。
 * 这不是「Boss 该不该这么难」的结论，只是数字；难度是 T3/Lead 的判断。
 */
'use strict';
const { boot } = require('./harness.js');
const AP = require('./autoplay.js');

const ONLY = process.argv[2] !== undefined ? Number(process.argv[2]) : null;

function run(idx, seed) {
  const H = boot({ seed, render: false });
  H.reset();
  const def = H.SJ.Levels[idx];
  if (!def.boss) return null;
  H.SJ.Save.data.flags.cp = def.checkpoints.length - 1;   // 直接从最后一个检查点起，尽量少打杂兵
  H.load(idx, true);

  // 记录每一条起手式
  const tele = {};
  const realTg = H.SJ.Combat.telegraph;
  H.SJ.Combat.telegraph = function (o) {
    const tg = realTg.call(this, o);
    const id = (o && o.moveId) || '(无 moveId)';
    const k = id + (o && o.danger === false ? ' [守势]' : '');
    (tele[k] || (tele[k] = { n: 0, dur: o && o.dur, tier: o && o.tier })).n++;
    return tg;
  };

  const bot = new AP.Bot(H, { kill: false });
  let par = 0, hit = 0, dmg = 0, lastGlow = 0, lastHp = H.player().hp;
  let bossSeen = -1, bossDown = -1, f = 0;
  for (; f < 900 * 60; f++) {
    H.hold(bot.tick()); H.step();
    const p = H.player();
    if (p) {
      if (p.parryGlow > lastGlow + 0.1) par++;
      lastGlow = p.parryGlow;
      if (p.hp < lastHp) { hit++; dmg += lastHp - p.hp; }
      lastHp = p.hp;
    }
    const d = H.dbg();
    if (d.boss && bossSeen < 0) bossSeen = f;
    if (d.bossDown && bossDown < 0) bossDown = f;
    if (H.SJ.Level.current !== idx || H.where() === 'ending') break;
  }
  return {
    id: def.boss, lv: def.id, tele,
    par, hit, dmg, deaths: H.SJ.Save.data.deaths | 0,
    bossSec: bossDown > 0 && bossSeen >= 0 ? (bossDown - bossSeen) / 60 : null,
    totalSec: f / 60, cleared: H.SJ.Level.current !== idx || H.where() === 'ending'
  };
}

const H0 = boot({ seed: 1, render: false });
console.log('关 | Boss | 通关 | Boss 战秒数 | 完美观势 | 挨打(次/伤) | 死');
const rows = [];
for (let i = 0; i < H0.SJ.Levels.length; i++) {
  if (ONLY !== null && i !== ONLY) continue;
  if (!H0.SJ.Levels[i].boss) continue;
  const r = run(i, 7);
  if (!r) continue;
  rows.push(r);
  console.log(`${r.lv} | ${r.id} | ${r.cleared ? '✓' : '✗'} | ${r.bossSec === null ? '—' : r.bossSec.toFixed(0) + 's'} | ${r.par} | ${r.hit} 次 / ${r.dmg} 伤 | ${r.deaths}`);
}
console.log('\n── 起手式反应窗口（dur，游戏内秒；REVIEW §2.11 的门槛是 0.25s）──');
for (const r of rows) {
  const bad = [];
  const keys = Object.keys(r.tele).sort();
  console.log(`  [${r.lv} ${r.id}]`);
  for (const k of keys) {
    const t = r.tele[k];
    const flag = (t.dur !== undefined && t.dur < 0.25) ? '  ← 短于 0.25s' : '';
    if (flag) bad.push(k);
    console.log(`    ${k.padEnd(22)} dur=${t.dur === undefined ? '?' : t.dur.toFixed(2)}s  出现 ${t.n} 次${t.tier ? '  tier=' + t.tier : ''}${flag}`);
  }
  if (bad.length) console.log(`    ⚠ ${bad.length} 招的窗口短于 0.25s：${bad.join(' ')}`);
}
