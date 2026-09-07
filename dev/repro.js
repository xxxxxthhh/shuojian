/* 按真实流程复现：main 引导 → 标题 → 始 → 楔子，逐帧看场景栈/玩家/敌人 */
const fs=require('fs'), path=require('path');
const smoke=fs.readFileSync(path.join(__dirname,'smoke.js'),'utf8');
const head=smoke.split('/* ══ 第二阶段')[0]
  .replace(/process\.exit\([^)]*\);?/g,'')
  .replace(/console\.log\(errors[\s\S]*$/,'');
eval(head + '\nglobalThis.__sb = { SJ: SJ, mainCanvas: mainCanvas };');
const SJ = globalThis.__sb.SJ, mainCanvas = globalThis.__sb.mainCanvas;
const g=mainCanvas.getContext('2d');
try{SJ.Audio.init();}catch(e){}
SJ.Game.init(mainCanvas);

const held={},edge={};
const I=SJ.Input;
I.down=a=>!!held[a]; I.pressed=a=>!!edge[a]; I.released=()=>false;
I.buffered=a=>!!held[a]||!!edge[a]; I.consume=()=>{};
I.axis=()=>(held.left?-1:0)+(held.right?1:0); I.any=()=>true; I.update=()=>{};
const tap=a=>{edge[a]=true;};
const clearEdge=()=>{for(const k in edge)edge[k]=false;};
function snap(label){
  const p=SJ.player, st=SJ.Game.stack||SJ.Game._stack;
  console.log(`${label.padEnd(16)} lvl=${String(SJ.Level.current).padStart(2)} px=${p?String(p.x|0).padStart(5):'    -'} vx=${p?String(p.vx|0).padStart(5):'    -'} 敌=${SJ.Ent.by('foe').length} 实体=${SJ.Ent.list.length} 栈=${st?st.length:'?'}`);
}
function run(n,label){ for(let i=0;i<n;i++){ SJ.Game._step(1/60); SJ.Game._render(g); clearEdge(); } snap(label); }

console.log('=== 启动（标题）===');
run(30,'boot');
console.log('=== 连按确认推进 ===');
for(let i=0;i<25;i++){ tap('confirm'); tap('attack'); run(45,'confirm'+i); }
console.log('=== 按住右移 300 帧 ===');
held.right=true; run(300,'hold right');
console.log('=== 再推进 ===');
for(let i=0;i<15;i++){ tap('confirm'); run(45,'more'+i); }
