/* 无头冒烟测试（Lead）：按 index.html 的真实顺序加载全部脚本，
 * 用 canvas / audio / storage 替身，真的跑帧，抓集成错误。
 * 用法: node dev/smoke.js [关卡号]   退出码非 0 = 失败 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

const errors = [], warns = [];
function fail(m){ errors.push(m); }

/* ── canvas 2D 替身：任何方法都接受，返回合理默认值 ── */
function makeCtx() {
  const grad = { addColorStop(){} };
  const base = {
    canvas: null, save(){}, restore(){}, beginPath(){}, closePath(){},
    moveTo(){}, lineTo(){}, quadraticCurveTo(){}, bezierCurveTo(){}, arc(){}, arcTo(){},
    rect(){}, ellipse(){}, fill(){}, stroke(){}, clip(){}, fillRect(){}, strokeRect(){},
    clearRect(){}, translate(){}, rotate(){}, scale(){}, transform(){}, setTransform(){},
    resetTransform(){}, drawImage(){}, fillText(){}, strokeText(){}, setLineDash(){},
    getLineDash(){ return []; }, createLinearGradient(){ return grad; },
    createRadialGradient(){ return grad; }, createPattern(){ return null; },
    measureText(t){ return { width: (t ? String(t).length : 0) * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }; },
    getImageData(x,y,w,h){ return { data: new Uint8ClampedArray(Math.max(1,w*h*4)), width:w, height:h }; },
    putImageData(){}, createImageData(w,h){ return { data:new Uint8ClampedArray(Math.max(1,w*h*4)), width:w, height:h }; },
    isPointInPath(){ return false; },
  };
  return new Proxy(base, {
    get(t,k){ if (k in t) return t[k]; return undefined; },
    set(t,k,v){ t[k]=v; return true; }
  });
}
function makeCanvas(w,h){
  const c = { width:w||300, height:h||150, style:{}, dataset:{},
    getContext(){ return this._ctx || (this._ctx = (function(x){ const c2=makeCtx(); c2.canvas=x; return c2; })(this)); },
    toDataURL(){ return 'data:image/png;base64,'; },
    addEventListener(){}, removeEventListener(){}, focus(){},
    getBoundingClientRect(){ return {left:0,top:0,width:this.width,height:this.height,right:this.width,bottom:this.height}; },
  };
  return c;
}

/* ── DOM / window 替身 ── */
const listeners = {};
const el = () => ({ style:{}, dataset:{}, classList:{add(){},remove(){},toggle(){}},
  appendChild(){}, removeChild(){}, addEventListener(){}, removeEventListener(){},
  setAttribute(){}, getAttribute(){ return null; }, focus(){}, remove(){},
  getBoundingClientRect(){ return {left:0,top:0,width:960,height:540,right:960,bottom:540}; },
  querySelector(){ return null; }, querySelectorAll(){ return []; }, textContent:'', innerHTML:'' });

const mainCanvas = makeCanvas(960,540);
const store = {};
const sandbox = {
  console,
  performance: { now: () => Date.now() },
  requestAnimationFrame(){ return 1; },   // 手动驱动，不自动跑
  cancelAnimationFrame(){},
  setTimeout(){ return 1; }, clearTimeout(){}, setInterval(){ return 1; }, clearInterval(){},
  devicePixelRatio: 2,
  innerWidth: 1440, innerHeight: 900,
  localStorage: { getItem:k=>(k in store?store[k]:null), setItem:(k,v)=>{store[k]=String(v);},
                  removeItem:k=>{delete store[k];}, clear(){for(const k in store)delete store[k];} },
  addEventListener(t,f){ (listeners[t]=listeners[t]||[]).push(f); },
  removeEventListener(){},
  Image: function(){ return { addEventListener(){}, set src(v){}, width:1, height:1 }; },
  AudioContext: function(){ throw new Error('no audio in smoke'); },
  Math, Date, JSON, Object, Array, String, Number, Boolean, Error, RegExp,
  Uint8ClampedArray, Float32Array, Set, Map, Promise, isNaN, isFinite, parseInt, parseFloat,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.document = {
  createElement(t){ return t === 'canvas' ? makeCanvas(300,150) : el(); },
  getElementById(id){ return (id === 'sj' || id === 'game' || id === 'cv') ? mainCanvas : el(); },
  querySelector(s){ return /canvas/.test(s) ? mainCanvas : el(); },
  querySelectorAll(){ return []; },
  addEventListener(t,f){ (listeners[t]=listeners[t]||[]).push(f); },
  removeEventListener(){}, body: el(), documentElement: el(),
  hidden: false, visibilityState: 'visible', fonts: { ready: Promise.resolve() },
};
vm.createContext(sandbox);

/* ── 按 index.html 的真实顺序加载 ── */
const html = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]);
if (!srcs.length) fail('index.html 里没有找到 script 标签');
let loaded = 0;
for (const s of srcs) {
  const p = path.join(ROOT, s);
  if (!fs.existsSync(p)) { fail(`缺文件: ${s}`); continue; }
  try { vm.runInContext(fs.readFileSync(p,'utf8'), sandbox, { filename: s }); loaded++; }
  catch (e) { fail(`加载 ${s} 抛异常: ${e.message}`); }
}
const SJ = sandbox.SJ;
if (!SJ) { console.log('✗ SJ 未定义，无法继续'); process.exit(1); }

