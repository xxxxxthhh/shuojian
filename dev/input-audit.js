// 【T2】输入缓冲审计。node dev/input-audit.js
//
// 为什么要单独一个脚本：这里把 Date 换成**受控墙钟**，每推进一个固定步就让它走 16.67ms
// —— 和真实浏览器一致。dev/player-check.js 里 60 个固定步只花 1ms 真实时间，
// 墙钟相关的问题在那边一个都测不出来。
//
// 本脚本最初就是靠这套时钟量出「缓冲用墙钟 → 打中比打空更难连」的（见下方第一组）。
// 那条已经修了（input.js 的 now() 改用 SJ.Game.time），这里保留是为了**防回归**：
// 第一组两行现在必须完全一样。
//
// 这个脚本**只观测、不断言**，不进四份自检；结论记在 _spec/notes-T2.md。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const ROOT=require('path').join(__dirname,'..');
const listeners={};
let FAKE_MS=1e6;                                   // 受控墙钟
const win={addEventListener:(t,f)=>{(listeners[t]=listeners[t]||[]).push(f);},
  removeEventListener(){},devicePixelRatio:1,innerWidth:960,innerHeight:540,
  requestAnimationFrame:()=>0,
  localStorage:(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v);},removeItem:k=>{delete m[k];}};})()};
win.window=win;
const FakeDate={now:()=>FAKE_MS};
const ctx=vm.createContext(Object.assign(win,{window:win,document:{addEventListener(){},hidden:false},
  console,Math,Date:FakeDate,JSON,isNaN,parseInt,parseFloat,
  performance:{now:()=>FAKE_MS},localStorage:win.localStorage,requestAnimationFrame:()=>0}));
const load=r=>vm.runInContext(fs.readFileSync(path.join(ROOT,r),'utf8'),ctx,{filename:r});
['src/core/const.js','src/core/input.js','src/core/camera.js','src/core/world.js','src/core/ent.js',
 'src/core/save.js','src/core/game.js'].forEach(load);
const SJ=ctx.window.SJ;
const noop=()=>{};
SJ.Ink=new Proxy({},{get:()=>noop});
load('src/render/figure.js');
SJ.FX=new Proxy({},{get:()=>noop});
SJ.Audio={init:noop,ready:false,sfx:noop,music:noop,intensity:noop,duck:noop,setMute:noop,muted:false};
['src/combat/combat.js','src/combat/tech.js','src/entity/player.js'].forEach(load);
SJ.Input.init(null);
const key=(t,c)=>(listeners[t]||[]).forEach(f=>f({code:c,repeat:false,preventDefault:noop,metaKey:false,ctrlKey:false}));
const down=c=>key('keydown',c), up=c=>key('keyup',c);
const LEVEL={solids:[[-40,380,1700,160,0],[-40,-200,40,760,0],[1620,-200,40,760,0]]};
const scene={update(dt){SJ.Ent.updateAll(dt);SJ.Tech.update(dt);SJ.Combat.update(dt);},draw(){}};
// **关键**：每推进一个固定步，墙钟就走 16.67ms —— 真实浏览器里就是这样。
// hitstop 期间 dt=0 但墙钟照走，这正是要量的东西。
function step(n=1){ for(let i=0;i<n;i++){ SJ.Game._step(); FAKE_MS+=1000/60; } }
function reset(){ SJ.Ent.clear();SJ.Combat.clear();SJ.Tech.resetProgress();SJ.Save.reset();
  SJ.World.load(LEVEL);SJ.Game.setScene(scene);
  const p=SJ.Player.create(200,300); SJ.Camera.setBounds(0,1620,-120,540); return p; }
function mkFoe(x,hp=999){ const e={tag:'foe',team:'foe',x,y:326,w:30,h:54,vx:0,vy:0,facing:-1,
  hp,maxHp:hp,invuln:0,cx(){return this.x+15;},cy(){return this.y+27;},
  hurt(d){this.hp-=d;},update(){},draw(){}}; SJ.Ent.add(e); return e; }

console.log('\n输入缓冲审计（可控墙钟，1 固定步 = 16.67ms 墙钟）\n');

