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
I.axis=()=>0; I.any=()=>true; I.update=()=>{};
const clr=()=>{for(const k in pr)pr[k]=false;};
const stk=()=>(SJ.Game.stack||[]).length;
const lv=Number(process.argv[2]||1);
SJ.Level.load(lv);
for(let i=0;i<400&&stk()>1;i++){pr.confirm=true;SJ.Game._step(1/60);SJ.Game._render(g);clr();}
console.log(`第${lv}关就绪，栈=${stk()}`);
console.log('--- 直接调 bossDefeated（真实链条）---');
let thrown=null;
try{ SJ.Level.bossDefeated(SJ.Level.def.boss); }catch(e){ thrown='bossDefeated 立刻抛: '+e.message; }
if(thrown) console.log('  ✗',thrown);
for(let s=1;s<=12;s++){
  let err=null;
  for(let i=0;i<60;i++){
    if(s>=2) pr.confirm=true;                 // 第 2 秒起模拟玩家按确认推进对白
    try{ SJ.Game._step(1/60); SJ.Game._render(g); }catch(e){ err=e.message; break; }
    clr();
  }
  console.log(`  +${s}s 栈=${stk()} lvl=${SJ.Level.current} mercy=${JSON.stringify(SJ.Save.data.mercy)} ${err?('✗ 抛异常: '+err):''}`);
  if(err) break;
  if(SJ.Level.current!==lv){ console.log('  ✓ 已切到下一关'); break; }
}
