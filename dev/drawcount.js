const fs=require('fs'), path=require('path');
const head=fs.readFileSync(path.join(__dirname,'smoke.js'),'utf8').split('/* ══ 第二阶段')[0]
  .replace(/process\.exit\([^)]*\);?/g,'').replace(/console\.log\(errors[\s\S]*$/,'');
eval(head + '\nglobalThis.__sb={SJ:SJ,mainCanvas:mainCanvas};');
const SJ=globalThis.__sb.SJ, mainCanvas=globalThis.__sb.mainCanvas;
const raw=mainCanvas.getContext('2d');
// 统计绘制调用
const count={};
// 直接在真实 ctx 上打点：主循环用的是 init 时拿到的这个对象
for (const k of ['fill','stroke','fillRect','strokeRect','fillText','strokeText','drawImage','arc','moveTo','lineTo','beginPath','measureText','createLinearGradient','createRadialGradient','clearRect']) {
  const orig = raw[k];
  if (typeof orig === 'function') raw[k] = function(){ count[k]=(count[k]||0)+1; return orig.apply(raw, arguments); };
}
const g = raw;
try{SJ.Audio.init();}catch(e){}
SJ.Game.init(mainCanvas);
const held={},pr={},I=SJ.Input;
I.down=a=>!!held[a]; I.pressed=a=>!!pr[a]; I.released=()=>false;
I.buffered=a=>!!pr[a]; I.consume=a=>{pr[a]=false;};
I.axis=()=>(held.left?-1:0)+(held.right?1:0); I.any=()=>true; I.update=()=>{};
const clr=()=>{for(const k in pr)pr[k]=false;};
SJ.Level.load(1);
const stk=()=>(SJ.Game.stack||[]).length;
// 关掉开场
for(let i=0;i<400&&stk()>1;i++){pr.confirm=true;SJ.Game._step(1/60);SJ.Game._render(g);clr();}
// 走到第一个 trigger
held.right=true;
for(let i=0;i<600&&stk()===1;i++){SJ.Game._step(1/60);SJ.Game._render(g);clr();}
console.log('走到 trigger 后 栈 =', stk(), ' x =', SJ.player.x.toFixed(0));
for(const k in count)delete count[k];
// 对话层压着时，统计 30 帧的绘制量
for(let i=0;i<30;i++){SJ.Game._step(1/60);SJ.Game._render(g);clr();}
// 抓 fillText 的内容与坐标
const texts=[];
{ const orig=raw.fillText; raw.fillText=function(t,x,y){ texts.push([String(t),Math.round(x),Math.round(y),raw.fillStyle,raw.font,raw.globalAlpha]); return orig.apply(raw,arguments); }; }
for(let i=0;i<3;i++){SJ.Game._step(1/60);SJ.Game._render(g);clr();}
console.log('三帧内的 fillText（内容 / x / y / 颜色 / 字体 / alpha）:');
texts.slice(0,12).forEach(t=>console.log('   ',JSON.stringify(t)));
console.log('画布逻辑尺寸 960x540');
const top=Object.entries(count).sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log('对话层 30 帧的绘制调用:');
top.forEach(([k,v])=>console.log(`   ${k.padEnd(18)} ${v}`));
console.log('文字类调用 fillText=',count.fillText||0,' measureText=',count.measureText||0);