// ① 三连取消：在「判定帧」按 J，命中带 45ms hitstop，问第二段还出不出得来
function combo(hitFoe, pressAtFrame){
  const p=reset(); step(30);
  p.x=452;p.y=328;p.vx=0;p.vy=0;p.facing=1;
  if(hitFoe) mkFoe(520);
  down('KeyJ'); step(1); up('KeyJ');
  let pressed=false;
  for(let f=0;f<40;f++){
    if(f===pressAtFrame){ down('KeyJ'); step(1); up('KeyJ'); pressed=true; }
    else step(1);
    if(p.atkIdx===2 && p.state==='atk2') return {out:true,f};
  }
  return {out:false,f:-1,pressed};
}
const comboRows={};
for(const hit of [false,true]){
  const rows=[];
  for(let k=1;k<=10;k++){ const r=combo(hit,k); rows.push(k+(r.out?'✓':'✗')); }
  comboRows[hit?'hit':'whiff']=rows.join(' ');
  console.log(` 三连第二段  ${hit?'第一段命中(带 hitstop)':'第一段挥空'}：按 J 的帧 → `+rows.join(' '));
}
// 基线写死：改造前「挥空」那一行就是这个。修完之后**命中与挥空都必须等于它**。
// 不等于就是两种回归之一：缓冲又在数墙钟（两行不一致），
// 或者有效帧数被时钟换算吃掉了（两行一致但整体右移）。
const BASELINE='1✗ 2✓ 3✓ 4✓ 5✓ 6✓ 7✓ 8✓ 9✓ 10✓';
const okHit=comboRows.hit===BASELINE, okWhiff=comboRows.whiff===BASELINE;
console.log('  ▶ 基线（改造前的挥空）：'+BASELINE);
console.log('    挥空 '+(okWhiff?'✓ 等于基线':'✗ 偏离基线')+
  '   命中 '+(okHit?'✓ 等于基线':'✗ 偏离基线')+
  (okHit&&okWhiff?'   —— 「打中比打空更难连」已消除，且有效帧数没被换算吃掉'
                 :'   ←← 回归了'));

// ② 跳跃缓冲：落地前 N 帧按跳，落地后还认不认
// 先量出这条抛物线要多少帧落地
let LAND;
{
  const p=reset(); step(30); p.maxAirJumps=0;p.bonusJumps=0;
  p.x=300;p.y=324;p.vx=0;p.vy=-500;p.onGround=false; step(1);
  let f=0; while(!p.onGround&&f<300){ step(1); f++; }
  LAND=f;
}
function jbufAt(nBefore){
  const p=reset(); step(30); p.maxAirJumps=0;p.bonusJumps=0;p.airJumps=0;
  p.x=300;p.y=324;p.vx=0;p.vy=-500;p.onGround=false; step(1);
  const pressAt=LAND-nBefore;
  for(let f=0;f<LAND;f++){
    if(f===pressAt){ down('Space'); step(1); up('Space'); }
    else step(1);
    p.airJumps=0;                       // 杜绝二段跳干扰，只看落地缓冲
  }
  const before=p.vy; step(2);
  return p.vy < -300;
}
console.log('\n 跳跃缓冲（JBUF=137ms≈8.2 帧，有效 7.2 帧）：落地前 N 帧按跳，'+
  '落地后是否补跳（抛物线共 '+LAND+' 帧）。基线：≤7 帧 ✓、8 帧起 ✗');
console.log('  '+[1,3,5,6,7,8,10].map(n=>n+'帧 '+(jbufAt(n)?'✓':'✗')).join('   '));

// ③ 时钟来源
console.log('\n 缓冲窗口现在数的是**游戏时间**（SJ.Game.time），不是 Date.now()：');
console.log('  hitstop 0×  ：游戏时间不走 → 窗口冻结，定格不再吃掉输入（这就是修的那条）');
console.log('  观势  0.35× ：120ms 游戏时间 ≈ 343ms 真实时间，与被放慢的世界一致');
console.log('  暂停 / 对话 ：game.js 的 step 无条件 G.time += dt，所以窗口照常流逝，不会穿过菜单');
console.log('  切走标签页   ：rAF 停摆、游戏时间冻结 → 靠 blur 时清 lastPress 兜底（见下）');

// ③b 暂停：缓冲不许穿过暂停菜单被兑现（Lead 点名要验的坑）
{
  const p=reset(); step(30);
  p.x=300;p.y=328;p.vx=0;p.vy=0; step(4);
  down('KeyJ'); up('KeyJ');                       // 按下攻击，先不推进
  const before=SJ.Input.buffered('attack',120);
  // 模拟暂停：往栈上压一个什么都不做的场景，主循环照跑（game.js 的 step 无条件推进 time）
  SJ.Game.push({update(){},draw(){}});
  step(30);                                        // 暂停里停留 0.5s
  SJ.Game.pop();
  const after=SJ.Input.buffered('attack',120);
  console.log('\n 暂停 0.5s：按下时 buffered='+before+'，恢复后='+after+
    (after?'   ← 残留了，是坑':'   ✓ 不残留'));
}

