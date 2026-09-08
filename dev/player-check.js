// 【E】玩家 / 战斗 / 招式 的无浏览器回归自检。
//   node dev/player-check.js       退出码 0 = 全过
//
// MCP 标签页经常是 document.hidden（rAF 不跑）或扩展掉线，截图与页内脚本都不可靠。
// 这份用 Node 直接加载真模块 + 最小 DOM 垫片，逐帧推进，把关键不变量钉死。
// 渲染相关（Ink/Figure/FX）打桩，只验逻辑与数值。

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ── 最小 DOM 垫片 ────────────────────────────────────────────
// STORE 提到外面：§12 要在**另一个 vm 沙盒**里读同一份 localStorage，
// 才算真的验过「存了 → 换个进程状态 → 还在」。
const STORE = {};
function mkStore(m) {
  return { getItem: k => (k in m ? m[k] : null),
           setItem: (k, v) => { m[k] = String(v); },
           removeItem: k => { delete m[k]; } };
}
const listeners = {};
const win = {
  addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
  removeEventListener: () => {},
  devicePixelRatio: 1, innerWidth: 960, innerHeight: 540,
  requestAnimationFrame: () => 0,
  localStorage: mkStore(STORE)
};
win.window = win;
const doc = { addEventListener: () => {}, hidden: false };
// 注意：**不要**把宿主的 Object / Array / String / Number / Boolean 注进来。
// 注进来会遮蔽沙盒自己的内置构造器，而沙盒里 `[]` 字面量造出来的仍然是沙盒的
// Array，于是 figure.js 的 `va instanceof Array`（Figure.blend / Figure.joints）
// 恒为 false —— 不抛异常，只是静默返回残缺的对象。又一个「传错不报错」。
const ctx = vm.createContext(Object.assign(win, {
  window: win, document: doc, console, Math, Date, JSON,
  isNaN, parseInt, parseFloat, performance: { now: () => Date.now() },
  localStorage: win.localStorage, requestAnimationFrame: () => 0
}));

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
}

['src/core/const.js', 'src/core/input.js', 'src/core/camera.js', 'src/core/world.js',
 'src/core/ent.js', 'src/core/save.js', 'src/core/game.js'].forEach(load);

const SJ = ctx.window.SJ;

// ── 渲染/音频打桩（本文件只验逻辑）────────────────────────────
const noop = () => {};
// Ink 仍然打桩，但把 stroke / blob 的参数记下来：
// §11 要验预警分层到底画了几笔、什么颜色、多粗、有没有那个实心「势」点。
const inkCalls = { stroke: [], blob: [] };
SJ.Ink = new Proxy({
  stroke: (g, pts, o) => { inkCalls.stroke.push(o || {}); },
  blob: (g, x, y, r, seed, o) => { inkCalls.blob.push({ x, y, r, o: o || {} }); }
}, { get: (t, k) => (k in t ? t[k] : noop) });
// figure.js 用**真货**，不打桩：招式姿势的断言要打在真实关节坐标上，
// 而且只有真货才会在 pose 名拼错时 console.warn —— §9 靠那条 warn 抓错字。
load('src/render/figure.js');
// §10 要验的是「四档的参数**真的传到了** FX/Audio」，不是「表里写着这些数」。
// 所以把命中三件套的三个出口全部记下来。
const fxCalls = { splash: [], ring: [], slash: [], burst: [] };
SJ.FX = new Proxy({
  splash: (x, y, dir, o) => { fxCalls.splash.push({ x, y, dir, o: o || {} }); },
  ring: (x, y, o) => { fxCalls.ring.push({ x, y, o: o || {} }); },
  slash: (x, y, a0, a1, r, o) => { fxCalls.slash.push({ x, y, r, o: o || {} }); },
  burst: (x, y, o) => { fxCalls.burst.push({ x, y, o: o || {} }); }
}, { get: (t, k) => (k in t ? t[k] : noop) });
const sfxCalls = [];
SJ.Audio = { init: noop, ready: false, music: noop, intensity: noop,
             duck: noop, setMute: noop, muted: false,
             sfx: (name, o) => { sfxCalls.push({ name, o: o || {} }); } };
function clearCalls() {
  fxCalls.splash.length = 0; fxCalls.ring.length = 0;
  fxCalls.slash.length = 0; fxCalls.burst.length = 0;
  sfxCalls.length = 0; inkCalls.stroke.length = 0; inkCalls.blob.length = 0;
}

['src/combat/combat.js', 'src/combat/tech.js', 'src/entity/player.js'].forEach(load);

// Game.init 才会调 Input.init，这里不建 canvas，手动挂一次键盘监听
SJ.Input.init(null);

// ── 驱动 ─────────────────────────────────────────────────────
function key(type, code) {
  (listeners[type] || []).forEach(fn => fn({ code, repeat: false, preventDefault: noop,
    metaKey: false, ctrlKey: false }));
}
const down = c => key('keydown', c);
const up = c => key('keyup', c);

const LEVEL = { solids: [[-40, 380, 1700, 160, 0], [-40, -200, 40, 760, 0],
                         [1620, -200, 40, 760, 0], [300, 268, 190, 16, 1]] };

const scene = {
  update(dt) {
    SJ.Ent.updateAll(dt);
    SJ.Tech.update(dt);        // 决议 005 §3：产生者先于统一结算
    SJ.Combat.update(dt);
  },
  draw() {}
};

function reset() {
  SJ.Ent.clear(); SJ.Combat.clear(); SJ.Tech.resetProgress();
  SJ.Save.reset();
  SJ.World.load(LEVEL);
  SJ.Game.setScene(scene);
  const p = SJ.Player.create(200, 300);
  SJ.Camera.setBounds(0, 1620, -120, 540);
  return p;
}
const step = (n = 1) => { for (let i = 0; i < n; i++) SJ.Game._step(); };

// ── 断言 ─────────────────────────────────────────────────────
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (detail ? '  → ' + detail : '')); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('\n【E】player / combat / tech 回归自检\n');

// ── 1. 手感基线（对齐 notes-A §4）──────────────────────────
console.log('1. 手感基线');
function apex(holdFrames) {
  const p = reset(); step(60);
  p.x = 200; p.y = 328; p.vx = 0; p.vy = 0; step(10);
  const y0 = p.y; let best = 0;
  down('Space');
  for (let i = 0; i < 140; i++) {
    if (i === holdFrames) up('Space');
    step(1);
    best = Math.max(best, y0 - p.y);
    if (i > holdFrames + 2 && p.onGround) break;
  }
  up('Space');
  return best;
}
const longApex = apex(60), shortApex = apex(1);
ok('长按跳顶点 114.00', near(longApex, 114, 0.5), longApex.toFixed(2));
ok('点按跳顶点 52.33', near(shortApex, 52.33, 0.5), shortApex.toFixed(2));

{
  const p = reset(); step(40);
  p.x = 200; p.vx = 0;
  down('KeyD'); step(60); up('KeyD');
  ok('走速 60 帧收敛到 240.00', near(p.vx, 240, 0.01), p.vx.toFixed(2));
}

function coyoteJump(waitFrames) {
  const p = reset(); step(60);
  p.maxAirJumps = 0; p.bonusJumps = 0;
  p.x = 320; p.y = 200; p.vx = 0; p.vy = 0; step(40);
  down('KeyD');
  let n = 0; while (p.onGround && n < 200) { step(1); n++; }
  up('KeyD');
  p.airJumps = 0;
  step(waitFrames);
  const before = p.vy;
  down('Space'); step(1); up('Space');
  return p.vy < before - 200;
}
ok('土狼时间：离地 5 帧内可跳', coyoteJump(5));
ok('土狼时间：离地 6 帧起不可跳', !coyoteJump(6));

{ // dt=0（hitstop）时分毫不动
  const p = reset(); step(40);
  p.x = 400; p.y = 300; p.vx = 300; p.vy = -200;
  const snap = [p.x, p.y, p.vx, p.vy];
  SJ.Game.slowmo(0, 0.2); step(5);
  ok('hitstop 期间位置速度不动且无 NaN',
    p.x === snap[0] && p.y === snap[1] && p.vx === snap[2] && p.vy === snap[3] &&
    !Number.isNaN(p.x + p.y + p.vx + p.vy), [p.x, p.y, p.vx, p.vy].join(','));
}

