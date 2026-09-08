/* dev/jumpcal.js  【T1】跳跃/风/上升气流包络实测标定
 *
 * 规划器不能用「DESIGN 写的 114px」这种纸上数字：真实值受 update 顺序、
 * 一帧扣一次重力、buffered/consume、ENV_DRAG 影响。这里在真沙盒里量，
 * 量完顺手拿同一套常量跑一遍 dev/nav.js 的迷你物理模型做交叉校验 ——
 * 两者对不上就说明模型错了，规划器一定会在某一关翻车。
 *
 * 用法：node dev/jumpcal.js
 */
'use strict';
const { boot } = require('./harness.js');
const nav = require('./nav.js');

function fresh(level) {
  const H = boot({ seed: 7, render: false });
  H.reset();
  H.load(level === undefined ? 0 : level);
  for (let i = 0; i < 900 && H.where() !== 'level'; i++) {   // 点掉开场白
    H.hold(i % 6 === 0 ? { confirm: 1 } : {});
    H.step();
  }
  return H;
}

// 对白层会把关卡 update 整个停住 —— 标定时遇到就点掉，否则量出来的全是 0
function stepClear(H, want) {
  if (H.where() === 'overlay') { H.hold(H.frame % 6 === 0 ? { confirm: 1 } : {}); H.step(); return false; }
  H.hold(want); H.step(); return true;
}

// 把玩家挪到一段干净的平地上，跑到满速，然后按参数起跳
function measure(H, opt) {
  const p = H.player();
  p.x = opt.x0; p.y = opt.y0; p.vx = 0; p.vy = 0;
  p.envVx = 0; p.envVy = 0;
  const dir = opt.dir === undefined ? 1 : opt.dir;
  const runKey = dir > 0 ? 'right' : 'left';

  // 助跑到稳态
  for (let i = 0; i < (opt.runFrames === undefined ? 60 : opt.runFrames); i++) {
    if (!stepClear(H, opt.run === false ? {} : { [runKey]: 1 })) i--;
  }
  const x0 = p.x, y0 = p.y, vx0 = p.vx;
  let minY = p.y, f = 0, dbl = false;
  const HOLD = opt.holdJump === undefined ? 14 : opt.holdJump;
  let dblStart = -1;
  for (f = 0; f < 240; f++) {
    const want = {};
    if (opt.run !== false) want[runKey] = 1;
    // 与 dev/nav.js simJump 完全同一套按键策略：按住 HOLD 帧 → 松开 → 刚过顶点再按住 HOLD 帧
    if (f < HOLD) want.jump = 1;
    else if (opt.doubleJump && !dbl && p.vy > -40) { want.jump = 1; dbl = true; dblStart = f; }
    else if (opt.doubleJump && dbl && f < dblStart + HOLD) want.jump = 1;
    if (!stepClear(H, want)) { f--; continue; }
    if (p.y < minY) minY = p.y;
    if (f > 4 && p.onGround) break;
  }
  return { rise: y0 - minY, run: Math.abs(p.x - x0), frames: f, vx0, landY: p.y };
}

const out = {};
console.log('── 实测（真沙盒，level 0 平地 y=470）─────────────────');
{
  const H = fresh(0);
  let m = measure(H, { x0: 200, y0: 470 - 52 });
  out.jumpRise = m.rise; out.jumpRun = m.run; out.jumpFrames = m.frames;
  console.log(`满跳（助跑满速）  : 高 ${m.rise.toFixed(1)}px  远 ${m.run.toFixed(1)}px  滞空 ${m.frames}f  起跳vx=${m.vx0.toFixed(0)}`);

  m = measure(H, { x0: 200, y0: 470 - 52, run: false, runFrames: 10 });
  out.jumpRiseStill = m.rise;
  console.log(`满跳（原地）      : 高 ${m.rise.toFixed(1)}px  远 ${m.run.toFixed(1)}px  滞空 ${m.frames}f`);

  m = measure(H, { x0: 200, y0: 470 - 52, doubleJump: true });
  out.dblRise = m.rise; out.dblRun = m.run;
  console.log(`二段跳（助跑满速）: 高 ${m.rise.toFixed(1)}px  远 ${m.run.toFixed(1)}px  滞空 ${m.frames}f`);

  m = measure(H, { x0: 200, y0: 470 - 52, doubleJump: true, run: false, runFrames: 10 });
  out.dblRiseStill = m.rise;
  console.log(`二段跳（原地）    : 高 ${m.rise.toFixed(1)}px  远 ${m.run.toFixed(1)}px`);
}

