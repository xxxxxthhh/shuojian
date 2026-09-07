/* 直接对打指定 Boss：玩家满血满墨，机器人会追打+格挡，看能不能打死、要多久 */
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

const lv=Number(process.argv[2]||1), MODE=process.argv[3]||'parry';
SJ.Level.load(lv);
for(let i=0;i<400&&(SJ.Game.stack||[]).length>1;i++){pr.confirm=true;SJ.Game._step(1/60);clr();}
const p=SJ.player, def=SJ.Level.def;
// 放到 Boss 场地并直接生成 Boss
p.x=def.exitX-320; p.y=(def.bossY!==undefined?def.bossY:430)-p.h; p.hp=p.maxHp; p.ink=p.maxInk;
for(let i=0;i<30;i++){SJ.Game._step(1/60);clr();}
const boss=SJ.Bosses.spawn(def.boss, p.x+220, p.y);
boss.onDefeat=function(){ boss._down=true; };
const HP0=boss.hp;
let f=0, deaths=0, parries=0, hits=0;
const MAX=Number(process.argv[4]||18000);
while(f<MAX && !boss._down){
  const d=boss.cx()-p.cx(), ad=Math.abs(d);
  held.left=held.right=held.guard=false;
  const tg=(SJ.Combat.tgList||[]).find(t=>t.owner===boss && !t.done);
  const bossStunned = boss.act==='stun' || (boss.stunT||0)>0;

  if(MODE==='parry' && tg && ad<230){
    held.guard=true;                       // 起手式出现 → 观势
  } else if(bossStunned){
    if(ad>44){ if(d<0) held.left=true; else held.right=true; }
    if(!/^atk/.test(p.state)) pr.attack=true;   // 硬直窗口 → 猛攻
  } else if(MODE==='parry' && ad<120){
    if(d<0) held.right=true; else held.left=true;  // 没起手式就拉开
  } else {
    if(ad>46){ if(d<0) held.left=true; else held.right=true; }
    if(!/^atk/.test(p.state) && f%7===0) pr.attack=true;
  }
  if(p.hp<=0){ deaths++; p.hp=p.maxHp; p.ink=p.maxInk; p.x=boss.x-220; }
  const b0=boss.hp;
  SJ.Game._step(1/60); clr(); f++;
  if(boss.hp<b0) hits++;
  if(p.parryWindow===false && (SJ.Combat.lastParry)) {}
}
const sec=(f/60).toFixed(1);
console.log(`  [诊断] 玩家 x=${p.x|0} y=${p.y|0} onG=${p.onGround} state=${p.state} hp=${p.hp}`);
console.log(`  [诊断] Boss  x=${boss.x|0} y=${boss.y|0} onG=${boss.onGround} act=${boss.act} hp=${boss.hp} dead=${boss.dead} invuln=${(boss.invuln||0).toFixed(2)}`);
console.log(`  [诊断] 水平距离=${Math.abs(boss.cx()-p.cx())|0}  实体数=${SJ.Ent.list.length}  hitbox=${(SJ.Combat.hitList||[]).length}`);
console.log(`【第${lv}关 ${def.boss}】 打法=${MODE}`);
console.log(`  Boss 血量 ${HP0} → ${Math.max(0,boss.hp|0)}   ${boss._down?'✓ 被击败':'✗ 未击败'}`);
console.log(`  用时 ${sec}s / 上限 ${(MAX/60)|0}s   玩家死亡 ${deaths} 次   命中 ${hits} 次`);