// ── 2. 墨（DESIGN §3.1 / §9.3）─────────────────────────────
console.log('\n2. 墨');
{
  const p = reset(); step(40);
  p.x = 200; p.y = 328; p.vx = 0; p.vy = 0; step(4);
  const t0 = SJ.Game.time, i0 = p.ink;
  down('KeyK'); step(200); up('KeyK'); step(2);
  const rate = (i0 - p.ink) / (SJ.Game.time - t0);
  ok('观势耗墨 12/s（游戏时间）', near(rate, 12, 0.6), rate.toFixed(2));

  p.ink = 20; down('KeyK'); step(120); up('KeyK');
  ok('墨≤20 观势不再扣墨', near(p.ink, 20, 0.001), p.ink.toFixed(2));

  p.ink = 15; const x0 = p.x;
  down('KeyL'); step(2); up('KeyL'); step(16);
  ok('墨≤20 身法不扣墨但仍可用', near(p.ink, 15, 0.001) && p.x > x0 + 40,
    'ink=' + p.ink.toFixed(1) + ' dx=' + (p.x - x0).toFixed(0));

  p.ink = 0; p.hp = 8; step(60 * 12);
  ok('枯墨掉血最低到 1 HP 为止', p.hp === 1, 'hp=' + p.hp);

  p.ink = 10;
  SJ.Save.data.known = ['hengyun'];
  ok('招式没有地板：墨不够放不出', SJ.Tech.use(p, 'hengyun') === false);
  p.ink = 100;
  ok('墨够时放得出', SJ.Tech.use(p, 'hengyun') === true);
  SJ.Tech.cancel(p);

  p.ink = 100; p.inkDrainMul = 1;
  down('KeyK'); step(60); up('KeyK'); step(2); const d1 = 100 - p.ink;
  p.ink = 100; p.inkDrainMul = 3;
  down('KeyK'); step(60); up('KeyK'); step(2); const d3 = 100 - p.ink;
  p.inkDrainMul = 1;
  ok('inkDrainMul ×3 精确生效（决议 009）', near(d3 / d1, 3, 0.05), (d3 / d1).toFixed(3));

  p.ink = 100;
  ok('inkTint 100→1.00', near(SJ.Player.inkTint(), 1, 0.001));
  p.ink = 0;
  ok('inkTint 0→0.00', near(SJ.Player.inkTint(), 0, 0.001));
}

// ── 3. 观势与格挡 ─────────────────────────────────────────
console.log('\n3. 观势与格挡');
function mkFoe(x) {
  const rec = { parried: 0, stun: 0 };
  const e = { tag: 'foe', team: 'foe', x, y: 326, w: 30, h: 54, vx: 0, vy: 0,
    facing: -1, hp: 99, maxHp: 99, invuln: 0, rec,
    cx() { return this.x + 15; }, cy() { return this.y + 27; },
    hurt(d, s, o) { o = o || {}; if (o.parried) { rec.parried++; rec.stun += o.stun || 0; } },
    update() {}, draw() {} };
  SJ.Ent.add(e); return e;
}
{
  const p = reset(); step(30);
  p.x = 430; p.y = 328; p.vx = 0; p.vy = 0; p.ink = 50; p.hp = 60;
  const foe = mkFoe(500);
  down('KeyK'); step(6);
  const hp0 = p.hp;
  for (let k = 0; k < 3; k++) {
    SJ.Combat.hit({ x: p.cx() - 30, y: p.cy() - 26, w: 60, h: 52, dmg: 9, team: 'foe',
      owner: foe, ttl: 0.05, knock: [0, 0], stun: 0.22, moveId: 'lianhuan' });
    step(6);
  }
  up('KeyK'); step(2);
  ok('一次多段招被格挡：伤害全挡掉', p.hp === hp0, 'hp=' + p.hp);
  ok('一次多段招被格挡：奖励只结算一次', foe.rec.parried === 1, 'parried=' + foe.rec.parried);
  ok('一次多段招被格挡：硬直只给 0.9s', near(foe.rec.stun, 0.9, 0.001), foe.rec.stun.toFixed(2));
  ok('一次多段招被格挡：残墨 +34 而非 ×3', SJ.Tech.progress.lianhuan === 34,
    String(SJ.Tech.progress.lianhuan));
  ok('34% 不会误触发学会', SJ.Save.data.known.indexOf('lianhuan') < 0);
}
{
  const p = reset(); step(30);
  p.x = 430; p.y = 328; p.vx = 0; p.vy = 0; p.ink = 100;
  const foe = mkFoe(500);
  down('KeyK'); step(6);
  const swing = () => SJ.Combat.hit({ x: p.cx() - 30, y: p.cy() - 26, w: 60, h: 52,
    dmg: 9, team: 'foe', owner: foe, ttl: 0.05, knock: [0, 0], stun: 0.2, moveId: 'poyu' });
  swing(); step(60); swing(); step(4); up('KeyK');
  ok('两次分开的挥砍各结算一次', foe.rec.parried === 2, 'parried=' + foe.rec.parried);
  ok('两次格挡 = 残墨 68', SJ.Tech.progress.poyu === 68, String(SJ.Tech.progress.poyu));
}
{ // 挨打也在学（决议 012 路径一：可发现性的地基）
  const p = reset(); step(30);
  p.x = 430; p.y = 328; p.vx = 0; p.vy = 0;
  const foe = mkFoe(500);
  let hits = 0;
  for (let i = 0; i < 12 && SJ.Save.data.known.indexOf('poyu') < 0; i++) {
    p.invuln = 0;
    SJ.Combat.hit({ x: p.cx() - 30, y: p.cy() - 26, w: 60, h: 52, dmg: 1, team: 'foe',
      owner: foe, ttl: 0.05, knock: [0, 0], stun: 0, moveId: 'poyu' });
    step(2); hits++;
    while (SJ.Game.stack.length > 1) step(1);
  }
  ok('从不按键、只挨打也必然学会一招（9 次）', hits === 9 &&
    SJ.Save.data.known.indexOf('poyu') >= 0, 'hits=' + hits);
}

// ── 4. 三连与命中反馈 ──────────────────────────────────────
console.log('\n4. 三连');
{
  const p = reset(); step(40);
  p.x = 452; p.y = 328; p.vx = 0; p.vy = 0; p.facing = 1;
  const foe = mkFoe(520);
  foe.hurt = function (d) { this.hp -= d; };
  const h0 = foe.hp;
  const stop = { 1: 0, 2: 0, 3: 0 }; let cur = 1;
  const press = () => { down('KeyJ'); step(1); up('KeyJ'); };
  const run = n => { for (let i = 0; i < n; i++) { if (SJ.Game.timeScale() < 0.5) stop[cur]++; step(1); } };
  cur = 1; press(); run(15);
  cur = 2; press(); run(15);
  cur = 3; press(); run(30);
  ok('三连总伤害 8+9+14 = 31', h0 - foe.hp === 31, String(h0 - foe.hp));
  ok('hitstop 逐段递增 45→60→90ms', stop[1] < stop[2] && stop[2] < stop[3],
    [stop[1], stop[2], stop[3]].join('/'));
}

// ── 5. 十二招 ─────────────────────────────────────────────
console.log('\n5. 十二招');
{
  let bad = [];
  for (const d of SJ.Tech.defs) {
    const p = reset(); step(30);
    p.x = 440; p.y = 328; p.vx = 0; p.vy = 0; p.facing = 1; p.ink = 100;
    mkFoe(520);
    SJ.Save.data.known = [d.id];
    if (d.id === 'tiyun') { p.vy = -200; p.y = 280; p.onGround = false; }
    if (d.id === 'shuojian') SJ.Combat.lastFoeMove = 'zhenshan';
    if (!SJ.Tech.use(p, d.id)) { bad.push(d.id + ':use'); continue; }
    let f = 0; while (SJ.Tech.busy(p) && f < 200) { step(1); f++; }
    if (f >= 200) bad.push(d.id + ':stuck');
    if (p.y > 700) bad.push(d.id + ':fellThroughWorld');
    if (!Number.isFinite(p.x + p.y + p.vx + p.vy)) bad.push(d.id + ':NaN');
  }
  ok('12 招全部可用、不卡死、不掉出世界', bad.length === 0, bad.join(','));
  ok('defs 数组与 id 键双索引都取得到',
    SJ.Tech.defs.length === 12 && SJ.Tech.defs.hengyun === SJ.Tech.def('hengyun'));
  ok('wufeng 的 hitbox 带 moveId（决议 008 §2，守阁人靠它破防）',
    /moveId: 'wufeng'/.test(fs.readFileSync(path.join(ROOT, 'src/combat/tech.js'), 'utf8')));
}
{ // 决议 008 §1：创建即记录，挥空也算
  const p = reset(); step(30);
  p.x = 200; p.y = 328; p.vx = 0; p.vy = 0; p.ink = 100;
  SJ.Save.data.known = ['poyu'];
  SJ.Combat.lastPlayerMove = null;
  SJ.Tech.use(p, 'poyu');
  let f = 0; while (SJ.Tech.busy(p) && f < 120) { step(1); f++; }
  ok('lastPlayerMove 挥空也记录（决议 008 §1）', SJ.Combat.lastPlayerMove === 'poyu',
    String(SJ.Combat.lastPlayerMove));
}
{ // 说剑复制
  const p = reset(); step(30);
  p.x = 440; p.y = 328; p.vx = 0; p.vy = 0; p.facing = 1; p.ink = 100;
  const foe = mkFoe(520);
  foe.hurt = function (d) { this.hp -= d; };
  SJ.Save.data.known = ['shuojian'];
  SJ.Combat.lastFoeMove = 'zhenshan';
  const h0 = foe.hp;
  SJ.Tech.use(p, 'shuojian');
  let f = 0; while (SJ.Tech.busy(p) && f < 200) { step(1); f++; }
  ok('说剑复制敌招（zhenshan → 16 伤）', h0 - foe.hp === 16, String(h0 - foe.hp));
}

