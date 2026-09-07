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

function trial(label, startX, footY){
  SJ.Level.load(2);
  for(let i=0;i<400&&(SJ.Game.stack||[]).length>1;i++){pr.confirm=true;SJ.Game._step(1/60);clr();}
  const p=SJ.player;
  p.x=startX; p.y=footY-p.h; p.vx=0; p.vy=0;
  for(const k in held) delete held[k];
  held.right=true;
  let spawnedAt=null, spawnY=null;
  for(let i=0;i<2400;i++){
    if((SJ.Game.stack||[]).length>1){ pr.confirm=true; held.right=false; }
    else { held.right=true; }
    SJ.Game._step(1/60); clr();
    const foes=SJ.Ent.by('foe');
    if(foes.length && spawnedAt===null){ spawnedAt=p.x|0; spawnY=foes[0].y|0; break; }
    if(p.x>3600) break;
  }
  const gate=(SJ.Level.gate||null);
  const blocking=SJ.World.solids.filter(s2=>!s2.oneway && s2.x>p.x+p.w-6 && s2.x<p.x+p.w+40 && s2.y< p.y+p.h && s2.y+s2.h>p.y);
  console.log(`  ${label.padEnd(24)} 走到 x=${p.x|0} vx=${p.vx.toFixed(0)} → ${spawnedAt===null?'未触发波次':'触发(敌y='+spawnY+')'}  挡路块=${blocking.length?JSON.stringify(blocking.map(b=>[b.x,b.y,b.w,b.h])):'无'}`);
}
console.log('第二回 断桥客栈（地面 y=820 / 二层 y=600 / 三层 y=380）');
trial('地面走过 x=1500', 1000, 820);
trial('三层走过 x=1500', 1450, 380);
trial('二层走过 x=3020', 2800, 600);
