#!/usr/bin/env node
/* dev/scenery-fallback.js  【T1】决议 015 的退路验证
 *
 * 契约要求：「若 SJ.Scenery 不存在或 draw 抛错，level.js 必须退回旧 switch，
 * 游戏不许因为呈现层挂掉」。「不存在」很容易验，**抛错**那一路才是真正会出事的那条 ——
 * 而它平时永远不会被执行，所以只能故意制造一次。
 *
 *   node dev/scenery-fallback.js
 */
'use strict';
const { boot } = require('./harness.js');

let fail = 0;
function ok(c, m) { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fail++; }

// ① SJ.Scenery 存在且正常
{
  const H = boot({ seed: 1, render: true });
  H.reset(); H.load(1);
  ok(!!H.SJ.Scenery, 'SJ.Scenery 已挂载（T4 的 src/render/scenery.js 在 index.html 里）');
  let threw = null;
  try { for (let i = 0; i < 30; i++) { H.hold({}); H.step(); } } catch (e) { threw = e; }
  ok(!threw, '正常路径跑 30 帧不抛异常' + (threw ? '：' + threw.message : ''));
}

// ② SJ.Scenery.draw 抛错 → 必须退回旧 switch，且只警告一次
{
  const H = boot({ seed: 1, render: true });
  H.reset(); H.load(1);
  for (let i = 0; i < 600 && H.where() !== 'level'; i++) {   // 先点掉开场白，否则玩家本来就不会动
    H.hold(i % 6 === 0 ? { confirm: 1 } : {}); H.step();
  }
  const x0 = H.player().x;
  const warns = [];
  const realWarn = console.warn;
  console.warn = m => warns.push(String(m));
  let calls = 0;
  H.SJ.Scenery.draw = function () { calls++; throw new Error('故意炸的'); };
  let threw = null;
  try { for (let i = 0; i < 60; i++) { H.hold({ right: 1 }); H.step(); } } catch (e) { threw = e; }
  console.warn = realWarn;
  ok(!threw, 'Scenery.draw 抛错时游戏不崩' + (threw ? '：' + threw.message : ''));
  ok(calls === 1, `抛错后不再重试（实际调用 ${calls} 次，应为 1）`);
  ok(warns.filter(w => /Scenery/.test(w)).length === 1,
     `控制台只警告一次（实际 ${warns.filter(w => /Scenery/.test(w)).length} 次）`);
  ok(H.player().x > x0 + 40, `退回旧远景后关卡照常推进（玩家从 ${x0|0} 走到 ${H.player().x|0}）`);
}

// ③ 完全没有 SJ.Scenery
{
  const H = boot({ seed: 1, render: true });
  H.reset(); H.load(1);
  delete H.SJ.Scenery;
  let threw = null;
  try { for (let i = 0; i < 30; i++) { H.hold({ right: 1 }); H.step(); } } catch (e) { threw = e; }
  ok(!threw, 'SJ.Scenery 不存在时走旧 switch，不抛异常' + (threw ? '：' + threw.message : ''));
}

console.log(fail ? `\n✗ ${fail} 项失败` : '\n全部通过。');
process.exit(fail ? 1 : 0);