// ── 6.「悟」的演出 ────────────────────────────────────────
console.log('\n6.「悟」');
{
  const p = reset(); step(40);
  down('KeyK');                       // 完美观势触发学招时玩家正按着 K
  SJ.Tech.gain('hengyun', 100); step(1);
  let f = 0; while (SJ.Game.stack.length > 1 && f < 300) { step(1); f++; }
  up('KeyK');
  ok('按住 K 时学招，演出仍播满 ≈105 帧', near(f, 105, 3), f + ' 帧');
}
{
  const p = reset(); step(40);
  down('KeyD');
  SJ.Tech.gain('tiyun', 100); step(1);
  let f = 0; while (SJ.Game.stack.length > 1 && f < 300) { step(1); f++; }
  up('KeyD');
  ok('按住 D 时（关卡 trigger 学招）也播满', near(f, 105, 3), f + ' 帧');
}
{
  const p = reset(); step(40);
  SJ.Tech.gain('poyu', 100); step(1);
  let f = 0;
  while (SJ.Game.stack.length > 1 && f < 300) {
    step(1); f++;
    if (f === 70) { down('Space'); step(1); f++; up('Space'); }
  }
  ok('1.05s 后按确认可以跳过', f < 80, f + ' 帧');
}
{ // 场景被切走后 learning 必须解锁，否则之后所有「悟」静默消失
  reset(); step(40);
  SJ.Tech.gain('hengyun', 100); step(3);
  const wasUp = SJ.Game.stack.length > 1;
  SJ.Game.setScene(scene);            // 模拟 Level.load 打断学招
  step(3);
  SJ.Tech.gain('poyu', 100); step(3);
  ok('学招被 setScene 打断后，下一次「悟」照常显示',
    wasUp && SJ.Game.stack.length > 1);
}
{
  reset(); step(40);
  SJ.Tech.gain('hengyun', 100);
  ok('learn 写入 known 并自动填入第一个空槽',
    SJ.Save.data.known.indexOf('hengyun') >= 0 && SJ.Save.data.slots[0] === 'hengyun',
    JSON.stringify(SJ.Save.data.slots));
  while (SJ.Game.stack.length > 1) step(1);
}

// ── 6b. 悟时槽位已满：在悟的画面里选替换（决议 024）──────────
// 这一条挡的是一个**零提示的死局**：一周目到第五回四槽通常已满，
// 旧的 learn 只往空槽塞，塞不进去就什么都不做 —— 无锋学会了却装不上，
// 而守阁人只有无锋能撬开，于是 Boss 完全无敌，游戏不给任何提示。
console.log('\n6b. 悟时选槽（决议 024）');
{
  const fill = () => { SJ.Save.data.slots = ['poyu', 'liebo', 'chengtian', 'guying'];
    SJ.Save.data.known = ['poyu', 'liebo', 'chengtian', 'guying']; };
  // ⚠️ 演出会在 act 排好的「松手」那一帧之前就关掉（按 J 确认那一帧场景就 pop 了），
  // 于是 up() 永远轮不到 —— 键一直按着，**后面所有段落的 down() 都会被 srcDown 挡掉**。
  // §7d「命中会产生墨点飞溅」就是这么被这一段悄悄弄挂的：那边 down('KeyJ') 无效、
  // 玩家根本没出剑，报出来的却是「墨点没飞溅」。所以这里退出时无条件把键抬干净。
  const USED = ['KeyA', 'KeyD', 'KeyJ', 'Space'];
  const runScene = (frames, act) => {
    let f = 0;
    try {
      while (SJ.Game.stack.length > 1 && f < 400) {
        if (act) act(f);
        step(1); f++;
      }
    } finally { USED.forEach(up); }
    return f;
  };

  { // 有空槽 → 行为完全不变（不弹选择、直接填第一个空槽）
    reset(); step(20);
    SJ.Save.data.slots = ['poyu', null, null, null];
    SJ.Save.data.known = ['poyu'];
    SJ.Tech.gain('hengyun', 100); step(1);
    const f = runScene();
    ok('有空槽时行为不变：填进第一个空槽、演出仍是 1.75s（≈105 帧）',
      SJ.Save.data.slots[1] === 'hengyun' && near(f, 105, 3),
      JSON.stringify(SJ.Save.data.slots) + ' ' + f + '帧');
  }

  { // 四槽全满 → 缺省替换最后一槽，且新招必须真的在槽内
    reset(); step(20);
    fill();
    const before = SJ.Save.data.slots.slice();
    SJ.Tech.gain('wufeng', 100); step(1);
    ok('四槽已满时不再静默丢弃：学会即进 known', SJ.Save.data.known.indexOf('wufeng') >= 0);
    const f = runScene();
    ok('四槽已满时学新招 → 新招必在槽内（决议 024 的核心断言）',
      SJ.Save.data.slots.indexOf('wufeng') >= 0,
      `${JSON.stringify(before)} → ${JSON.stringify(SJ.Save.data.slots)}`);
    ok('缺省替换最后一槽', SJ.Save.data.slots[3] === 'wufeng',
      JSON.stringify(SJ.Save.data.slots));
    ok('替换后仍然是四个槽、没有把别的招挤掉两次',
      SJ.Save.data.slots.length === 4 &&
      SJ.Save.data.slots.filter(x => x === 'wufeng').length === 1,
      JSON.stringify(SJ.Save.data.slots));
    ok('选槽时演出给到 3.0s（≈180 帧）而不是 1.75s —— 1.75s 里只有 0.7s 可交互',
      near(f, 180, 4), f + '帧');
  }

  { // ←/→ 真的能改选，J 确认
    reset(); step(20);
    fill();
    SJ.Tech.gain('wufeng', 100); step(1);
    runScene(0, (f) => {
      if (f === 40) { down('KeyA'); }            // ← 一次：3 → 2
      if (f === 41) { up('KeyA'); }
      if (f === 70) { down('KeyJ'); }            // 1.05s 之后确认
      if (f === 71) { up('KeyJ'); }
    });
    ok('←/→ 能改选：按一次左键后替换的是第 3 格（下标 2）',
      SJ.Save.data.slots[2] === 'wufeng' && SJ.Save.data.slots[3] === 'guying',
      JSON.stringify(SJ.Save.data.slots));
  }

  { // 左键绕回：从 3 连按 4 次左应当回到 3
    reset(); step(20);
    fill();
    SJ.Tech.gain('wufeng', 100); step(1);
    let n = 0;
    runScene(0, (f) => {
      if (f % 6 === 0 && n < 4) { down('KeyA'); n++; }
      if (f % 6 === 1) { up('KeyA'); }
    });
    ok('选择在四格之间绕回（连按 4 次左回到原位）',
      SJ.Save.data.slots[3] === 'wufeng', JSON.stringify(SJ.Save.data.slots));
  }

  { // 演出被 Level.load 打断也不能把刚学会的招丢在槽外
    reset(); step(20);
    fill();
    SJ.Tech.gain('wufeng', 100); step(3);
    ok('打断前：选择屏确实起来了', SJ.Game.stack.length > 1);
    SJ.Game.setScene(scene);                     // 模拟 Level.load 打断
    step(2);
    ok('选槽屏被 setScene 打断 → 仍然按缺省替换，招不会丢在槽外',
      SJ.Save.data.slots.indexOf('wufeng') >= 0,
      JSON.stringify(SJ.Save.data.slots));
    // 打断后 learning 必须解锁，否则之后所有「悟」静默消失（既有的坑）
    SJ.Save.data.known = ['poyu', 'liebo', 'chengtian', 'guying', 'wufeng'];
    SJ.Tech.gain('hengyun', 100); step(3);
    ok('打断之后下一次「悟」照常显示', SJ.Game.stack.length > 1);
    while (SJ.Game.stack.length > 1) step(1);
  }

  { // 走的必须是契约 007 §1 的唯一写入口
    const src = fs.readFileSync(path.join(ROOT, 'src/combat/tech.js'), 'utf8');
    ok('替换走 SJ.Player.setSlot（契约 007 §1 的唯一写入口），不是直接写 Save.data.slots',
      /SJ\.Player\.setSlot\(this\.pick, def\.id\)/.test(src));
  }
}

// ── 7. 决议 007 / 009 接口 ────────────────────────────────
console.log('\n7. 决议 007 / 009 接口');
{
  const p = reset(); step(30);
  SJ.Save.data.known = ['poyu', 'hengyun'];
  SJ.Save.data.slots = [null, null, null, null];
  ok('setSlot 写入成功', SJ.Player.setSlot(0, 'poyu') === true);
  ok('setSlot 拒绝没学会的招', SJ.Player.setSlot(1, 'liebo') === false);
  SJ.Player.setSlot(2, 'poyu');
  ok('setSlot 同一招不占两个槽',
    SJ.Save.data.slots[0] === null && SJ.Save.data.slots[2] === 'poyu',
    JSON.stringify(SJ.Save.data.slots));
  SJ.Save.save(); SJ.Save.load();
  ok('读档后 p.slots 仍指向当前 Save.data（取值器不会静默断开）',
    SJ.player.slots === SJ.Save.data.slots);
}
{
  const p = reset(); step(40);
  const drift = ax => {
    p.x = 200; p.vx = 0; p.envVx = 0; step(4);
    for (let i = 0; i < 60; i++) { SJ.Player.envForce(ax, 0); step(1); }
    return p.x - 200;
  };
  const d300 = drift(300), d900 = drift(900), d1800 = drift(1800);
  ok('envForce 线性可调（900 ≈ 3×300，1800 ≈ 6×300）',
    near(d900 / d300, 3, 0.25) && near(d1800 / d300, 6, 0.5),
    [d300, d900, d1800].map(v => v.toFixed(0)).join('/'));
  for (let i = 0; i < 150; i++) step(1);
  ok('停止施力后环境速度归零', p.envVx === 0, p.envVx.toFixed(3));
  ok('envAx 每帧消费后清零', p.envAx === 0);

  p.x = 200; p.vx = 0; p.envVx = 0; step(2);
  down('KeyA');
  for (let i = 0; i < 60; i++) { SJ.Player.envForce(900, 0); step(1); }
  up('KeyA');
  ok('玩家仍能顶着风走（逆风净位移为负）', p.x < 195, (p.x - 200).toFixed(0) + 'px');
}