/* ── 契约符号存在性 ── */
const need = {
  'SJ.Input': ['init','update','down','pressed','released','buffered','consume','axis'],
  'SJ.Game': ['init','setScene','slowmo','shake','flash','fade','push','pop'],
  'SJ.Camera': ['setBounds','follow','snap','apply','restore'],
  'SJ.World': ['load','moveX','moveY','groundAt','lineBlocked'],
  'SJ.Ent': ['add','remove','each','by','clear','updateAll','drawAll'],
  'SJ.Save': ['load','save','reset'],
  'SJ.Ink': ['paper','stroke','line','blob','splat','wash','mountains','bamboo','water','rain','snow','lantern','seal','vtext','htext','brushReveal'],
  'SJ.Figure': ['draw','pose','blend','tip'],
  'SJ.FX': ['burst','splash','slash','ring','word','dust','update','draw','drawScreen','clear'],
  'SJ.Audio': ['init','sfx','music','intensity','duck','setMute'],
  'SJ.Scenery': ['draw'],
  'SJ.Combat': ['hit','telegraph','update','draw','clear','TIER:obj'],
  'SJ.Tech': ['can','use','update','gain','learn'],
  'SJ.Player': ['create','setSlot','envForce','inkTint'],
  'SJ.Enemies': ['spawn'], 'SJ.Bosses': ['spawn'],
  'SJ.Story': ['play','chapterCard','mercyChoice','ending'],
  'SJ.HUD': ['draw'], 'SJ.Menu': ['title','pause','gameover','ending'],
  'SJ.Level': ['load','checkpoint','complete','bossDefeated','restartFromCheckpoint'],
};
let symOk=0, symBad=0;
for (const ns in need) {
  const obj = ns.split('.').slice(1).reduce((o,k)=>o&&o[k], SJ);
  if (!obj) { fail(`${ns} 不存在`); symBad += need[ns].length; continue; }
  for (const sym of need[ns]) {
    // 'name' 要求是函数；'name:obj' 要求是对象（只读表，如 Combat.TIER）
    const [fn, kind] = sym.split(':');
    const v = obj[fn];
    const ok = kind === 'obj' ? (v && typeof v === 'object') : typeof v === 'function';
    if (ok) symOk++;
    else { fail(`${ns}.${fn} 缺失或不是${kind === 'obj' ? '对象' : '函数'}`); symBad++; }
  }
}
if (!Array.isArray(SJ.Levels) || SJ.Levels.length !== 8) fail(`SJ.Levels 应有 8 关，实际 ${SJ.Levels&&SJ.Levels.length}`);
if (!SJ.Script || Object.keys(SJ.Script).length < 180) fail('SJ.Script 节点数异常');
const techKeys = (SJ.Tech && SJ.Tech.defs) ? Object.keys(SJ.Tech.defs) : [];
const DESIGN12 = ['hengyun','liebo','chengtian','guying','wufeng','lianhuan','poyu','chuanyang','zhenshan','tiyun','fenshu','shuojian'];
const missing12 = DESIGN12.filter(k => !techKeys.includes(k));
if (missing12.length) fail('DESIGN §6 的招缺失: ' + missing12.join(','));
console.log(`Tech.defs   : ${techKeys.length} 个 key -> ${techKeys.join(' ')}`);

console.log(`加载脚本   : ${loaded}/${srcs.length}`);
console.log(`契约符号   : ${symOk} 通过 / ${symBad} 失败`);
console.log(`关卡 ${SJ.Levels?SJ.Levels.length:0} 关 · 剧本 ${SJ.Script?Object.keys(SJ.Script).length:0} 节点 · 招式 ${SJ.Tech&&SJ.Tech.defs?Object.keys(SJ.Tech.defs).length:0} 招`);

