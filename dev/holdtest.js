const fs=require('fs'), path=require('path');
const head=fs.readFileSync(path.join(__dirname,'smoke.js'),'utf8').split('/* ══ 第二阶段')[0]
  .replace(/process\.exit\([^)]*\);?/g,'').replace(/console\.log\(errors[\s\S]*$/,'');
eval(head + '\nglobalThis.__sb={SJ:SJ,mainCanvas:mainCanvas};');
const SJ=globalThis.__sb.SJ, mainCanvas=globalThis.__sb.mainCanvas;
const g=mainCanvas.getContext('2d');
try{SJ.Audio.init();}catch(e){}
SJ.Game.init(mainCanvas);
/* 真实 Input 语义：held 表示按住；pressed 只在按下那一帧为真；
   buffered 走真实实现无法模拟，这里模拟「按住不放」= 只有第一帧 pressed */
const held={},pressedOnce={},I=SJ.Input;
I.down=a=>!!held[a];
I.pressed=a=>!!pressedOnce[a];
I.released=()=>false;
I.buffered=a=>!!pressedOnce[a];      // 按住不放 → 只有首帧算一次按下
I.consume=a=>{pressedOnce[a]=false;};
I.axis=()=>(held.left?-1:0)+(held.right?1:0);
I.any=()=>true; I.update=()=>{};
const F=n=>{for(let i=0;i<n;i++){SJ.Game._step(1/60);SJ.Game._render(g);for(const k in pressedOnce)pressedOnce[k]=false;}};

SJ.Level.load(1);
// 弹掉开场对话
for(let i=0;i<400 && (SJ.Game.stack||SJ.Game._stack||[]).length>1;i++){ pressedOnce.confirm=true; SJ.Game._step(1/60); SJ.Game._render(g); pressedOnce.confirm=false; }
const p=SJ.player;
function scene(label, setup, frames){
  for(const k in held)delete held[k]; for(const k in pressedOnce)pressedOnce[k]=false;
  setup();
  const x0=p.x;
  F(frames);
  console.log(`${label.padEnd(26)} Δx=${(p.x-x0).toFixed(1).padStart(7)} x=${p.x.toFixed(0).padStart(5)} y=${p.y.toFixed(0).padStart(4)} vx=${p.vx.toFixed(1).padStart(6)} onG=${p.onGround?1:0} hp=${p.hp} st=${p.state} 栈=${(SJ.Game.stack||[]).length} 顶=${((SJ.Game.stack||[])[(SJ.Game.stack||[]).length-1]||{}).name||'?'} atkIdx=${p.atkIdx} atkT=${(p.atkT===undefined?-1:p.atkT).toFixed(2)}`);
}
console.log('--- 基准 ---');
scene('只按右 120帧', ()=>{held.right=true;}, 120);
console.log('--- 攻击键相关 ---');
scene('按住攻击不放 180帧', ()=>{held.attack=true;pressedOnce.attack=true;}, 180);
scene('按住攻击+右 180帧', ()=>{held.attack=true;pressedOnce.attack=true;held.right=true;}, 180);
console.log('--- 松开攻击后能否恢复 ---');
scene('松手后只按右 120帧', ()=>{held.right=true;}, 120);
console.log('--- 连点攻击（每 6 帧一次）---');
for(const k in held)delete held[k]; held.right=true;
const x0=p.x;
for(let i=0;i<300;i++){ if(i%6===0){pressedOnce.attack=true;} SJ.Game._step(1/60); SJ.Game._render(g); for(const k in pressedOnce)pressedOnce[k]=false; }
console.log(`连点攻击+右 300帧            Δx=${(p.x-x0).toFixed(1).padStart(7)}  state=${p.state}`);

console.log('--- 卡住后狂按确认键 300 帧 ---');
for(const k in held)delete held[k];
for(let i=0;i<300;i++){ pressedOnce.confirm=true; pressedOnce.attack=true; SJ.Game._step(1/60); SJ.Game._render(g); for(const k in pressedOnce)pressedOnce[k]=false; }
console.log(`按完确认后 栈=${(SJ.Game.stack||[]).length} x=${p.x.toFixed(0)} st=${p.state}`);
held.right=true;
const xA=p.x; F(120);
console.log(`再按右 120 帧  Δx=${(p.x-xA).toFixed(1)}  x=${p.x.toFixed(0)} st=${p.state}`);