// ── 第四回顶风（env.windAx = -600，ENV_DRAG = 5 → 稳态 -120px/s）──
{
  const H = fresh(4);
  const p = H.player();
  const def = H.SJ.Level.def;
  console.log(`\n第四回 env = ${JSON.stringify(def.env)}`);
  // 找一段够长的平地
  const flat = H.SJ.World.solids.filter(s => !s.oneway && s.w > 400).sort((a, b) => b.w - a.w)[0];
  const y0 = flat.y - 52, x0 = flat.x + 60;
  let m = measure(H, { x0, y0, dir: 1 });
  out.windRunRight = m.run; out.windRiseRight = m.rise;
  console.log(`顶风向右满跳      : 高 ${m.rise.toFixed(1)}px  远 ${m.run.toFixed(1)}px  (稳态风速 ${(def.env.windAx / 5).toFixed(0)}px/s)`);
  m = measure(H, { x0: x0 + 300, y0, dir: -1 });
  console.log(`顺风向左满跳      : 高 ${m.rise.toFixed(1)}px  远 ${m.run.toFixed(1)}px`);
  // 顶风平地推进速度
  p.x = x0; p.y = y0; p.vx = 0; p.envVx = 0;
  for (let i = 0; i < 200; i++) stepClear(H, { right: 1 });
  out.windWalkVx = p.vx + (p.envVx || 0);
  console.log(`顶风走路稳态      : p.vx=${p.vx.toFixed(1)}  envVx=${(p.envVx || 0).toFixed(1)}  合成≈${(p.vx + (p.envVx || 0)).toFixed(1)}px/s`);
}

// ── 上升气流 ──────────────────────────────────────────────────
{
  const H = fresh(4);
  const p = H.player();
  const up = H.SJ.Level.def.hazards.filter(h => h.kind === 'updraft')[0];
  if (up) {
    // 先把对白清干净，再放进气流井底
    for (let i = 0; i < 400 && H.where() !== 'level'; i++) stepClear(H, {});
    const y0 = up.y + up.h - 60;
    p.x = up.x + up.w / 2 - 13; p.y = y0; p.vx = 0; p.vy = 0; p.envVy = 0;
    let top = p.y;
    for (let i = 0; i < 300; i++) { stepClear(H, {}); if (p.y < top) top = p.y; }
    out.updraftRise = y0 - top;
    console.log(`\n上升气流 @${up.x},${up.y} ${up.w}x${up.h} vy=${up.vy}: 静止不动可被托升 ${out.updraftRise.toFixed(0)}px（气流顶 y=${up.y}）`);
  }
}

// ── 交叉校验：迷你物理模型 vs 实测 ────────────────────────────
console.log('\n── 迷你物理模型（dev/nav.js）交叉校验 ───────────────');
const sim = nav.jumpArc({ vx: 240, dir: 1, dbl: false });
const sim2 = nav.jumpArc({ vx: 240, dir: 1, dbl: true });
function cmp(name, a, b) {
  const d = Math.abs(a - b), ok = d <= Math.max(6, b * 0.06);
  console.log(`${ok ? '✓' : '✗'} ${name}: 模型 ${a.toFixed(1)} vs 实测 ${b.toFixed(1)}  (差 ${d.toFixed(1)})`);
  return ok;
}
let ok = true;
ok = cmp('满跳高', sim.rise, out.jumpRise) && ok;
ok = cmp('满跳远', sim.run, out.jumpRun) && ok;
ok = cmp('二段跳高', sim2.rise, out.dblRise) && ok;
ok = cmp('二段跳远', sim2.run, out.dblRun) && ok;
console.log(ok ? '\n✓ 模型与实测一致，规划器可用' : '\n✗ 模型与实测不符，规划器会翻车');
process.exit(ok ? 0 : 1);