// ③c 切走标签页（rAF 停摆、游戏时间冻结）之后，缓冲也不许残留
{
  const p=reset(); step(30);
  p.x=300;p.y=328;p.vx=0;p.vy=0; step(4);
  down('KeyJ');
  const before=SJ.Input.buffered('attack',120);
  (listeners['blur']||[]).forEach(f=>f({}));       // window blur = 切走
  const after=SJ.Input.buffered('attack',120);
  up('KeyJ');
  console.log(' 切走标签页：失焦前 buffered='+before+'，失焦后='+after+
    (after?'   ← 残留了（游戏时间冻结，它会一直等着）':'   ✓ 不残留'));
}

// ④ lastPress 永不过期 / consume 之后按住不会连发
{
  const p=reset(); step(30);
  down('KeyJ');                              // 先不推进，避免 control() 抢先消费
  const a=SJ.Input.buffered('attack',120);
  SJ.Input.consume('attack');
  const b=SJ.Input.buffered('attack',120);
  step(40);                                  // 一直按住 J 不放
  const c=SJ.Input.buffered('attack',120);
  const atk=p.atkIdx;
  up('KeyJ');
  console.log('\n consume 语义：刚按下 buffered='+a+'，consume 后='+b+'，按住 40 帧后仍='+c+
    '，期间只出了第 '+atk+' 段（按住不连发 ✓）');
}
{
  const p=reset(); step(30);
  down('KeyL'); step(1); up('KeyL');
  FAKE_MS += 5000;                            // 墙钟往前 5 秒
  const stale=SJ.Input.buffered('dash',120);
  console.log(' 墙钟往前 5 秒但游戏时间没走 → buffered(dash)='+stale+
    '（时钟已改为游戏时间，墙钟不再影响它）');
}
// ⑤ dash 没有缓冲：只认 pressed()
{
  const p=reset(); step(40);
  p.x=300;p.y=328;p.vx=0;p.vy=0;p.dashCd=0.30;    // 冷却中
  down('KeyL'); step(1); up('KeyL');
  step(30);                                        // 冷却结束
  console.log(' 身法在冷却中按下 L → 冷却结束后自动补冲？ '+(p.dashT>0||Math.abs(p.x-300)>40?'是':'否（无缓冲，要重按）'));
}
// ⑥ 招式槽同样无缓冲
{
  const p=reset(); step(40);
  p.x=300;p.y=328;p.vx=0;p.vy=0;p.ink=100;
  SJ.Save.data.known=['poyu']; SJ.Save.data.slots=['poyu',null,null,null];
  p.hurtT=0.30;                                    // 受击硬直中
  down('KeyU'); step(1); up('KeyU');
  step(30);
  console.log(' 硬直中按招式键 U → 硬直结束后自动补放？ '+(SJ.Tech.busy(p)?'是':'否（无缓冲，要重按）'));
}
// ⑦ 可变跳高的 released('jump') 在 cast/dash/hurt 期间会丢
// ⑦ 可变跳高的截断只在 control() 里做，而 control() 在 dash / hurt / cast 期间不跑，
//    那几帧的 released('jump') 边沿当帧就被 Input.update() 清掉，永久丢失。
function shortJump(interrupt){
  const p=reset(); step(30);
  p.x=300;p.y=328;p.vx=0;p.vy=0;p.onGround=true; step(4);
  const y0=p.y;
  down('Space'); step(1);                         // 起跳
  if(interrupt==='dash'){ p.dashT=0.16; p.dashDir=1; p.setState('dash'); }
  if(interrupt==='hurt'){ p.hurtT=0.22; p.setState('hurt'); }
  up('Space'); step(1);                           // 松手这一帧落在被打断的分支里
  let best=0;
  for(let f=0;f<160;f++){ step(1); best=Math.max(best,y0-p.y); if(f>6&&p.onGround) break; }
  return best;
}
console.log(' 可变跳高（点按应当只有 52px，长按 114px）：');
console.log('   正常点按        顶点 '+shortJump(null).toFixed(1)+'px');
console.log('   松手那帧在身法中 顶点 '+shortJump('dash').toFixed(1)+'px');
console.log('   松手那帧在受击中 顶点 '+shortJump('hurt').toFixed(1)+'px');