// ── 7d. 命中三件套的墨点必须落地（B 的 groundY 要求）───────
console.log('\n7d. 墨点落地');
{
  const p = reset(); step(40);
  p.x = 452; p.y = 328; p.vx = 0; p.vy = 0; p.facing = 1;
  const foe = mkFoe(520);
  foe.hurt = function (d) { this.hp -= d; };
  fxCalls.splash.length = 0;
  down('KeyJ'); step(1); up('KeyJ'); step(10);
  const c = fxCalls.splash[0];
  ok('命中会产生墨点飞溅', !!c);
  ok('墨点带 groundY（否则只在半空晕开，打击感少三分之一）',
    c && typeof c.o.groundY === 'number' && isFinite(c.o.groundY),
    c ? String(c.o.groundY) : '无调用');
  ok('groundY 落在地面线 380 上', c && near(c.o.groundY, 380, 0.01),
    c ? String(c.o.groundY) : '-');
  // splash 第三参是弧度角：向右打应当甩向右上（cos>0, sin<0）
  ok('splash 第三参传的是弧度角而非 ±1（向右打甩向右上）',
    c && Math.cos(c.dir) > 0.5 && Math.sin(c.dir) < 0,
    c ? 'dir=' + c.dir.toFixed(2) : '-');

  // 反向：向左打必须甩向左上，不能和向右同侧
  const p2 = reset(); step(40);
  p2.x = 452; p2.y = 328; p2.vx = 0; p2.vy = 0; p2.facing = -1;
  const foe2 = mkFoe(402);
  foe2.hurt = function (d) { this.hp -= d; };
  fxCalls.splash.length = 0;
  down('KeyJ'); step(1); up('KeyJ'); step(10);
  const c2 = fxCalls.splash[0];
  ok('向左打甩向左上（两侧不同号）', c2 && Math.cos(c2.dir) < -0.5 && Math.sin(c2.dir) < 0,
    c2 ? 'dir=' + c2.dir.toFixed(2) : '无调用');
}

// ── 8. 契约面 ─────────────────────────────────────────────
console.log('\n8. 契约面');
{
  const need = {
    'SJ.Combat.hit': typeof SJ.Combat.hit, 'SJ.Combat.telegraph': typeof SJ.Combat.telegraph,
    'SJ.Combat.tgList': typeof SJ.Combat.tgList, 'SJ.Combat.update': typeof SJ.Combat.update,
    'SJ.Combat.draw': typeof SJ.Combat.draw, 'SJ.Combat.clear': typeof SJ.Combat.clear,
    'SJ.Tech.defs': typeof SJ.Tech.defs, 'SJ.Tech.can': typeof SJ.Tech.can,
    'SJ.Tech.use': typeof SJ.Tech.use, 'SJ.Tech.update': typeof SJ.Tech.update,
    'SJ.Tech.progress': typeof SJ.Tech.progress, 'SJ.Tech.gain': typeof SJ.Tech.gain,
    'SJ.Tech.learn': typeof SJ.Tech.learn, 'SJ.Player.create': typeof SJ.Player.create,
    'SJ.Player.inkTint': typeof SJ.Player.inkTint, 'SJ.Player.setSlot': typeof SJ.Player.setSlot,
    'SJ.Player.envForce': typeof SJ.Player.envForce
  };
  const missing = Object.keys(need).filter(k => need[k] === 'undefined');
  ok('契约要求的符号齐全', missing.length === 0, missing.join(','));

  const p = SJ.player;
  const fields = ['ink', 'maxInk', 'hp', 'maxHp', 'hearts', 'state', 'known', 'slots',
                  'observing', 'parryWindow', 'onParry', 'addInk', 'spendInk', 'respawn',
                  'figOpts', 'inkDrainMul'];
  const miss2 = fields.filter(f => p[f] === undefined);
  ok('玩家实例字段齐全（含 figOpts，决议 001 §4）', miss2.length === 0, miss2.join(','));
  ok('figOpts 每帧维护（残影/分身靠它）',
    p.figOpts && typeof p.figOpts.x === 'number' && p.figOpts.pose);

  const st = ['idle', 'run', 'jump', 'fall', 'dash', 'atk1', 'atk2', 'atk3', 'observe',
              'hurt', 'dead', 'cast', 'land', 'crouch'];
  const src = fs.readFileSync(path.join(ROOT, 'src/entity/player.js'), 'utf8');
  ok('契约要求的 14 个状态名都在实现里出现',
    st.every(s => src.indexOf("'" + s + "'") >= 0));
}