/* ══ 第二阶段：真的跑帧 ══════════════════════════════════════
 * 加载成功 ≠ 跑得起来。逐关 load 后驱动 _step/_render，抓运行时异常。 */
const FRAMES = Number(process.argv[3] || 240);
const only = process.argv[2] !== undefined ? Number(process.argv[2]) : null;
let ran = 0, drew = 0;

try { SJ.Audio.init(); } catch (e) { /* 冒烟环境无 AudioContext，预期 */ }
try { SJ.Game.init(mainCanvas); } catch (e) { fail('Game.init 抛异常: ' + e.message); }

const g = mainCanvas.getContext('2d');
for (let i = 0; i < SJ.Levels.length; i++) {
  if (only !== null && i !== only) continue;
  const id = SJ.Levels[i].id;
  try { SJ.Level.load(i); }
  catch (e) { fail(`第${i}关(${id}) load 抛异常: ${e.message}`); continue; }

  let stepErr = null, drawErr = null;
  for (let f = 0; f < FRAMES; f++) {
    if (!stepErr) { try { SJ.Game._step(1/60); ran++; } catch (e) { stepErr = `f${f}: ${e.message}`; } }
    if (!drawErr) { try { SJ.Game._render(g); drew++; } catch (e) { drawErr = `f${f}: ${e.message}`; } }
    if (stepErr && drawErr) break;
  }
  if (stepErr) fail(`第${i}关(${id}) update 抛异常 @${stepErr}`);
  if (drawErr) fail(`第${i}关(${id}) draw 抛异常 @${drawErr}`);
  if (!stepErr && !drawErr) console.log(`  第${i}关 ${id.padEnd(4)} 跑 ${FRAMES} 帧 · update ✓ draw ✓`);
}
console.log(`累计 step ${ran} 帧 / render ${drew} 帧`);

/* ══ 第三阶段：随机输入猴子测试 ══════════════════════════════
 * 站着不动跑通 ≠ 玩得起来。用确定性伪随机接管输入，压移动/攻击/观势/招式/地形/触发。 */
if (only === null) {
  let seed = 20260907;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const ACTS = ['left','right','up','down','jump','attack','guard','dash','t1','t2','t3','t4','interact','confirm'];
  const held = {}, edge = {};
  const I = SJ.Input;
  I.down = a => !!held[a];
  I.pressed = a => !!edge[a];
  I.released = () => false;
  I.buffered = a => !!held[a] || !!edge[a];
  I.consume = () => {};
  I.axis = () => (held.left ? -1 : 0) + (held.right ? 1 : 0);
  I.any = () => true;
  I.update = () => {};

  const MFRAMES = Number(process.env.MONKEY_FRAMES || 3600);
  let monkeyErr = 0;
  for (let i = 0; i < SJ.Levels.length; i++) {
    const id = SJ.Levels[i].id;
    try { SJ.Level.load(i); } catch (e) { fail(`猴子: 第${i}关 load 抛异常 ${e.message}`); continue; }
    for (const k in held) delete held[k];
    let err = null, xMin = Infinity, xMax = -Infinity;
    for (let f = 0; f < MFRAMES && !err; f++) {
      const pp = SJ.player;
      if (pp) { if (pp.x < xMin) xMin = pp.x; if (pp.x > xMax) xMax = pp.x; }
      for (const a of ACTS) { edge[a] = false; }
      if (f % 3 === 0) {
        const a = ACTS[(rnd() * ACTS.length) | 0];
        if (rnd() < 0.5) { held[a] = !held[a]; if (held[a]) edge[a] = true; }
        else edge[a] = true;
      }
      try { SJ.Game._step(1/60); SJ.Game._render(g); }
      catch (e) { err = `f${f}: ${e.message}`; }
    }
    if (err) { fail(`猴子: 第${i}关(${id}) @${err}`); monkeyErr++; }
    else if (xMax - xMin < 120) {
      // 关键：没抛异常 ≠ 在运行。玩家全程几乎没动，说明画面是冻的。
      fail(`猴子: 第${i}关(${id}) 玩家全程只移动了 ${(xMax-xMin).toFixed(0)}px —— 游戏可能是冻的`);
      monkeyErr++;
    }
    else console.log(`  猴子 第${i}关 ${id.padEnd(4)} ${MFRAMES} 帧(${(MFRAMES/60)|0}s) 随机操作 ✓  玩家位移跨度 ${(xMax-xMin)|0}px`);
  }
  if (!monkeyErr) console.log('猴子测试：八关全部无异常');
}

console.log(errors.length ? '\n✗ 失败：\n  ' + errors.join('\n  ') : '\n✓ 全部通过');
process.exit(errors.length ? 1 : 0);
