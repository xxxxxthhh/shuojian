const fs=require('fs'), path=require('path');
const head=fs.readFileSync(path.join(__dirname,'smoke.js'),'utf8').split('/* ══ 第二阶段')[0]
  .replace(/process\.exit\([^)]*\);?/g,'').replace(/console\.log\(errors[\s\S]*$/,'');
eval(head + '\nglobalThis.__sb={SJ:SJ,mainCanvas:mainCanvas};');
const SJ=globalThis.__sb.SJ, mainCanvas=globalThis.__sb.mainCanvas;
const g=mainCanvas.getContext('2d');
try{SJ.Audio.init();}catch(e){}
SJ.Game.init(mainCanvas);
const held={},pr={},I=SJ.Input;
I.down=a=>!!held[a]; I.pressed=a=>!!pr[a]; I.released=()=>false;
I.buffered=a=>!!pr[a]; I.consume=a=>{pr[a]=false;};
I.axis=()=>(held.left?-1:0)+(held.right?1:0); I.any=()=>true; I.update=()=>{};
const clr=()=>{for(const k in pr)pr[k]=false;};
const stk=()=>(SJ.Game.stack||[]).length;
const lv=Number(process.argv[2]||0);
SJ.Level.load(lv);
let f=0, best=0;
held.right=true;
while(f<12000){
  if(stk()>1){ pr.confirm=true; }        // 只按确认推进对话
  else { held.right=true; if(f%20===0){ pr.interact=true; held.interact=true; } else held.interact=false; }  // 走路 + 试互动，绝不跳
  SJ.Game._step(1/60); SJ.Game._render(g); clr(); f++;
  const p=SJ.player; if(p) best=Math.max(best,p.x);
  if(SJ.Level.current!==lv){ console.log(`  第${lv}关：不跳也能走完（${(f/60).toFixed(1)}s）`); process.exit(0); }
}
const p=SJ.player;
console.log(`  第${lv}关(${SJ.Level.def.id})：不跳走不完。最远 x=${best|0} / exitX=${SJ.Level.def.exitX}`);
const blk=SJ.World.solids.filter(s=>!s.oneway && s.x>best-60 && s.x<best+120);
blk.forEach(s=>console.log(`      前方挡路实心块 x=${s.x} y=${s.y} w=${s.w} h=${s.h}  （高出地面 ${470-s.y}px）`));
