const fs=require('fs'), path=require('path');
const head=fs.readFileSync(path.join(__dirname,'smoke.js'),'utf8').split('/* ══ 第二阶段')[0]
  .replace(/process\.exit\([^)]*\);?/g,'').replace(/console\.log\(errors[\s\S]*$/,'');
eval(head + '\nglobalThis.__sb={SJ:SJ,mainCanvas:mainCanvas};');
const SJ=globalThis.__sb.SJ, mainCanvas=globalThis.__sb.mainCanvas;
const g=mainCanvas.getContext('2d');
try{SJ.Audio.init();}catch(e){}
SJ.Game.init(mainCanvas);
const held={},edge={},I=SJ.Input;
I.down=a=>!!held[a]; I.pressed=a=>!!edge[a]; I.released=()=>false;
I.buffered=a=>!!held[a]||!!edge[a]; I.consume=()=>{};
I.axis=()=>(held.left?-1:0)+(held.right?1:0); I.any=()=>true; I.update=()=>{};
const clearEdge=()=>{for(const k in edge)edge[k]=false;};
const F=n=>{for(let i=0;i<n;i++){SJ.Game._step(1/60);SJ.Game._render(g);clearEdge();}};

SJ.Level.load(Number(process.argv[2]||0));
F(30);
function stk(){ return (SJ.Game.stack||SJ.Game._stack||[]).length; }
console.log('load 后场景栈深度 =', stk());
// 推进剧情直到栈回到 1（对话层弹出）
let guard=0;
while(stk()>1 && guard<400){ edge.confirm=true; SJ.Game._step(1/60); SJ.Game._render(g); clearEdge(); guard++; }
console.log('推进', guard, '帧后栈深度 =', stk());
const p=SJ.player;
console.log(`初始  x=${p.x.toFixed(1)} y=${p.y.toFixed(1)} w=${p.w} h=${p.h} onGround=${p.onGround} state=${p.state}`);
console.log(`地面 groundAt(x)= ${SJ.World.groundAt(p.cx(), p.y)}`);
// 是否嵌在实心块里
const inSolid=SJ.World.solids.filter(s=>!s.oneway && p.x<s.x+s.w && p.x+p.w>s.x && p.y<s.y+s.h && p.y+p.h>s.y);
console.log(`嵌在实心块里: ${inSolid.length?JSON.stringify(inSolid.map(s=>[s.x,s.y,s.w,s.h])):'否'}`);

function tryMove(label,keys,frames){
  for(const k in held)delete held[k];
  const x0=p.x,y0=p.y;
  for(const k of keys) held[k]=true;
  if(keys.includes('jump')) edge.jump=true;
  for(let i=0;i<frames;i++){ if(keys.includes('jump')&&i===0)edge.jump=true; SJ.Game._step(1/60); SJ.Game._render(g); clearEdge(); }
  console.log(`${label.padEnd(14)} Δx=${(p.x-x0).toFixed(1)}  Δy=${(p.y-y0).toFixed(1)}  终点 x=${p.x.toFixed(0)} y=${p.y.toFixed(0)} state=${p.state}`);
}
tryMove('按住右 120帧',['right'],120);
tryMove('按住左 120帧',['left'],120);
tryMove('跳 60帧',['jump'],60);
tryMove('右+跳 120帧',['right','jump'],120);
tryMove('再按住右 240帧',['right'],240);
console.log(`最终 x=${p.x.toFixed(0)} / exitX=${SJ.Level.def.exitX}`);
