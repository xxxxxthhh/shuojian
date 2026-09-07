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
const F=n=>{for(let i=0;i<n;i++){SJ.Game._step(1/60);SJ.Game._render(g);clr();}};

const lv=Number(process.argv[2]||1);
SJ.Level.load(lv);
for(let i=0;i<400&&stk()>1;i++){pr.confirm=true;SJ.Game._step(1/60);SJ.Game._render(g);clr();}
const p=SJ.player;
// 直接把玩家送到 Boss 场地
const def=SJ.Level.def;
p.x = def.exitX - 260; p.y = (def.bossY!==undefined?def.bossY:470) - p.h;
F(60);
console.log(`到 Boss 场地 x=${p.x|0} 栈=${stk()} 敌=${SJ.Ent.by('foe').length}`);
// 触发 Boss 波
for(let i=0;i<600 && SJ.Ent.by('foe').length===0;i++){ held.right=true; SJ.Game._step(1/60);SJ.Game._render(g);clr(); }
held.right=false;
let boss=SJ.Ent.by('foe')[0];
console.log(`Boss 出现: ${boss?(boss.def&&boss.def.id):'无'} hp=${boss?boss.hp:'-'} 栈=${stk()}`);
if(!boss){ console.log('没能触发 Boss，测试中止'); process.exit(0); }
// 一击打死
boss.hurt(9999, p, {moveId:null});
console.log(`打完一击 → boss.hp=${boss.hp} dead=${boss.dead}`);
for(let k=1;k<=8;k++){
  F(60);
  const foes=SJ.Ent.by('foe');
  console.log(`  +${k}s  栈=${stk()} 敌=${foes.length} lvl=${SJ.Level.current} px=${p.x|0} vx=${p.vx.toFixed(0)} state=${p.state} mercy=${JSON.stringify(SJ.Save.data.mercy)}`);
}
console.log('--- 现在狂按确认 5 秒 ---');
for(let i=0;i<300;i++){ pr.confirm=true; pr.attack=true; SJ.Game._step(1/60);SJ.Game._render(g);clr(); }
console.log(`结果 栈=${stk()} lvl=${SJ.Level.current} mercy=${JSON.stringify(SJ.Save.data.mercy)}`);
console.log('--- 再试着走 3 秒 ---');
held.right=true; const x0=p.x; F(180);
console.log(`Δx=${(p.x-x0).toFixed(1)} x=${p.x|0} state=${p.state} 栈=${stk()} lvl=${SJ.Level.current}`);