// ── 9. 十二招各自的姿势（增强波次 P1-5 / P1-6）─────────────
// 判据：把 pose 解算成 15 个关节（含剑尖）的世界坐标，两个姿势的差异用 RMS 位移衡量。
// 单位是 figure.js 的局部单位，scale=1 时身高约 62；阈值 10 ≈ 身高的 16%。
// 为什么要有这条：castWind/castHit 一套姿势给 12 招用是**不报错的**，
// 玩家只会觉得「这游戏的招都长一样」，而没有任何自检会亮红灯。
console.log('\n9. 十二招姿势');
{
  const MOVES = ['hengyun', 'liebo', 'chengtian', 'guying', 'wufeng', 'lianhuan',
                 'poyu', 'chuanyang', 'zhenshan', 'tiyun', 'fenshu', 'shuojian'];
  const JK = ['hip', 'mid', 'neck', 'sh', 'headBase', 'headTop', 'elF', 'haF',
              'elB', 'haB', 'knF', 'ftF', 'knB', 'ftB', 'tip'];
  const THRESH = 10.0;
  const J = (name, prog) => SJ.Figure.joints({ x: 0, y: 0, facing: 1, scale: 1,
    pose: name, p: prog, t: 0, weapon: 'jian' });
  const rms = (a, b) => Math.sqrt(
    JK.reduce((acc, k) => acc + (a[k].x - b[k].x) ** 2 + (a[k].y - b[k].y) ** 2, 0) / JK.length);

  // 先确认关节表本身是全的 —— instanceof 跨 realm 会让 joints() 静默少字段
  const probe = J('idle', 0);
  ok('Figure.joints 返回全部 15 个关节（跨 realm 的 instanceof 坑）',
    JK.every(k => probe[k] && typeof probe[k].x === 'number'),
    JK.filter(k => !probe[k]).join(',') || '-');

  // 9a. 每一招都有自己的起手 / 命中，且不是回退到 idle
  const missing = [];
  for (const id of MOVES) {
    for (const sfx of ['_wind', '_hit']) {
      if (typeof SJ.Figure.poses[id + sfx] !== 'function') missing.push(id + sfx);
    }
  }
  ok('12 招各有独立的 _wind / _hit 共 24 个 pose', missing.length === 0, missing.join(','));

  // 9b. 任意两招的**起手**必须拉得开
  let worst = { d: 1e9, a: '', b: '' };
  for (let i = 0; i < MOVES.length; i++) {
    for (let j = i + 1; j < MOVES.length; j++) {
      const d = rms(J(MOVES[i] + '_wind', 0), J(MOVES[j] + '_wind', 0));
      if (d < worst.d) worst = { d, a: MOVES[i], b: MOVES[j] };
    }
  }
  ok(`任意两招起手 pose 的关节 RMS ≥ ${THRESH}`, worst.d >= THRESH,
    `最接近的一对 ${worst.a}/${worst.b} = ${worst.d.toFixed(1)}`);

  // 9c. 命中姿势同样不许撞（否则起手分开了、打出去还是一个样）
  let worstH = { d: 1e9, a: '', b: '' };
  for (let i = 0; i < MOVES.length; i++) {
    for (let j = i + 1; j < MOVES.length; j++) {
      const d = rms(J(MOVES[i] + '_hit', 1), J(MOVES[j] + '_hit', 1));
      if (d < worstH.d) worstH = { d, a: MOVES[i], b: MOVES[j] };
    }
  }
  ok(`任意两招命中 pose 的关节 RMS ≥ ${THRESH}`, worstH.d >= THRESH,
    `最接近的一对 ${worstH.a}/${worstH.b} = ${worstH.d.toFixed(1)}`);

  // 9d. 同一招的起手与命中之间要有「变化」，不能拿起手当命中糊弄过阈值
  let worstW = { d: 1e9, a: '' };
  for (const id of MOVES) {
    const d = rms(J(id + '_wind', 0), J(id + '_hit', 1));
    if (d < worstW.d) worstW = { d, a: id };
  }
  ok(`同一招 起手→命中 的关节 RMS ≥ ${THRESH}`, worstW.d >= THRESH,
    `最小 ${worstW.a} = ${worstW.d.toFixed(1)}`);

  // 9e. 三段普攻必须是三个方向（横 / 斜 / 竖），不是三个力度
  const ATKP = ['atk1_wind', 'atk2_wind', 'atk3_wind', 'atk1_hit', 'atk2_hit', 'atk3_hit'];
  let worstA = { d: 1e9, a: '', b: '' };
  for (let i = 0; i < ATKP.length; i++) {
    for (let j = i + 1; j < ATKP.length; j++) {
      const d = rms(J(ATKP[i], ATKP[i].endsWith('wind') ? 0 : 1),
                    J(ATKP[j], ATKP[j].endsWith('wind') ? 0 : 1));
      if (d < worstA.d) worstA = { d, a: ATKP[i], b: ATKP[j] };
    }
  }
  ok(`atk1/2/3 的 6 个姿势两两 RMS ≥ ${THRESH}`, worstA.d >= THRESH,
    `最接近 ${worstA.a}/${worstA.b} = ${worstA.d.toFixed(1)}`);
  // 方向本身也钉一下：横=剑尖在肩胸高度且靠前，竖=剑尖压到接近地面
  const t1 = J('atk1_hit', 1).tip, t3 = J('atk3_hit', 1).tip;
  ok('atk1 收在「横」（剑尖高于腰）、atk3 收在「竖」（剑尖压到脚边）',
    t1.y < -30 && t3.y > -20 && t1.y < t3.y - 15,
    `atk1.tip.y=${t1.y.toFixed(0)} atk3.tip.y=${t3.y.toFixed(0)}`);

  // 9f. 剑尖不许穿到地面以下太多（人物是站在 y=0 的地面线上画的）
  const under = [];
  for (const id of MOVES) {
    for (const sfx of ['_wind', '_hit']) {
      for (const pp of [0, 0.5, 1]) {
        const j = J(id + sfx, pp);
        for (const k of JK) if (j[k].y > 14) under.push(`${id}${sfx}@${pp}:${k}`);
      }
    }
  }
  ok('12 招全程没有关节/剑尖陷进地面 14 单位以下', under.length === 0, under.slice(0, 4).join(','));

  // 9g. **静态**：tech.js 的每一处 cast(p,'X') 与 player.js figure() 用到的名字都得存在。
  // 打错一个字只会 console.warn 一次然后永远退回 idle —— 不报错、不崩、看不出来。
  const techSrc = fs.readFileSync(path.join(ROOT, 'src/combat/tech.js'), 'utf8');
  const castNames = [...techSrc.matchAll(/cast\(p,\s*'([a-zA-Z0-9_]+)'/g)].map(m => m[1]);
  const badCast = [...new Set(castNames)].filter(n => typeof SJ.Figure.poses[n] !== 'function');
  ok(`tech.js 里 ${castNames.length} 处 cast 的 pose 名全部存在`, badCast.length === 0, badCast.join(','));
  ok('tech.js 不再有招式共用 castWind / castHit（12 招雷同的根因）',
    castNames.indexOf('castWind') < 0 && castNames.indexOf('castHit') < 0,
    castNames.filter(n => n === 'castWind' || n === 'castHit').join(','));
  const plSrc = fs.readFileSync(path.join(ROOT, 'src/entity/player.js'), 'utf8');
  // 只收整串字面量：atk 那一支是 name = 'atk' + (i+1) + '_' + ph 拼出来的，
  // 拼接结果单独列举（下一条），否则正则会把裸的 'atk' 当成一个 pose 名。
  const plNames = [...plSrc.matchAll(/name = '([a-zA-Z0-9_]+)';/g)].map(m => m[1]);
  const badPl = [...new Set(plNames)].filter(n => typeof SJ.Figure.poses[n] !== 'function');
  ok(`player.js figure() 里 ${new Set(plNames).size} 个 pose 名全部存在`,
    badPl.length === 0, badPl.join(','));
  const atkNames = [];
  for (const i of [1, 2, 3]) for (const ph of ['wind', 'hit', 'rec']) atkNames.push(`atk${i}_${ph}`);
  const badAtk = atkNames.filter(n => typeof SJ.Figure.poses[n] !== 'function');
  ok('三连拼接出来的 9 个 atkN_phase 也都存在', badAtk.length === 0, badAtk.join(','));

  // 9h. **动态**：真的把 12 招跑一遍，任何一次「未知 pose」的 warn 都算失败
  const realWarn = console.warn;
  const warns = [];
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try {
    for (const d of SJ.Tech.defs) {
      const p = reset(); step(20);
      p.x = 440; p.y = 328; p.vx = 0; p.vy = 0; p.facing = 1; p.ink = 100;
      mkFoe(520);
      SJ.Save.data.known = [d.id];
      if (d.id === 'tiyun') { p.vy = -200; p.y = 280; p.onGround = false; }
      if (d.id === 'shuojian') SJ.Combat.lastFoeMove = 'zhenshan';
      SJ.Tech.use(p, d.id);
      let f = 0;
      while (SJ.Tech.busy(p) && f < 200) { step(1); f++; }
    }
  } finally { console.warn = realWarn; }
  ok('跑完 12 招没有任何「未知 pose → 回退 idle」的告警',
    warns.filter(w => /未知 pose/.test(w)).length === 0, warns.slice(0, 3).join(' | '));
}

// ── 10. 命中确认四档（增强波次 P1-7）───────────────────────
// 分层的意思不是「把现有数字收进一张表」——那只是换了个地方放。
// 四档在**震幅 / 墨点数 / 甩出力度 / 音量**上必须彼此可见地不同，
// 而且这些参数得**真的传到** FX/Audio，不是表里写着好看。
console.log('\n10. 命中确认四档');
{
  const T = SJ.Combat.TIER;
  const ORDER = ['light', 'heavy', 'parry', 'execute'];
  ok('SJ.Combat.TIER 暴露了四档', ORDER.every(k => !!T[k]));

  // 10a. 五个轴逐档严格递增
  const AXES = [['stop', 'hitstop'], ['shake', '震幅'], ['splash', '墨点数'],
                ['spray', '甩出力度'], ['vol', '音量']];
  for (const [key, label] of AXES) {
    const v = ORDER.map(k => T[k][key]);
    ok(`四档的${label}严格递增（轻击 < 重击 < 完美格挡 < 处决）`,
      v.every((x, n) => n === 0 || x > v[n - 1]), v.join(' < '));
  }

  // 10b. Lead 的硬约束：hitstop 每档不得比改造前多 30ms。实际是一个数都没动。
  const BASE = { light: 0.045, heavy: 0.090, parry: 0.100, execute: 0.140 };
  ok('每一档 hitstop 都没有比改造前多出 30ms 以上（手感不许变粘）',
    ORDER.every(k => T[k].stop <= BASE[k] + 0.030 + 1e-9),
    ORDER.map(k => `${k}:${T[k].stop}`).join(' '));
  ok('hitstop 一个数都没动（Δ=0ms）',
    ORDER.every(k => Math.abs(T[k].stop - BASE[k]) < 1e-9),
    ORDER.map(k => `${k}:${T[k].stop}`).join(' '));
  // 改造前的老问题：音量 0.8/1.0/1.0/1.0，四档里三档一个值，等于没分层。
  ok('音量不再是「三档一个值」（改造前 0.8/1/1/1）',
    new Set(ORDER.map(k => T[k].vol)).size === 4,
    ORDER.map(k => T[k].vol).join('/'));

  // 10c. 四条触发路径：spy 住 Game.slowmo / Game.shake / FX.splash / Audio.sfx，
  // 逐档确认这一档的**每一个**参数都真的传出去了。
  // 注意判据是「其中有一次等于该档」而不是「只有一次」——镇山(.14)/焚书(.12)/
  // 无锋 onHit(.14) 自己也会调 slowmo 与 shake，slows 取最小 scale 不会叠时长。
  const realSlow = SJ.Game.slowmo, realShake = SJ.Game.shake;
  let slows = [], shakes = [];
  SJ.Game.slowmo = function (sc, sec) { slows.push([sc, sec]); return realSlow.call(SJ.Game, sc, sec); };
  SJ.Game.shake = function (m, sec) { shakes.push(m); return realShake.call(SJ.Game, m, sec); };
  const reset3 = () => { slows = []; shakes = []; clearCalls(); };
  function verify(tierKey, label) {
    const w = T[tierKey];
    const stopOk = slows.some(([sc, sec]) => sc === 0 && Math.abs(sec - w.stop) < 1e-9);
    const shakeOk = shakes.some(m => Math.abs(m - w.shake) < 1e-9);
    const sp = fxCalls.splash.find(c => c.o.n === w.splash);
    const sprayOk = !!sp && Math.abs(sp.o.speed - w.spray) < 1e-9;
    const au = sfxCalls.find(c => c.name === w.sfx && Math.abs((c.o.vol || 0) - w.vol) < 1e-9);
    ok(`${label}档：停顿/震幅/墨点数/甩速/音量五个参数都真的传给了 FX 与 Audio`,
      stopOk && shakeOk && !!sp && sprayOk && !!au,
      `stop=${stopOk} shake=${shakeOk}(${shakes.join(',')}) ` +
      `splash=${!!sp} spray=${sprayOk} sfx=${!!au}(${sfxCalls.map(c => c.name + ':' + c.o.vol).join(',')})`);
  }
  try {
    { // 轻击：普攻第一段真的砍中
      const p = reset(); step(40);
      p.x = 452; p.y = 328; p.vx = 0; p.vy = 0; p.facing = 1;
      const foe = mkFoe(520); foe.hurt = function (d) { this.hp -= d; };
      reset3(); down('KeyJ'); step(1); up('KeyJ'); step(10);
      verify('light', '轻击（普攻第一段命中）');
    }
    { // 重击
      const p = reset(); step(40);
      p.x = 452; p.y = 328; p.vx = 0; p.vy = 0; p.facing = 1;
      const foe = mkFoe(520); foe.hurt = function (d) { this.hp -= d; };
      reset3();
      SJ.Combat.hit({ x: p.cx() + 10, y: p.cy() - 20, w: 60, h: 44, dmg: 18, team: 'player',
        owner: p, ttl: 0.05, weight: 'heavy' });
      step(3);
      verify('heavy', '重击（weight:heavy）');
    }
    { // 完美格挡
      const p = reset(); step(30);
      p.x = 430; p.y = 328; p.vx = 0; p.vy = 0; p.ink = 60;
      const foe = mkFoe(500);
      down('KeyK'); step(6); reset3();
      SJ.Combat.hit({ x: p.cx() - 30, y: p.cy() - 26, w: 60, h: 52, dmg: 9, team: 'foe',
        owner: foe, ttl: 0.05, knock: [0, 0], stun: 0.2, moveId: 'poyu' });
      step(3); up('KeyK');
      verify('parry', '完美格挡（观势读中）');
    }
    { // 处决
      const p = reset(); step(40);
      p.x = 452; p.y = 328; p.vx = 0; p.vy = 0; p.facing = 1;
      const foe = mkFoe(520); foe.hurt = function (d) { this.hp -= d; };
      reset3();
      SJ.Combat.hit({ x: p.cx() + 10, y: p.cy() - 20, w: 60, h: 44, dmg: 24, team: 'player',
        owner: p, ttl: 0.05, weight: 'huge' });
      step(3);
      verify('execute', '处决（weight:huge）');
    }

    // 10d.「挡开」：hitbox 命中一个 invuln 的目标。
    // 改造前这条分支是静默 return —— Boss 换势有 1.0–1.3s 无敌，玩家一顿砍下去
    // 屏幕上什么都不发生，分不清是挥空了还是被挡开了。
    const D = SJ.Combat.DEFLECT;
    ok('SJ.Combat.DEFLECT 暴露了「挡开」参数（不是第五档）',
      !!D && D.sfx === 'block' && D.stop === 0, JSON.stringify(D));
    {
      const p = reset(); step(40);
      p.x = 452; p.y = 328; p.vx = 0; p.vy = 0; p.facing = 1;
      const foe = mkFoe(520);
      foe.hurt = function (d) { this.hp -= d; };
      foe.invuln = 1.0;                        // 模拟 Boss 换势（ai.js 的 shift 态）
      const hp0 = foe.hp;
      SJ.Tech.progress = {};
      reset3();
      SJ.Combat.hit({ x: p.cx() + 10, y: p.cy() - 20, w: 60, h: 44, dmg: 18, team: 'player',
        owner: p, ttl: 0.05, weight: 'heavy', moveId: 'hengyun' });
      step(3);
      const au = sfxCalls.find(c => c.name === D.sfx);
      ok('挡开：invuln 目标被击中时 FX 与 Audio 以「挡开」参数各被调用一次',
        fxCalls.ring.length === 1 && !!au && Math.abs((au.o.vol || 0) - D.vol) < 1e-9 &&
        shakes.some(m => Math.abs(m - D.shake) < 1e-9),
        `ring=${fxCalls.ring.length} sfx=${sfxCalls.map(c => c.name).join(',')} shake=${shakes.join(',')}`);
      ok('挡开：不掉血', foe.hp === hp0, `${hp0} → ${foe.hp}`);
      ok('挡开：没有 hitstop（换势期间可能连中七八下，一帧一次也会糊成粘滞）',
        !slows.some(([sc]) => sc === 0), JSON.stringify(slows));
      ok('挡开：不飞墨点（墨点是「见血」的语言，这一下没见血）',
        fxCalls.splash.length === 0, String(fxCalls.splash.length));
      ok('挡开：不进任何进度统计', Object.keys(SJ.Tech.progress).length === 0,
        JSON.stringify(SJ.Tech.progress));
    }
    { // 单向：玩家自己在无敌帧里被打**不给**挡开反馈。
      // 那不是「挡住了」，那是无敌帧；响一声 block 会告诉玩家「你挡住了」，
      // 把他往错的方向教（真正的挡是观势格挡，有完全不同的一整套反馈），多敌时还吵。
      const p = reset(); step(40);
      p.x = 452; p.y = 328; p.vx = 0; p.vy = 0;
      p.invuln = 0.5;
      const foe = mkFoe(520);
      const hp0 = p.hp;
      reset3();
      SJ.Combat.hit({ x: p.cx() - 20, y: p.cy() - 20, w: 60, h: 44, dmg: 12, team: 'foe',
        owner: foe, ttl: 0.05 });
      step(3);
      ok('挡开是单向的：玩家在无敌帧被打 → 无 FX、无声、hp 不变',
        fxCalls.ring.length === 0 && fxCalls.slash.length === 0 &&
        sfxCalls.length === 0 && p.hp === hp0,
        `ring=${fxCalls.ring.length} slash=${fxCalls.slash.length} ` +
        `sfx=${sfxCalls.map(c => c.name).join(',')} hp ${hp0}→${p.hp}`);
    }
    { // 冲刺无敌同理：身法穿过敌人的招不该响
      const p = reset(); step(40);
      p.x = 452; p.y = 328; p.vx = 0; p.vy = 0;
      const foe = mkFoe(520);
      down('KeyL'); step(2); up('KeyL');          // 身法：invuln 0.20
      const hp0 = p.hp;
      reset3();
      SJ.Combat.hit({ x: p.cx() - 30, y: p.cy() - 26, w: 70, h: 52, dmg: 12, team: 'foe',
        owner: foe, ttl: 0.05 });
      step(2);
      ok('挡开是单向的：身法无敌穿过敌招也保持静默',
        fxCalls.ring.length === 0 && sfxCalls.length === 0 && p.hp === hp0,
        `ring=${fxCalls.ring.length} sfx=${sfxCalls.length} hp ${hp0}→${p.hp}`);
    }
    { // silent 的 hitbox（无锋）不该冒出挡开的声音
      const p = reset(); step(40);
      p.x = 452; p.y = 328; p.vx = 0; p.vy = 0; p.facing = 1;
      const foe = mkFoe(520); foe.invuln = 1.0;
      reset3();
      SJ.Combat.hit({ x: p.cx() + 10, y: p.cy() - 20, w: 60, h: 44, dmg: 0, team: 'player',
        owner: p, ttl: 0.05, silent: true });
      step(3);
      ok('挡开：silent 的 hitbox（无锋）不出声也不画环',
        fxCalls.ring.length === 0 && sfxCalls.length === 0,
        `ring=${fxCalls.ring.length} sfx=${sfxCalls.length}`);
    }
  } finally { SJ.Game.slowmo = realSlow; SJ.Game.shake = realShake; }
}

// ── 11. 预警分层的绘制（决议 014 修订版）────────────────────
// 修订版的关键约束：**light 必须与改造前逐位相同**。
// 分层往「更重」做（heavy ×1.6 + 端点实心势点、grab 加外圈淡墨），不往「更淡」做——
// 墨线画在墨画的世界里显著性掉一截，而玩家已经学会了「红线 = 来招」。
console.log('\n11. 预警分层 telegraph.tier（决议 014 修订版）');
{
  // 改造前的基线，写成字面量：以后谁把 light 改动了都会立刻亮红。
  const BASE_COL = SJ.C.cinnabar, BASE_W_OBS = 3.4, BASE_W_NOOBS = 2.8;

  // 落点的环是用原生 canvas 弧画的（那里要的是准确的圆，不是墨团），所以得记 arc 半径。
  const gStub = { save: noop, restore: noop, fill: noop,
    fillRect: noop, strokeRect: noop, fillStyle: '', strokeStyle: '',
    globalAlpha: 1, lineWidth: 1,
    arcs: [], _pend: null,
    beginPath() { this._pend = null; },
    arc(x, y, r) { this._pend = r; },
    stroke() { if (this._pend != null) this.arcs.push(this._pend); }
  };
  // prog = 起手进度 0..1。决议 025 那两条都是「随进度变化」的；
  // 不控制进度就只测得到 p≈0 那一帧——正是原来漏掉的地方。
  function paint(o, observing, prog) {
    const p = reset(); step(20);
    p.x = 300; p.y = 328; p.vx = 0; p.vy = 0;
    p.observing = !!observing;
    const foe = mkFoe(500);
    SJ.Combat.clear();
    const tg = SJ.Combat.telegraph(Object.assign({ owner: foe, moveId: 'm', dur: 0.5,
      path: [[0, 0], [-40, -10]] }, o));
    tg.t = (prog === undefined ? 1 : prog) * tg.dur;
    clearCalls();
    gStub.arcs.length = 0;
    SJ.Combat.draw(gStub);
    return { tier: tg.tier, strokes: inkCalls.stroke.slice(), blobs: inkCalls.blob.slice(),
             rings: gStub.arcs.slice() };
  }
  // 主线 = 最粗的那一笔；外圈淡线在 grab 里比主线细（不观势）或更粗但是墨色（观势），
  // 所以按颜色分组比按粗细可靠。
  const main = r => r.strokes.filter(x => x.color === BASE_COL);
  const twin = r => r.strokes.filter(x => x.color === SJ.C.ink);
  const wmax = list => Math.max(...list.map(x => x.w0));

  const dflt = paint({ danger: true }, true);
  ok('不传 tier 缺省 light（向后兼容）', dflt.tier === 'light', dflt.tier);
  ok('tier 拼错时退回 light，不静默变成别的画法',
    paint({ danger: true, tier: 'BOGUS' }, true).tier === 'light');

  const light = paint({ danger: true, tier: 'light' }, true);
  const heavy = paint({ danger: true, tier: 'heavy' }, true);
  const grab = paint({ danger: true, tier: 'grab' }, true);

  // ★ 修订版的核心：light 逐位等于改造前
  ok('light 与改造前逐位相同：朱砂、线宽 3.4、单笔（观势）',
    light.strokes.length === 1 && light.strokes[0].color === BASE_COL &&
    Math.abs(light.strokes[0].w0 - BASE_W_OBS) < 1e-9 && light.blobs.length === 0,
    `${light.strokes.length}笔 ${light.strokes[0].color} w0=${light.strokes[0].w0}`);
  ok('不传 tier 时画出来的东西与 light 完全一致（「不传参画面不变」）',
    dflt.strokes.length === light.strokes.length &&
    dflt.strokes[0].color === light.strokes[0].color &&
    dflt.strokes[0].w0 === light.strokes[0].w0 && dflt.blobs.length === 0);

  ok('heavy 仍是朱砂（不是墨线）', wmax(main(heavy)) > 0 && main(heavy).length >= 1 &&
    heavy.strokes.every(x => x.color === BASE_COL), heavy.strokes.map(x => x.color).join(','));
  ok('heavy 线宽 ×1.6', Math.abs(wmax(main(heavy)) / BASE_W_OBS - 1.6) < 1e-9,
    (wmax(main(heavy)) / BASE_W_OBS).toFixed(3));
  ok('heavy 在路径端点画一个实心朱砂「势」点（0.3s 内真正拉得开的就是这个）',
    heavy.blobs.length === 1 && heavy.blobs[0].o.color === SJ.C.cinnabar &&
    heavy.blobs[0].r > 4, JSON.stringify(heavy.blobs.map(b => [b.r.toFixed(1), b.o.color])));
  ok('light / grab 都不画势点（势点是 heavy 独有的信号）',
    light.blobs.length === 0 && grab.blobs.length === 0,
    `light=${light.blobs.length} grab=${grab.blobs.length}`);

  ok('grab = 朱砂主线 + 外圈淡墨线（双线）',
    main(grab).length === 1 && twin(grab).length === 1 &&
    Math.abs(wmax(main(grab)) - BASE_W_OBS) < 1e-9,
    `主线 ${main(grab).length}(w=${wmax(main(grab))}) 外圈 ${twin(grab).length}`);
  ok('grab 的主线粗细与 light 相同（分层靠外圈那条，不靠加粗）',
    Math.abs(wmax(main(grab)) - wmax(main(light))) < 1e-9);

  // 守势型（守阁人）不吃 tier
  const guardTg = paint({ danger: false, tier: 'heavy' }, true);
  ok('danger:false 的守势起手式不吃 tier：石青、线宽不变、无势点',
    guardTg.strokes.length === 1 && guardTg.strokes[0].color === SJ.C.stone &&
    Math.abs(guardTg.strokes[0].w0 - BASE_W_OBS) < 1e-9 && guardTg.blobs.length === 0,
    guardTg.strokes[0].color + ' w=' + guardTg.strokes[0].w0);
  const custom = paint({ danger: true, tier: 'heavy', color: '#123456' }, true);
  ok('显式 o.color 仍然压过 tier（bosses.js 在用）',
    custom.strokes.some(x => x.color === '#123456'),
    custom.strokes.map(x => x.color).join(','));

  // 不观势的断续画法也要分层：否则「0.3s 内决定挡还是闪」在最需要它的时候不存在
  const nlight = paint({ danger: true, tier: 'light' }, false);
  const nheavy = paint({ danger: true, tier: 'heavy' }, false);
  const ngrab = paint({ danger: true, tier: 'grab' }, false);
  ok('不观势时 light 也与改造前逐位相同（朱砂、w0=2.8、单层）',
    nlight.strokes.every(x => x.color === BASE_COL &&
      Math.abs(x.w0 - BASE_W_NOOBS) < 1e-9) && nlight.blobs.length === 0,
    `${nlight.strokes.length}笔 w0=${nlight.strokes[0].w0}`);
  ok('不观势时 heavy 仍是朱砂 ×1.6 且带势点',
    Math.abs(wmax(main(nheavy)) / BASE_W_NOOBS - 1.6) < 1e-9 && nheavy.blobs.length === 1,
    `×${(wmax(main(nheavy)) / BASE_W_NOOBS).toFixed(2)} blob=${nheavy.blobs.length}`);
  // 断续画法每段按 hash 随机丢弃，不同 telegraph id 丢的段不一样，
  // 所以不能拿两次调用的总笔数相比。在同一次调用里数配对。
  // ── 决议 025 ①：势点提前长出来 ──
  {
    const at = q => paint({ danger: true, tier: 'heavy' }, false, q);
    ok('势点在 p<0.25 时不画（起手最初那一段还看不出轻重，是有意的）',
      at(0).blobs.length === 0 && at(0.24).blobs.length === 0,
      `p0=${at(0).blobs.length} p0.24=${at(0.24).blobs.length}`);
    const b25 = at(0.25).blobs[0], b60 = at(0.60).blobs[0], b100 = at(1).blobs[0];
    ok('势点从 p=0.25 起就已经看得见（不是淡到看不见地淡入）',
      !!b25 && b25.r >= 4.5 && b25.o.alpha >= 0.42,
      b25 ? `r=${b25.r.toFixed(2)} a=${b25.o.alpha.toFixed(2)}` : '没画');
    const d1 = b60.r - b25.r, d2 = b100.r - b60.r;
    ok('势点半径按进度线性长满（0.25→1 之间等速）',
      Math.abs(d1 / 0.35 - d2 / 0.40) < 1e-6 && b100.r > b25.r * 1.9,
      `r ${b25.r.toFixed(2)} → ${b60.r.toFixed(2)} → ${b100.r.toFixed(2)}`);
    const w0 = Math.max(...at(0).strokes.filter(x => x.color === BASE_COL).map(x => x.w0));
    const w1 = Math.max(...at(1).strokes.filter(x => x.color === BASE_COL).map(x => x.w0));
    ok('heavy 的线宽 ×1.6 从起手第一帧就生效、且不随进度变',
      Math.abs(w0 - BASE_W_NOOBS * 1.6) < 1e-9 && Math.abs(w0 - w1) < 1e-9,
      `p0=${w0} p1=${w1}`);
  }

  // ── 决议 025 ②：grab 落点外环半径下限 ──
  {
    const rings = q => paint({ danger: true, tier: 'grab' }, true, q).rings;
    const outerMin = Math.min(...[0.85, 0.9, 0.95, 1].map(q => Math.max(...rings(q))));
    ok('grab 落点外环半径始终 ≥22px（短路径全靠这两个环，塌了就读不出来）',
      outerMin >= 22 - 1e-9, `末段最小外环 ${outerMin.toFixed(1)}px`);
    const g1 = rings(1), l1 = paint({ danger: true, tier: 'light' }, true, 1).rings;
    ok('grab 画的是双环，light 只有一环',
      g1.length === l1.length + 1, `grab=${g1.length} light=${l1.length}`);
    ok('末段两环仍然分得开（间距 ≥12px）',
      Math.max(...g1) - Math.min(...g1) >= 12,
      `${Math.min(...g1).toFixed(1)} → ${Math.max(...g1).toFixed(1)}`);
  }

  ok('不观势时 grab 每一段朱砂主线都配一条淡墨外圈',
    main(ngrab).length > 0 && main(ngrab).length === twin(ngrab).length &&
    ngrab.strokes.length === main(ngrab).length * 2,
    `主线 ${main(ngrab).length} / 外圈 ${twin(ngrab).length}`);
}

// ── 12. 招式进度入存档（决议 016）──────────────────────────
console.log('\n12. techProgress 存档');
{
  // 12a. 进度写得进存档结构
  reset(); step(10);
  SJ.Tech.gain('hengyun', 40);
  ok('gain 之后 Save.data.techProgress 跟着更新',
    SJ.Save.data.techProgress && SJ.Save.data.techProgress.hengyun === 40,
    JSON.stringify(SJ.Save.data.techProgress));
  SJ.Save.save();
  const raw = STORE['shuojian'];
  ok('techProgress 真的落到了 localStorage 里',
    !!raw && JSON.parse(raw).techProgress.hengyun === 40, String(raw).slice(0, 90));

  // 12b. **换一个 vm 沙盒**读同一份存档 —— 这才等价于「关掉浏览器再打开」
  function freshSJ(store) {
    const w2 = { addEventListener: noop, removeEventListener: noop, devicePixelRatio: 1,
      innerWidth: 960, innerHeight: 540, requestAnimationFrame: () => 0,
      localStorage: mkStore(store) };
    w2.window = w2;
    const c2 = vm.createContext(Object.assign(w2, { window: w2,
      document: { addEventListener: noop, hidden: false }, console, Math, Date, JSON,
      isNaN, parseInt, parseFloat, performance: { now: () => Date.now() },
      localStorage: w2.localStorage }));
    for (const rel of ['src/core/const.js', 'src/core/save.js', 'src/combat/tech.js']) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), c2, { filename: rel });
    }
    return c2.window.SJ;
  }
  const sj2 = freshSJ(STORE);
  ok('新沙盒里 Tech.progress 初始为空（不是继承了什么）',
    Object.keys(sj2.Tech.progress).length === 0);
  sj2.Save.load();
  ok('新沙盒载入存档 → 残墨进度仍然是 40',
    sj2.Tech.progress.hengyun === 40, JSON.stringify(sj2.Tech.progress));
  ok('adoptProgress 是拷贝不是别名（resetProgress 后两边不会指向同一个孤儿对象）',
    sj2.Tech.progress !== sj2.Save.data.techProgress);

  // 12c. 旧档兼容：玩家现有的存档里根本没有这个字段
  const OLD = {};
  OLD['shuojian'] = JSON.stringify({ chapter: 3, hp: 40, maxHp: 60, known: ['poyu'],
    slots: ['poyu', null, null, null], mercy: {}, flags: {}, deaths: 2, playtimeSec: 900 });
  const sj3 = freshSJ(OLD);
  let threw = null;
  try { sj3.Save.load(); } catch (e) { threw = e; }
  ok('旧档（没有 techProgress）载入不抛异常', threw === null, threw && threw.message);
  ok('旧档载入后 techProgress 为 {}，其余字段照常读到',
    threw === null && JSON.stringify(sj3.Save.data.techProgress) === '{}' &&
    sj3.Save.data.chapter === 3 && sj3.Save.data.known[0] === 'poyu',
    JSON.stringify(sj3.Save.data.techProgress));
  ok('旧档载入后 Tech.progress 也是空的，不是 undefined',
    threw === null && sj3.Tech.progress && Object.keys(sj3.Tech.progress).length === 0);

  // 12d. 损坏的字段不能把游戏带崩（存档是玩家能手改的）
  const BAD = {};
  BAD['shuojian'] = JSON.stringify({ chapter: 1, known: [], slots: [null, null, null, null],
    techProgress: { poyu: 'x', liebo: 999, hengyun: 42 } });
  const sj4 = freshSJ(BAD);
  let threw4 = null;
  try { sj4.Save.load(); } catch (e) { threw4 = e; }
  ok('存档里的 techProgress 被改坏也不抛，且非法值被丢掉、越界值被夹住',
    threw4 === null && sj4.Tech.progress.poyu === undefined &&
    sj4.Tech.progress.liebo === 100 && sj4.Tech.progress.hengyun === 42,
    JSON.stringify(sj4 && sj4.Tech.progress));

  // 12e. resetProgress 清存档字段，但不许凭空造出一个存档
  const NEW = {};
  const sj5 = freshSJ(NEW);
  sj5.Save.reset();
  sj5.Tech.progress.poyu = 50;
  sj5.Tech.resetProgress();
  ok('resetProgress 同时清掉 Save.data.techProgress（决议 016）',
    JSON.stringify(sj5.Save.data.techProgress) === '{}' &&
    Object.keys(sj5.Tech.progress).length === 0);
  ok('「始」之后 resetProgress 不会凭空写出一个存档（否则标题的「继」会亮起来）',
    sj5.Save.exists() === false, JSON.stringify(NEW));

  // 12f. 学会一招之后，进度 100 也要在存档里（不然重开会重新播一次「悟」）
  const sj6 = freshSJ({});
  sj6.Tech.progress = {};
  sj6.Save.data.known = [];
  sj6.Save.data.slots = [null, null, null, null];
  sj6.Tech.progress.tiyun = 100;
  sj6.Save.data.techProgress = { tiyun: 100 };
  sj6.Save.save();
  const sj7 = freshSJ({ shuojian: sj6.Save ? JSON.stringify(sj6.Save.data) : '' });
  sj7.Save.load();
  ok('已满 100 的进度也存得住', sj7.Tech.progress.tiyun === 100,
    JSON.stringify(sj7.Tech.progress));

  reset();   // 后面没有别的段落了，但别把脏状态留给以后新增的断言
}

