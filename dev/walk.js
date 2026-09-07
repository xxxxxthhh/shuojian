/* 全流程走查：一直往右走，遇到对话就按确认，看能不能走完每一关 */
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
const clr=()=>{for(const k in edge)edge[k]=false;};
const stk=()=>(SJ.Game.stack||SJ.Game._stack||[]).length;

const lv=Number(process.argv[2]||0), MAX=Number(process.argv[3]||18000);
SJ.Level.load(lv);
const def=SJ.Level.def;
let f=0, lastX=-1, stuckFrames=0, dlg=0, jumps=0;
const p0=()=>SJ.player;
while(f<MAX){
  const inDlg = stk()>1;
  if(inDlg){ edge.confirm=true; edge.attack=true; dlg++; }
  else{
    const p=p0();
    // 有敌人就朝最近的敌人走并攻击，否则一直往右
    const foes=SJ.Ent.by('foe').filter(e=>e.hp>0);
    let tgt=null, best=1e9;
    if(p) for(const e of foes){ const d=Math.abs(e.cx()-p.cx()); if(d<best){best=d;tgt=e;} }
    held.left=held.right=false;
    if(tgt && best<560){
      if(best>34) { if(tgt.cx()<p.cx()) held.left=true; else held.right=true; }
      const atking=/^atk/.test(p.state);
      if(!atking && f%6===0) edge.attack=true;
      if(tgt.cy()<p.cy()-24 && f%40===0){ edge.jump=true; held.jump=true; } else held.jump=false;
    } else {
      held.right=true;
      // 卡住就跳（真人会这么做）
      if(p && Math.abs(p.x-lastX)<0.5){ stuckFrames++; if(stuckFrames%24===12){ edge.jump=true; held.jump=true; jumps++; } }
      else { stuckFrames=0; held.jump=false; }
      if(p) lastX=p.x;
    }
    if(p){
      // 卡住就试着跳
      if(Math.abs(p.x-lastX)<0.5){ stuckFrames++; if(stuckFrames%20===10){ edge.jump=true; held.jump=true; jumps++; } }
      else { stuckFrames=0; held.jump=false; }
      lastX=p.x;
      if(p.hp<=0) { console.log(`  死亡 @f${f} x=${p.x|0}`); break; }
    }
  }
  // 卡住检测放在最外层：攻击状态下也要能跳，否则会永远顶着障碍挥空
  if(p0()){
    const px=p0().x;
    if(Math.abs(px-lastX)<0.5){ stuckFrames++; if(stuckFrames%20===10){ edge.jump=true; held.jump=true; jumps++; } }
    else { stuckFrames=0; held.jump=false; }
    lastX=px;
  }
  SJ.Game._step(1/60); SJ.Game._render(g); clr(); f++;
  if(SJ.Level.current!==lv){ console.log(`  ✓ 第${lv}关(${def.id}) 通关 → 切到第${SJ.Level.current}关，用了 ${f} 帧 = ${(f/60).toFixed(1)}s（对话 ${dlg} 帧，跳 ${jumps} 次）`); break; }
}
if(f>=MAX){
  const p=p0();
  console.log(`  ✗ 第${lv}关(${def.id}) ${(MAX/60)|0}s 内没通关。卡在 x=${p?p.x|0:'?'} / exitX=${def.exitX}，栈=${stk()}，连续不动 ${stuckFrames} 帧，敌=${SJ.Ent.by('foe').length}`);
  // ── 自分类：真软锁 vs 机器人不会走 ──
  if (p) {
    const dbg = SJ.Level._debug ? SJ.Level._debug() : {};
    const foes = SJ.Ent.by('foe').filter(e=>!e.dead && e.hp>0);
    const footY = p.y + p.h;
    const inGate = dbg.gate ? foes.filter(e=>e.cx()>=dbg.gate[0] && e.cx()<=dbg.gate[1]) : foes;
    const sameFloor = inGate.filter(e=>Math.abs((e.y+e.h)-footY)<=130);
    const wallAhead = SJ.World.solids.some(s2=>!s2.oneway && s2.x>p.x+p.w-4 && s2.x<p.x+p.w+30 && s2.y<footY && s2.y+s2.h>p.y);
    let verdict;
    if (dbg.busy && stk()===1) verdict = '⚠ 真软锁：busy 标志卡住且无对话层（关卡层的 play() 回调没回来）';
    else if (dbg.gate && foes.length===0) verdict = '⚠ 真软锁：门锁着但已无存活敌人（波次清除判定失效）';
    else if (dbg.gate && sameFloor.length===0) verdict = `⚠ 真软锁：门锁着，${inGate.length} 个敌人都不在玩家这一层（跨层触发）`;
    else if (dbg.gate && inGate.length===0) verdict = `⚠ 真软锁：门锁着，${foes.length} 个敌人全在门外（敌人被打出门/刷在门外）`;
    else if (stk()>1) verdict = '机器人问题：对话层未推进';
    else if (wallAhead) verdict = '机器人问题：顶着实心块（需要跳/绕）';
    else if (foes.length) verdict = `机器人问题：${sameFloor.length} 个同层敌人在场但没打完（打法太弱）`;
    else verdict = '未分类：无门、无敌人、无墙，但没前进（可能是浮筏/风口/blocker）';
    console.log(`      判定：${verdict}   [gate=${JSON.stringify(dbg.gate)} wave=${dbg.activeWave} busy=${dbg.busy} 同层敌=${sameFloor.length}/${foes.length}]`);
  }
  SJ.Ent.by('foe').forEach(e=>console.log(`      敌 ${e.def?e.def.id:'?'} x=${e.x|0} y=${e.y|0} hp=${e.hp}`));
  if(p){
    console.log(`      玩家 state=${p.state} hp=${p.hp} ink=${(p.ink||0)|0} onGround=${p.onGround} vx=${p.vx.toFixed(1)} vy=${p.vy.toFixed(1)} dead=${p.dead} 无敌=${p.invT||0}`);
    const ov=SJ.World.solids.filter(s2=>!s2.oneway && p.x<s2.x+s2.w && p.x+p.w>s2.x && p.y<s2.y+s2.h && p.y+p.h>s2.y);
    console.log(`      嵌在实心块: ${ov.length?JSON.stringify(ov.map(s2=>[s2.x,s2.y,s2.w,s2.h])):'否'}`);
    const near=SJ.World.solids.filter(s2=>Math.abs(s2.x-p.x)<400).map(s2=>[s2.x,s2.y,s2.w,s2.h,s2.oneway?1:0]);
    console.log(`      附近实心块: ${JSON.stringify(near)}`);
  }
  if(SJ.Level.R||true){ const d=SJ.Level.def; (d.waves||[]).forEach(w=>console.log(`      wave${w.id} x=${w.x} gate=${JSON.stringify(w.gate||null)}`)); }
}
