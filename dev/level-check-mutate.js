#!/usr/bin/env node
/* dev/level-check-mutate.js  【T1】给 level-check 的规则做变异测试
 *
 *   node dev/level-check-mutate.js
 *
 * 为什么需要：一条永远不会红的规则，和没有这条规则完全等价，而且更糟 ——
 * 它让人以为这里被守住了。所以每加一条规则，就故意把关卡数据改坏一次，
 * 规则必须红，而且必须是**那一条**红（不是被别的规则顺手抓到）。
 *
 * 做法：把真数据深拷贝 → 施加一处变异 → 写成临时 levels 文件 →
 *      用 SJ_LEVELS 环境变量让 dev/level-check.js 读它 → 断言退出码非 0 且命中预期文本。
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');

global.window = {};
require(path.join(ROOT, 'src/data/levels.js'));
const REAL = window.SJ.Levels;

const clone = () => JSON.parse(JSON.stringify(REAL));
const byId = (L, id) => L.filter(l => l.id === id)[0];

/* ── 变异清单 ────────────────────────────────────────────────────── */
const MUT = [
  /* ▼ T1 新加的两条 */
  { rule: '规则18', why: '第二回第 5 波：把三层地板从 gate 中间断开',
    hit: /规则18.*wave5/,
    apply(L) { const c = byId(L, 'c2');
      // 三层 [1400,380,2600,40] → 砍成 1400..2000，gate 右半段(→3400)就没地面了
      c.solids.filter(s => s[1] === 380 && s[2] === 2600).forEach(s => { s[2] = 600; }); } },

  { rule: '规则18', why: '第六回：把某一波的 gate 拉到地面尽头之外',
    hit: /规则18/,
    apply(L) { const c = byId(L, 'c6');
      const w = c.waves.filter(x => x.gate)[0];
      w.gate = [w.gate[0], c.w + 500]; } },

  { rule: '规则19', why: '第一回：把 Boss 场地那段地面砍掉一半',
    hit: /规则19/,
    apply(L) { const c = byId(L, 'c1');
      c.solids.filter(s => s[1] === 470 && s[2] === 4200).forEach(s => { s[2] = 3800; }); } },

  { rule: '规则19', why: '第五回：把 bossY 抬高一层（场地那层就没地面了）',
    hit: /规则19/,
    apply(L) { const c = byId(L, 'c5'); c.bossY = c.bossY - 300; } },

  { rule: '规则20', why: '第六回：把挑台上的弓手抬到跳不到的高度（Δ260）',
    hit: /规则20/,
    apply(L) { const c = byId(L, 'c6');
      c.spawns.filter(s => s.wave === 4 && s.type === 'gongshou').forEach(s => { s.y -= 100; }); } },

  { rule: '规则21', why: '第二回：把三层那个检查点压到一层高度（x 却更小）',
    hit: /规则21/,
    apply(L) { const c = byId(L, 'c2'); c.checkpoints[3] = [1450, 800]; } },

  /* ▼ 既有规则的抽样（证明这套变异框架真的能把它们打红） */
  { rule: '规则7 没有洞', why: '第三回：挖掉一段地面又不铺 hazard',
    hit: /掉出地图|没有兜底|洞/,
    apply(L) { const c = byId(L, 'c3');
      const g = c.solids.filter(s => s[4] !== 1 && s[2] > 300)[0]; g[2] = Math.max(40, g[2] - 300); } },

  { rule: '规则13 blocker 死锁', why: '把设 flag 的 trigger 挪到 blocker 之后',
    hit: /死锁|够不到它/,
    apply(L) { const c = L.filter(l => (l.blockers || []).length)[0];
      const b = c.blockers[0];
      c.triggers.filter(t => t.event && t.event.flag && t.event.flag[0] === b.flag)
        .forEach(t => { t.x = b.x + 100; }); } },

  { rule: '规则14 通路可达', why: '第二回：拆掉通往三层的最后一级台阶',
    hit: /通路不通/,
    apply(L) { const c = byId(L, 'c2');
      c.solids = c.solids.filter(s => !(s[0] === 1200 && s[1] === 434)); } },

  { rule: '规则17 同层触发', why: '第二回：把第 5 波的触发点挪到一层',
    hit: /无法从它自己那层被触发/,
    apply(L) { const c = byId(L, 'c2');
      const w = c.waves.filter(x => x.id === 5)[0]; w.x = 900; w.gate = [820, 3400]; } },

  { rule: '规则10 波次自洽', why: '让 gate 不再包住自己的 spawn',
    hit: /gate/,
    apply(L) { const c = byId(L, 'c1');
      const w = c.waves.filter(x => x.gate)[0]; w.gate = [w.gate[0], w.gate[0] + 20]; } },

  { rule: '规则8 脚下有地', why: '把一个 spawn 抬到半空',
    hit: /站得住|地面|埋在/,
    apply(L) { const c = byId(L, 'c1'); c.spawns[0].y = c.spawns[0].y - 260; } }
];

/* ── 跑 ──────────────────────────────────────────────────────────── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sj-mut-'));
function runWith(levels) {
  const f = path.join(tmp, 'levels-' + Math.random().toString(36).slice(2) + '.js');
  fs.writeFileSync(f,
    '(function(SJ){SJ.Levels=' + JSON.stringify(levels) + ';})(window.SJ = window.SJ || {});');
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'level-check.js')],
      { env: Object.assign({}, process.env, { SJ_LEVELS: f }), encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

let pass = 0, fail = 0;

// 对照组：没改过的数据必须是绿的（证明 SJ_LEVELS 这条路本身没问题）
{
  const r = runWith(clone());
  if (r.code === 0) { console.log('✓ 对照组（未变异）：绿'); pass++; }
  else { console.log('✗ 对照组（未变异）竟然是红的 —— 变异框架自己有问题\n' + r.out.split('\n').filter(l => l[0] === '✗').join('\n')); fail++; }
}

for (const m of MUT) {
  const L = clone();
  try { m.apply(L); } catch (e) { console.log(`✗ ${m.rule} ← ${m.why}：变异脚本自己抛了 ${e.message}`); fail++; continue; }
  const r = runWith(L);
  const lines = r.out.split('\n').filter(l => l.startsWith('✗'));
  const hit = lines.some(l => m.hit.test(l));
  if (r.code !== 0 && hit) { console.log(`✓ ${m.rule} ← ${m.why}`); pass++; }
  else if (r.code !== 0) {
    console.log(`✗ ${m.rule} ← ${m.why}：红了，但红的不是这条规则。实际报的是：\n      ${lines.slice(0, 3).join('\n      ')}`);
    fail++;
  } else { console.log(`✗ ${m.rule} ← ${m.why}：改坏了数据，规则**没红** —— 这条规则守不住东西`); fail++; }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n变异测试：${pass} 过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