// ── 13. 命中墨溅去对称（fx.js 的 aniso 管道，端到端）──────────
// **验效果，不验调用。** 只断言「我传了 aniso」是没有意义的：
// 上一轮 combat.js 差点就往一个根本不读这个字段的 FX.splash 上传参数，
// 断言会绿，效果静默消失 —— 决议 013 那个形状。
// 所以这一段换上**真的 fx.js**，把整条链走完：
//   combat.js 出手 → FX.splash 造墨滴 → 墨滴飞 → 落到 groundY → stain 那一帧
// 最后看 Ink.splat 到底有没有拿到 aniso 与方向。
console.log('\n13. 命中墨溅去对称（端到端）');
{
  load('src/render/fx.js');                 // 真货，替掉本文件前面那个记录用的打桩
  const splats = [], blobs2 = [];
  SJ.Ink = new Proxy({
    splat: (g, x, y, r, seed, o) => { splats.push({ x, y, r, o: o || {} }); },
    blob: (g, x, y, r, seed, o) => { blobs2.push({ x, y, r, o: o || {} }); }
  }, { get: (t, k) => (k in t ? t[k] : noop) });
  const gStub = new Proxy({}, {
    get: (t, k) => {
      if (k === 'canvas') return { width: 960, height: 540 };
      if (['fillStyle', 'strokeStyle', 'globalAlpha', 'lineWidth', 'lineCap', 'lineJoin',
           'font', 'textAlign', 'textBaseline', 'globalCompositeOperation'].indexOf(k) >= 0) return '';
      return () => undefined;
    }, set: () => true
  });

  // 走一次真的普攻命中，再手动把粒子推到落地那一帧
  function land(facing, foeX) {
    const p = reset(); step(40);
    p.x = 452; p.y = 328; p.vx = 0; p.vy = 0; p.facing = facing;
    const foe = mkFoe(foeX); foe.hurt = function (d) { this.hp -= d; };
    SJ.FX.clear();
    down('KeyJ'); step(1); up('KeyJ'); step(10);
    // 30 帧：墨滴飞到地面线 380 之后、stain 的 2.0s 寿命还没走完的窗口。
    // 推太久（150 帧）stain 已经过期消失，测出来是「一次都没画」——
    // 症状和「管道没通」一模一样，但原因完全不同。
    for (let i = 0; i < 30; i++) SJ.FX.update(1 / 60);
    splats.length = 0; blobs2.length = 0;
    SJ.FX.draw(gStub);
    return splats.slice();
  }

  const right = land(1, 520);
  ok('命中的墨点真的落到地面并晕开（走到了 stain 那一帧）', right.length > 0,
    `splat ${right.length} 次 / blob ${blobs2.length} 次`);
  ok('stain 还在寿命内就取样（推过头会测出「一次都没画」，症状和管道没通一样）',
    right.length > 0 && blobs2.length >= 0);
  ok('落地那一摊走的是 Ink.splat 的去对称分支，且 aniso 就是 combat.js 传的 0.7',
    right.length > 0 && right.every(c => c.o.aniso === 0.7),
    JSON.stringify(right.map(c => c.o.aniso)));
  // 方向必须等于 splash 的第三个位置参数（sprayAngle：向右打 = -0.6）——
  // 这一条钉的是「一个方向语义只有一个来源」，谁哪天再加个 o.dir 入口就会亮红。
  ok('去对称的方向 = splash 的 base 弧度（向右打 -0.6），没有第二个方向来源',
    right.every(c => Math.abs(c.o.dir - (-0.6)) < 1e-9),
    JSON.stringify(right.map(c => c.o.dir)));

  const left = land(-1, 402);
  ok('向左打时方向跟着翻到另一侧（两侧异号，决议 013 那条的延伸）',
    left.length > 0 && left.every(c => Math.cos(c.o.dir) < -0.5),
    JSON.stringify(left.map(c => c.o.dir.toFixed(2))));

  { // aniso=0 的老调用点必须一个像素都不变：走 blob，不走 splat
    SJ.FX.clear();
    SJ.FX.splash(400, 300, -0.6, { n: 4, groundY: 380 });
    for (let i = 0; i < 30; i++) SJ.FX.update(1 / 60);
    splats.length = 0; blobs2.length = 0;
    SJ.FX.draw(gStub);
    ok('不传 aniso 的调用点照旧走 Ink.blob，不走 splat（向后兼容）',
      splats.length === 0 && blobs2.length > 0,
      `splat=${splats.length} blob=${blobs2.length}`);
  }

  { // 受击与死亡两处（player.js）也开了，且各是各的强度
    const src = fs.readFileSync(path.join(ROOT, 'src/entity/player.js'), 'utf8');
    ok('受击 aniso 0.5 / 死亡 aniso 0.8 都接上了',
      /aniso: 0\.5/.test(src) && /aniso: 0\.8/.test(src));
  }
}

// ── 结果 ─────────────────────────────────────────────────────
console.log('\n' + (fail === 0
  ? '\x1b[32m全部通过\x1b[0m  ' + pass + ' 项'
  : '\x1b[31m失败 ' + fail + ' 项\x1b[0m（通过 ' + pass + '）') + '\n');
process.exit(fail === 0 ? 0 : 1);
