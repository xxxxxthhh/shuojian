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
const listeners = {};
const win = {
  addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
  removeEventListener: () => {},
  devicePixelRatio: 1, innerWidth: 960, innerHeight: 540,
  requestAnimationFrame: () => 0,
  localStorage: (() => { const m = {}; return {
    getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; } }; })()
};
win.window = win;
const doc = { addEventListener: () => {}, hidden: false };
const ctx = vm.createContext(Object.assign(win, {
  window: win, document: doc, console, Math, Date, JSON, Object, Array, String,
  Number, Boolean, isNaN, parseInt, parseFloat, performance: { now: () => Date.now() },
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
SJ.Ink = new Proxy({}, { get: () => noop });
SJ.Figure = { draw: noop, blend: (a) => a, tip: () => ({ x: 0, y: 0 }),
              pose: (n) => ({ name: n, hipY: 0, lean: 0, headAng: 0, neck: 0, spine: 0,
                armF: [0, 0], armB: [0, 0], legF: [0, 0], legB: [0, 0],
                wristF: 0, weaponLen: 1 }) };
const fxCalls = { splash: [] };
SJ.FX = new Proxy({ splash: (x, y, dir, o) => { fxCalls.splash.push({ x, y, dir, o: o || {} }); } },
  { get: (t, k) => (k in t ? t[k] : noop) });
SJ.Audio = { init: noop, ready: false, sfx: noop, music: noop, intensity: noop,
             duck: noop, setMute: noop, muted: false };

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

// ── 结果 ─────────────────────────────────────────────────────
console.log('\n' + (fail === 0
  ? '\x1b[32m全部通过\x1b[0m  ' + pass + ' 项'
  : '\x1b[31m失败 ' + fail + ' 项\x1b[0m（通过 ' + pass + '）') + '\n');
process.exit(fail === 0 ? 0 : 1);
