#!/usr/bin/env node
/* dev/level-check.js  【G · 关卡自检】
 *   node dev/level-check.js      退出码 0 = 全过；非 0 = 有硬错误
 *
 * 校验（依 _spec/DESIGN.md §9.3/§9.6、_spec/CONTRACTS.md 决议 004、_spec/STORY.md §4.1/§4.2）：
 *   1  schema：字段齐全、枚举合法、宽度 3500–6000、检查点 2–4
 *   2  所有 trigger/bossScript/intro/outro 引用的 script key 都存在，且是**入口**（无 cond）
 *   3  Σ expectedSec ≥ 1800；budget 各项之和与 expectedSec 自洽；encounters 与波次/Boss 自洽
 *   4  第三回 / 第五回：可击碎回墨物件沿 x 最大间距 ≤600；石砚 2–3 个（DESIGN §9.3）
 *   5  决议 004 §2：c5_t_page 与 c5_book 之间必须隔着实际走动 + 至少一场战斗
 *   6  决议 004 §1：第六回 11 拍齐全、x 单调、教学拍紧贴对应波、
 *                   c6_t_wave2 必须挂在刷怪数最高的那一波进行中
 *   7  没有洞：每一列 x 下方必须有不会消失的 solid 或 hazard 兜底，玩家永不掉出地图
 *   8  spawn / checkpoint / pickup 脚下必须真的有站得住的地面，且不埋在实心块里
 *   9  positional trigger 必须与某块站得住的地面的「玩家站立盒」相交（否则永远触发不了）
 *  10  波次自洽：gate 包含触发点与全部 spawn；spawn 引用的 wave 号存在
 *  11  flag=2（会消失）的平台下方必须还有一层不会消失的地面
 *  16  决议 012：第一回 c1_t_watch 必须在 w1 之后、与教具刀客同屏、且玩家绕不过他
 *  15  STORY §4.2.1 指名断言：c5_book / c5_t_page 不得可错过（割点 + 同层拦路）
 *  13  blocker 的 flag 必须由位于它之前的 trigger 设上（否则死锁）
 *  14  全关通路可达性：起点走得到每个检查点 / 波次 / trigger / Boss 场地 / exitX
 *  12  gate 软锁守卫：被锁住的战场，玩家从最低层必须爬得回战斗层（单向平台 + gate 的经典陷阱）
 *  18  战场楼层必须在 gate 区间内连续（否则掉层的一方够不到另一方，门永远锁着）
 *  19  Boss 场地在 bossY 那一层必须连续（否则 Boss 掉出去就捞不回场地）
 *  20  带 gate 的波，高处的 spawn 不得高于本波楼层 190px（满跳+二段跳够不到 = 门开不了）
 *  21  同一层上的检查点必须按 x 递增（否则会跨层错拿检查点）
 *  22  决议 023：无门波次不阻塞后面的波（用 harness 真跑一遍，不是静态推理）
 *  24  门只锁同层：玩家离开波次楼层时门不夹人（harness 真跑）
 *  23  决议 012：第一回第一波的教具刀客必须带 only（招表钉死成破雨）
 */
'use strict';
var fs = require('fs'), path = require('path');
var ROOT = path.resolve(__dirname, '..');

global.window = {};
require(path.join(ROOT, 'src/data/script.js'));
// SJ_LEVELS：给 dev/level-check-mutate.js 用的替代关卡数据；不设就是真数据
require(process.env.SJ_LEVELS ? path.resolve(process.env.SJ_LEVELS)
                              : path.join(ROOT, 'src/data/levels.js'));
var S = window.SJ.Script, L = window.SJ.Levels;

var errs = [], warns = [];
function E(m) { errs.push(m); }
function W(m) { warns.push(m); }

var PLAYER_H = 54;                       // 玩家站立盒高度（DESIGN §7 身高 ~64px 的躯干部分，保守取 54）
var MUSIC = ['tea','bamboo','inn','river','snow','library','wall','boss','final','ending','silence'];
var WEATHER = ['rain','snow','none','wind'];
var BG = ['bamboo','inn','river','snow','library','wall','tea'];
var FOES = ['daoke','gongshou','qiangbing','lishi','sengren','cike','denglong'];
var BOSSES = ['yuzhongdao','dizi','laoweng','baiyi','shouge','shixiong'];
var MOVES = ['hengyun','liebo','chengtian','guying','wufeng','lianhuan','poyu',
             'chuanyang','zhenshan','tiyun','fenshu','shuojian'];
var WHEN = /^(wave:\d+|afterWave:\d+|firstInk|firstHurt|burn)$/;
var AIRBORNE = { buoy: 1, raft: 1 };      // 故意悬空的物件，不查脚下地面

/* ── 小工具 ─────────────────────────────────────────────────────── */
function solidsAt(lv, x, includeVanishing) {
  return lv.solids.filter(function (s) {
    if (!includeVanishing && s[4] === 2) return false;
    return x >= s[0] && x <= s[0] + s[2];
  });
}
// 某个 (x, y) 是不是「站得住的地面顶面」
function standsOn(lv, x, y, tol, allowVanishing) {
  tol = tol === undefined ? 3 : tol;
  return lv.solids.some(function (s) {
    return (allowVanishing || s[4] !== 2) && x >= s[0] && x <= s[0] + s[2] && Math.abs(s[1] - y) <= tol;
  }) || lv.deco.some(function (d) {          // 浮筏也算站得住
    return d.kind === 'raft' && x >= d.ax - 20 && x <= d.bx + d.w + 20 && Math.abs(d.y - y) <= 40;
  });
}
function insideSolid(lv, x, y) {             // 点被埋在实心块内部（脚底上方 4px 处取样）
  return lv.solids.some(function (s) {
    return s[4] === 0 && x > s[0] + 1 && x < s[0] + s[2] - 1 && y > s[1] + 1 && y < s[1] + s[3] - 1;
  });
}
function entryOk(key, where) {
  if (!S[key]) { E(where + ': script key 不存在 -> ' + key); return false; }
  if ('cond' in S[key]) { E(where + ': ' + key + ' 带 cond，不是入口 key（决议 002 §1）'); return false; }
  return true;
}
function screens(key) {                      // 中性存档下这条链会显示几屏
  var save = { mercy: {}, known: [], flags: {} }, n = 0, g = 0, seen = {}, k = key;
  while (k && S[k] && !seen[k] && ++g < 200) {
    seen[k] = 1;
    if (!S[k].cond || S[k].cond(save)) n++;
    k = S[k].next;
  }
  return n;
}

/* ══ 1. schema ═════════════════════════════════════════════════════ */
if (!Array.isArray(L) || L.length !== 8) E('SJ.Levels 必须是 8 关的数组，实得 ' + (L && L.length));

var usedKeys = {};
var totalSec = 0, totalScreens = 0;

L.forEach(function (lv, i) {
  var P = '[' + i + ' ' + lv.id + ']';

  ['id','title','chapter','music','weather','bg','w','h','solids','hazards','deco',
   'spawns','waves','checkpoints','triggers','intro','outro','exitX',
   'expectedSec','encounters'].forEach(function (f) {
    if (lv[f] === undefined) E(P + ' 缺字段 ' + f);
  });
  if (MUSIC.indexOf(lv.music) < 0) E(P + ' music 非法: ' + lv.music);
  if (WEATHER.indexOf(lv.weather) < 0) E(P + ' weather 非法: ' + lv.weather);
  if (BG.indexOf(lv.bg) < 0) E(P + ' bg 非法: ' + lv.bg);
  if (lv.w < 3500 || lv.w > 6000) E(P + ' 关卡宽度 ' + lv.w + ' 不在 3500–6000（契约）');
  if (lv.chapter !== i) E(P + ' chapter 应等于索引 ' + i + '，实得 ' + lv.chapter);
  if (lv.checkpoints.length < 2 || lv.checkpoints.length > 4)
    E(P + ' 检查点 ' + lv.checkpoints.length + ' 个，契约要求 2–4');
  if (lv.exitX < 0 || lv.exitX > lv.w) E(P + ' exitX 越界');

  /* ══ 2. script key ═══════════════════════════════════════════════ */
  function use(k, where) { if (entryOk(k, P + ' ' + where)) usedKeys[k] = 1; }
  use(lv.intro, 'intro'); use(lv.outro, 'outro');
  if (lv.boss) {
    if (BOSSES.indexOf(lv.boss) < 0) E(P + ' boss id 非法: ' + lv.boss);
    if (!lv.bossScript) E(P + ' 有 boss 却没有 bossScript');
    else ['pre','mid','down','p2','p3'].forEach(function (f) {
      if (lv.bossScript[f]) use(lv.bossScript[f], 'bossScript.' + f);
    });
    if (!lv.bossScript || !lv.bossScript.down) E(P + ' bossScript.down 必填（倒地未死那一屏）');
    if (!lv.bossArena) E(P + ' 有 boss 却没有 bossArena');
    else if (lv.bossArena[0] < 0 || lv.bossArena[1] > lv.w || lv.bossArena[0] >= lv.bossArena[1])
      E(P + ' bossArena 非法');
    if (['boss','final'].indexOf(lv.bossMusic) < 0) E(P + ' bossMusic 应为 boss|final');
  }

  lv.triggers.forEach(function (t, ti) {
    var T = P + ' trigger#' + ti;
    if (!t.event) { E(T + ' 缺 event'); return; }
    if (t.event.play) use(t.event.play, 'trigger#' + ti);
    if (t.event.gain) {
      if (MOVES.indexOf(t.event.gain[0]) < 0) E(T + ' gain 的招式 id 非法: ' + t.event.gain[0]);
    }
    if (t.event.music && MUSIC.indexOf(t.event.music) < 0) E(T + ' music 非法');
    if (t.when !== undefined && !WHEN.test(t.when)) E(T + ' when 非法: ' + t.when);
    var positional = t.x !== undefined;
    if (!positional && !t.when) E(T + ' 既没有位置也没有 when，永远不会触发');
    if (positional) {
      if (t.x < 0 || t.x + t.w > lv.w) E(T + ' 越出关卡宽度');
      /* ══ 9. positional trigger 必须够得着 ══
       * 只问「有没有某一处够得着」是不够的：trigger 跨在台阶落差上或半截悬在岸沿外时，
       * 会变成「只有从某一侧靠过去才碰得到」，玩家正常走过去反而不触发 —— 一个静默丢失的剧情拍。
       * 所以按宽度采样：至少一半的横向范围上，站在那里的玩家要能碰到它。 */
      var inAir = lv.hazards.some(function (hz) {   // 风口这类会把玩家送进区域的 hazard
        return hz.kind === 'updraft' && t.x < hz.x + hz.w && t.x + t.w > hz.x;
      });
      if (!inAir) {
        var hitN = 0, totN = 0;
        for (var sx = t.x + 4; sx < t.x + t.w; sx += 8) {
          totN++;
          // 这一列玩家会站在哪：取最高的那块（y 最小）够得着的地面
          var ok = lv.solids.some(function (s) {
            if (s[4] === 2) return false;
            if (sx < s[0] || sx > s[0] + s[2]) return false;
            return t.y < s[1] && t.y + t.h > s[1] - PLAYER_H;
          });
          if (ok) hitN++;
        }
        if (!hitN) E(T + ' (' + (t.event.play || '?') + ') 与任何站得住的地面都不相交，玩家触发不到');
        else if (hitN / totN < 0.5)
          E(T + ' (' + (t.event.play || '?') + ') 只有 ' + Math.round(hitN / totN * 100) +
            '% 的宽度够得着（跨在落差上或悬在边沿外），玩家正常走过去很可能不触发');
      }
    }
    var m = /^(wave|afterWave):(\d+)$/.exec(t.when || '');
    if (m && !lv.waves.some(function (w) { return w.id === +m[2]; }))
      E(T + ' when 引用了不存在的波次 ' + m[2]);
  });

  /* ══ 3. 时长预算 ════════════════════════════════════════════════ */
  totalSec += lv.expectedSec;
  if (!(lv.expectedSec > 0)) E(P + ' expectedSec 必填且 >0');
  if (lv.encounters === undefined) E(P + ' encounters 必填');
  var ambient = lv.spawns.some(function (s) { return s.wave === 0; }) ? 1 : 0;
  var wantEnc = lv.waves.length + (lv.boss ? 1 : 0) + ambient;
  if (lv.encounters !== wantEnc)
    E(P + ' encounters=' + lv.encounters + ' 与实际（' + lv.waves.length + ' 波 + ' +
      (lv.boss ? 'Boss' : '无 Boss') + (ambient ? ' + 游荡' : '') + ' = ' + wantEnc + '）不符');
  if (lv.budget) {
    var b = lv.budget, sum = b.walk + b.waves + b.boss + b.story + b.other;
    if (Math.abs(sum - lv.expectedSec) > 1)
      E(P + ' budget 各项之和 ' + sum + ' ≠ expectedSec ' + lv.expectedSec);
    var waveSum = lv.waves.reduce(function (a, w) { return a + w.sec; }, 0);
    if (b.waves < waveSum) E(P + ' budget.waves ' + b.waves + ' < 各波 sec 之和 ' + waveSum);
    if (lv.boss && b.boss <= 0) E(P + ' 有 Boss 但 budget.boss = 0');
  } else W(P + ' 没有 budget 明细');

  /* ══ 7. 没有洞 ══════════════════════════════════════════════════ */
  var holes = [];
  for (var x = 0; x <= lv.w; x += 20) {
    var covered = solidsAt(lv, x, false).length > 0 ||
      lv.hazards.some(function (hz) { return x >= hz.x && x <= hz.x + hz.w; });
    if (!covered) holes.push(x);
  }
  if (holes.length) E(P + ' 地图有洞，玩家会掉出去，x = ' + holes.slice(0, 8).join(',') +
                      (holes.length > 8 ? ' …共 ' + holes.length + ' 列' : ''));

  /* ══ 11. flag=2 下面必须有兜底 ══════════════════════════════════ */
  lv.solids.forEach(function (s) {
    if (s[4] !== 2) return;
    if (s.length < 6 || typeof s[5] !== 'number') E(P + ' flag=2 的 solid 缺 burnAt: ' + JSON.stringify(s));
    var mid = s[0] + s[2] / 2;
    var below = lv.solids.some(function (o) {
      return o[4] !== 2 && mid >= o[0] && mid <= o[0] + o[2] && o[1] > s[1];
    });
    if (!below) E(P + ' 会消失的平台 ' + JSON.stringify(s) + ' 下方没有兜底地面，烧掉会摔出图');
  });

  /* ══ 8. spawn / checkpoint / pickup 站得住 ══════════════════════ */
  lv.spawns.forEach(function (sp, si) {
    var T = P + ' spawn#' + si + '(' + sp.type + ')';
    if (FOES.indexOf(sp.type) < 0) E(T + ' 敌人 id 非法');
    if (!standsOn(lv, sp.x, sp.y)) E(T + ' @' + sp.x + ',' + sp.y + ' 脚下没有地面');
    if (insideSolid(lv, sp.x, sp.y - 4)) E(T + ' 埋在实心块里');
    if (sp.wave !== 0 && !lv.waves.some(function (w) { return w.id === sp.wave; }))
      E(T + ' 引用了不存在的波次 ' + sp.wave);
  });
  lv.checkpoints.forEach(function (cp, ci) {
    var T = P + ' checkpoint#' + ci;
    if (!standsOn(lv, cp[0], cp[1])) E(T + ' @' + cp + ' 脚下没有地面');
    if (insideSolid(lv, cp[0], cp[1] - 4)) E(T + ' 埋在实心块里');
    lv.hazards.forEach(function (hz) {
      if (cp[0] > hz.x && cp[0] < hz.x + hz.w && cp[1] > hz.y && cp[1] - PLAYER_H < hz.y + hz.h)
        E(T + ' 落在 ' + hz.kind + ' hazard 里，重生即死');
    });
  });
  lv.deco.forEach(function (d, di) {
    if (AIRBORNE[d.kind]) return;
    if (!standsOn(lv, d.x, d.y, 3, true)) E(P + ' deco#' + di + '(' + d.kind + ') @' + d.x + ',' + d.y + ' 脚下没有地面');
  });

  /* ══ 10. 波次自洽 ══════════════════════════════════════════════ */
  lv.waves.forEach(function (w) {
    var T = P + ' wave' + w.id;
    if (!(w.sec > 0)) E(T + ' 缺 sec');
    if (w.gate) {
      if (w.x < w.gate[0] || w.x > w.gate[1]) E(T + ' 触发点不在 gate 内');
      lv.spawns.filter(function (s) { return s.wave === w.id; }).forEach(function (s) {
        if (s.x < w.gate[0] - 40 || s.x > w.gate[1] + 40) E(T + ' spawn @' + s.x + ' 在 gate 之外，玩家打不到');
      });
    }
    if (!lv.spawns.some(function (s) { return s.wave === w.id; })) E(T + ' 没有任何 spawn');

    /* ══ 12. gate 软锁守卫 ══
     * 「把玩家锁在 [g0,g1] 里」+「战场是单向平台」= 玩家掉到下面那层就永远上不去了。
     * 判定：该波每一个 spawn 所在的地面高度，要么被一块横跨整个 gate 的实心地面托住
     *      （根本掉不下去），要么必须能从 gate 内**最低**的那层一路爬回去。
     * 爬得上去 = 高差 ≤190（满跳 114 + 二段跳 ≈85）且水平间距 ≤150（满跳滞空 144）。 */
    if (w.gate) {
      var g0 = w.gate[0], g1 = w.gate[1];
      var surf = lv.solids.filter(function (s) {
        return s[4] !== 2 && s[0] < g1 && s[0] + s[2] > g0;
      }).map(function (s) { return { y: s[1], x0: s[0], x1: s[0] + s[2] }; });
      lv.deco.forEach(function (d) {
        if (d.kind === 'raft' && d.ax < g1 && d.bx + d.w > g0) surf.push({ y: d.y, x0: d.ax, x1: d.bx + d.w });
      });
      if (surf.length) {
        var lowest = Math.max.apply(null, surf.map(function (s) { return s.y; }));
        var seen = surf.map(function (s) { return s.y === lowest; });
        var moved = true;
        while (moved) {
          moved = false;
          surf.forEach(function (a, ai) {
            if (!seen[ai]) return;
            surf.forEach(function (b, bi) {
              if (seen[bi]) return;
              if (Math.abs(a.y - b.y) > 190) return;
              var gap = Math.max(b.x0 - a.x1, a.x0 - b.x1, 0);
              if (gap > 150) return;
              seen[bi] = true; moved = true;
            });
          });
        }
        var spawnYs = {};
        lv.spawns.forEach(function (s) { if (s.wave === w.id) spawnYs[s.y] = 1; });
        Object.keys(spawnYs).map(Number).forEach(function (y) {
          var spans = lv.solids.some(function (s) {
            return s[4] !== 2 && s[1] === y && s[0] <= g0 && s[0] + s[2] >= g1;
          });
          if (spans) return;                     // 有整条托底的地面，掉不下去
          var ok = surf.some(function (s, si) { return seen[si] && s.y === y; });
          if (!ok) E(T + ' 软锁风险：gate [' + g0 + ',' + g1 + '] 内，玩家从最低层(y=' +
                      lowest + ')爬不回 spawn 所在的 y=' + y + '，掉下去就出不来了');
        });
      }
    }
  });

  /* ══ 4. 墨的保底（DESIGN §9.3，第三/五回硬性）══════════════════ */
  var inkX = lv.deco.filter(function (d) { return d.ink; }).map(function (d) { return d.x; })
                    .sort(function (a, b) { return a - b; });
  var yan = lv.deco.filter(function (d) { return d.refill; });
  if (lv.id === 'c3' || lv.id === 'c5') {
    if (!inkX.length) { E(P + ' 没有任何可击碎回墨物件（DESIGN §9.3.3）'); }
    else {
      var prev = 0, worst = 0, worstAt = 0;
      inkX.concat([lv.w]).forEach(function (x) {
        if (x - prev > worst) { worst = x - prev; worstAt = prev; }
        prev = x;
      });
      if (worst > 600) E(P + ' 回墨物件最大间距 ' + worst + 'px（x≈' + worstAt + ' 之后），超过 600（DESIGN §9.3.3）');
      else console.log('  ' + P + ' 回墨物件 ' + inkX.length + ' 个，最大间距 ' + worst + 'px ✓');
    }
    if (yan.length < 2 || yan.length > 3)
      E(P + ' 石砚 ' + yan.length + ' 个，DESIGN §9.3.4 要求 2–3 个');
    else console.log('  ' + P + ' 石砚 ' + yan.length + ' 个 ✓');
  }
});

/* ══ 13/14. blockers 与全关通路可达性 ══════════════════════════════
 * 14 是这份检查器里最值钱的一条：波次内的可达性只管被锁住的那一小段，
 * 管不到「整关根本走不通」。第五回原来的三层就有一段 220px 的断层没有梯子，
 * 从二层上不去，w2 / 火势 / 顶层 / Boss 全部不可达 —— 数据看着完全正常。
 * 这条规则从起点做一次全图表面 BFS，要求所有检查点 / 波次触发点 / 位置型 trigger /
 * Boss 场地 / exitX 都在可达集合里。 */
L.forEach(function (lv) {
  var P = '[' + lv.chapter + ' ' + lv.id + ']';

  /* 13. blocker 的 flag 必须由一个位于它之前的 trigger 设上 */
  (lv.blockers || []).forEach(function (b) {
    var setter = lv.triggers.filter(function (t) {
      return t.event && t.event.flag && t.event.flag[0] === b.flag && t.event.flag[1];
    });
    if (!setter.length)
      return E(P + ' blocker@' + b.x + ' 要的 flag "' + b.flag + '" 没有任何 trigger 会设上，玩家永远过不去');
    setter.forEach(function (t) {
      if (t.x === undefined) return E(P + ' 设 flag "' + b.flag + '" 的 trigger 没有位置');
      if (t.x >= b.x) E(P + ' 设 flag "' + b.flag + '" 的 trigger @' + t.x +
                        ' 在 blocker@' + b.x + ' 之后，玩家够不到它 —— 死锁');
    });
  });

  /* 14. 全关通路可达性 */
  var surf = lv.solids.filter(function (q) { return q[4] !== 2; })
    .map(function (q) { return { y: q[1], x0: q[0], x1: q[0] + q[2], oneway: q[4] === 1 }; });
  lv.deco.forEach(function (d) {
    if (d.kind === 'raft') surf.push({ y: d.y, x0: d.ax, x1: d.bx + d.w, oneway: true });   // 浮筏是路
  });
  // 起跳点头顶的净空：脚底到最近一块实心天花板底面的距离
  function headroom(x, footY) {
    var ceil = -Infinity;
    lv.solids.forEach(function (q) {
      if (q[4] === 1 || q[4] === 2) return;             // 单向平台不算天花板
      if (x < q[0] || x > q[0] + q[2]) return;
      var bot = q[1] + q[3];
      if (bot <= footY - 2 && bot > ceil) ceil = bot;
    });
    return ceil === -Infinity ? Infinity : footY - ceil;
  }
  if (!surf.length) return;

  var seen = surf.map(function () { return false; });
  // 起点：第一个检查点脚下那块地面
  var c0 = lv.checkpoints[0];
  surf.forEach(function (q, i) {
    if (c0[0] >= q.x0 && c0[0] <= q.x1 && Math.abs(q.y - c0[1]) <= 3) seen[i] = true;
  });
  if (!seen.some(Boolean)) return E(P + ' 起点检查点脚下没有地面，无法做通路检查');

  function link(a, b) {                       // b 能否从 a 到达
    var dy = b.y - a.y;
    if (Math.abs(dy) > 190) return false;                     // 满跳 114 + 二段跳 ≈85
    if (Math.max(b.x0 - a.x1, a.x0 - b.x1, 0) > 150) return false;   // 满跳滞空 144
    if (dy >= -6) return true;

    /* ★ 往上跳还得过「天花板」这一关（T1 变异测试逼出来的）：
     * 原来的 link 只看高差与水平间距，于是它认为「站在柱子顶上能跳到正头顶那层楼板」——
     * 而那层楼板在柱子上方是**天花板**，玩家只会一头撞上去。
     * 后果不是误报，是**漏报**：把第二回通往三层的最后一级台阶删掉，
     * 规则 14 依然全绿（它以为可以从 1800 那根柱子直接上三楼）。 */
    var dir = (b.x0 - a.x1) >= (a.x0 - b.x1) ? 1 : -1, toX;
    if (b.oneway) {
      // 单向平台可以从正下方穿上去，起跳点不受限
      toX = dir > 0 ? Math.min(a.x1, Math.max(a.x0, b.x0)) : Math.max(a.x0, Math.min(a.x1, b.x1));
    } else if (dir > 0) {
      if (a.x1 <= b.x0) toX = a.x1;
      else if (a.x0 < b.x0) toX = b.x0 - 2;
      else return false;                                      // a 整段埋在 b 底下
    } else {
      if (a.x0 >= b.x1) toX = a.x0;
      else if (a.x1 > b.x1) toX = b.x1 + 2;
      else return false;
    }
    return headroom(toX, a.y) >= -dy + 54;                    // 脚越过 b，头顶还要留出身高
  }
  var moved = true;
  while (moved) {
    moved = false;
    surf.forEach(function (a, ai) {
      if (!seen[ai]) return;
      surf.forEach(function (b, bi) {
        if (!seen[bi] && link(a, b)) { seen[bi] = true; moved = true; }
      });
    });
    // 风口（updraft）把上下两块地面接起来 —— 第四回的断崖就是这么过的
    lv.hazards.filter(function (h) { return h.kind === 'updraft'; }).forEach(function (h) {
      var grp = [];
      surf.forEach(function (q, i) {
        if (q.x1 >= h.x - 150 && q.x0 <= h.x + h.w + 150 &&
            q.y >= h.y - 60 && q.y <= h.y + h.h + 60) grp.push(i);
      });
      if (grp.some(function (i) { return seen[i]; }))
        grp.forEach(function (i) { if (!seen[i]) { seen[i] = true; moved = true; } });
    });
  }
  function reachedAt(x, y) {                  // (x,y) 是可达地面吗（y 可省＝只看 x）
    return surf.some(function (q, i) {
      return seen[i] && x >= q.x0 && x <= q.x1 && (y === undefined || Math.abs(q.y - y) <= 3);
    });
  }
  lv.checkpoints.forEach(function (c, i) {
    if (!reachedAt(c[0], c[1])) E(P + ' 通路不通：检查点#' + i + ' @' + c + ' 从起点走不到');
  });
  lv.waves.forEach(function (w) {
    if (!reachedAt(w.x)) E(P + ' 通路不通：wave' + w.id + ' 的触发点 @' + w.x + ' 从起点走不到');
    lv.spawns.filter(function (sp) { return sp.wave === w.id; }).forEach(function (sp) {
      if (!reachedAt(sp.x, sp.y))
        E(P + ' 通路不通：wave' + w.id + ' 的 ' + sp.type + ' @' + sp.x + ',' + sp.y + ' 玩家够不到');
    });
  });
  lv.triggers.forEach(function (t) {
    if (t.x === undefined) return;
    var ok = surf.some(function (q, i) {
      return seen[i] && t.x + t.w >= q.x0 && t.x <= q.x1 &&
             t.y < q.y && t.y + t.h > q.y - PLAYER_H;
    }) || lv.hazards.some(function (h) {
      return h.kind === 'updraft' && t.x < h.x + h.w && t.x + t.w > h.x;
    });
    if (!ok) E(P + ' 通路不通：trigger (' + (t.event.play || '?') + ') @' + t.x + ' 从起点走不到');
  });
  if (lv.boss) {
    if (lv.bossY === undefined) E(P + ' 有 boss 却没有 bossY（Boss 站的那层地面 y）');
    else if (!reachedAt(lv.bossArena[0] + 10, lv.bossY))
      E(P + ' 通路不通：Boss 场地 @' + lv.bossArena[0] + ',' + lv.bossY + ' 从起点走不到');
  }
  if (!reachedAt(lv.exitX)) E(P + ' 通路不通：exitX @' + lv.exitX + ' 从起点走不到');
});

/* ══ 15. STORY §4.2.1 —— 指名断言：这两屏不得可错过 ══════════════════
 * 规则 13/14 是通用的（flag 死锁、通路走得通），**证明不了「玩家一定会看到」**。
 * `c5_t_page` 是全剧唯一一处「说书人在撒谎」的硬证据：错过它的玩家会完整通关、
 * 拿到结局，并且永远不知道自己少了什么——不可靠叙述者会静默退化成隐藏内容。
 * 所以这里按 key 指名断言，用两个能真正证明「必经」的性质：
 *   A「割点」：把承载这一屏的那块地面从可达图里删掉，Boss 就走不到了
 *              ⇒ 玩家不可能绕过这块地面。（对 auto 触发，走过即播，到此为止。）
 *   B「拦路」：interact 触发可以走过去不按，所以还要求它与 Boss 之间有一道 blocker，
 *              且那道 blocker 的 flag **只**由这一屏设、并与它踩在同一块地面上
 *              （同一块＝不是「跳上侧龛去读」，是「走到跟前非读不可」）。 */
(function () {
  var lv = L.filter(function (l) { return l.id === 'c5'; })[0];
  if (!lv || !lv.boss) return;

  var surf = lv.solids.filter(function (q) { return q[4] !== 2; })
    .map(function (q) { return { y: q[1], x0: q[0], x1: q[0] + q[2] }; });
  function reach(exclude) {                        // 排除某块地面后，Boss 还走得到吗
    var seen = surf.map(function (q) {
      return q !== exclude && lv.checkpoints[0][0] >= q.x0 && lv.checkpoints[0][0] <= q.x1 &&
             Math.abs(q.y - lv.checkpoints[0][1]) <= 3;
    });
    var moved = true;
    while (moved) {
      moved = false;
      surf.forEach(function (a, ai) {
        if (!seen[ai] || a === exclude) return;
        surf.forEach(function (b, bi) {
          if (seen[bi] || b === exclude) return;
          if (Math.abs(a.y - b.y) > 190) return;
          if (Math.max(b.x0 - a.x1, a.x0 - b.x1, 0) > 150) return;
          seen[bi] = true; moved = true;
        });
      });
    }
    return surf.some(function (q, i) {
      return seen[i] && q !== exclude &&
             lv.bossArena[0] + 10 >= q.x0 && lv.bossArena[0] + 10 <= q.x1 &&
             Math.abs(q.y - lv.bossY) <= 3;
    });
  }

  ['c5_book', 'c5_t_page'].forEach(function (key) {
    var t = lv.triggers.filter(function (t) { return t.event && t.event.play === key; })[0];
    if (!t) return E('STORY §4.2.1: 第五回没有 ' + key + ' 的 trigger');
    if (t.x === undefined) return E('STORY §4.2.1: ' + key + ' 没有位置');

    // 它踩在哪块地面上
    var host = surf.filter(function (q) {
      return t.x + t.w >= q.x0 && t.x <= q.x1 && t.y < q.y && t.y + t.h > q.y - PLAYER_H;
    });
    if (!host.length) return E('STORY §4.2.1: ' + key + ' 不在任何站得住的地面上');

    // A. 割点
    var cut = host.some(function (h) { return !reach(h); });
    if (!cut)
      E('STORY §4.2.1: ' + key + ' @' + t.x + ' 可以被绕过 —— ' +
        '把它脚下那块地面删掉，Boss 仍然走得到，说明它不在必经之路上');

    // B. interact 的还要有拦路的 blocker
    if (t.interact) {
      var bl = (lv.blockers || []).filter(function (b) {
        return b.flag && t.event.flag && b.flag === t.event.flag[0] &&
               b.x > t.x && b.x <= lv.bossArena[0];
      });
      if (!bl.length)
        return E('STORY §4.2.1: ' + key + ' 是 interact 触发（可以走过去不按），' +
                 '却没有一道位于它与 Boss 之间、由它解锁的 blocker —— 玩家可以整关不触发');
      bl.forEach(function (b) {
        var others = lv.triggers.filter(function (o) {
          return o !== t && o.event && o.event.flag && o.event.flag[0] === b.flag && o.event.flag[1];
        });
        if (others.length)
          E('STORY §4.2.1: blocker@' + b.x + ' 的 flag 还能被别的 trigger 设上，' + key + ' 就绕得过去了');
        if (!host.some(function (h) { return b.x >= h.x0 && b.x <= h.x1; }))
          E('STORY §4.2.1: ' + key + ' 与拦它的 blocker@' + b.x + ' 不在同一块地面上 —— ' +
            '那就成了「跳上侧龛去读」的可选绕路，不是「走到跟前非读不可」');
      });
    }
  });
  console.log('  [c5] §4.2.1 不得可错过 ✓ c5_book（走过即播·割点）/ c5_t_page（interact + 同层拦路 + 割点）');
})();

/* ══ 16. 决议 012 —— 第一回要承担「观势」的可发现性 ═══════════════
 * 全项目最大的风险：没有任何一个像素在说「长按 K」，而 12 招里 10 招要靠观势学。
 * 第一回那个刀客是全游戏的教具，c1_t_watch 是唯一一句指向它的话。三条都得成立：
 *   A 顺序：w1 的触发线必须在 c1_t_watch **之前** —— 先刷出刀客、让他起手，旁白再落下。
 *     反了的话玩家会对着一屏空竹林读「招已经画在空里了」，这条线索当场断掉。
 *   B 同框：读到这句时刀客要在屏内（960 宽，留点余量按 900 判）。
 *   C 绕不过去：w1 必须有 gate 且把刀客圈在里面 —— 他是教具，玩家必须打上照面。 */
(function () {
  var lv = L.filter(function (l) { return l.id === 'c1'; })[0];
  if (!lv) return E('决议 012: 找不到第一回');
  var t = lv.triggers.filter(function (t) { return t.event && t.event.play === 'c1_t_watch'; })[0];
  var w1 = lv.waves.filter(function (w) { return w.id === 1; })[0];
  if (!t) return E('决议 012: 第一回没有 c1_t_watch');
  if (!w1) return E('决议 012: 第一回没有 wave1');
  if (!(w1.x + w1.w <= t.x))
    E('决议 012 A: w1 触发线 @' + w1.x + '-' + (w1.x + w1.w) + ' 没有排在 c1_t_watch @' + t.x +
      ' 之前 —— 玩家会对着空竹林读「招已经画在空里了」');
  var foes = lv.spawns.filter(function (s) { return s.wave === 1; });
  if (!foes.length) return E('决议 012: w1 没有敌人');
  var near = Math.min.apply(null, foes.map(function (s) { return Math.abs(s.x - t.x); }));
  if (near > 900)
    E('决议 012 B: c1_t_watch @' + t.x + ' 离最近的刀客 ' + near + 'px，读到这句时他不在屏内');
  if (!w1.gate) E('决议 012 C: w1 没有 gate，玩家可以直接跑过教具刀客');
  else {
    var out = foes.filter(function (s) { return s.x < w1.gate[0] || s.x > w1.gate[1]; });
    if (out.length) E('决议 012 C: w1 的刀客在 gate 之外，玩家绕得过去');
    else console.log('  [c1] 决议 012 ✓ w1@' + w1.x + ' 先于 c1_t_watch@' + t.x +
                     '，最近的刀客 ' + near + 'px（同屏），gate [' + w1.gate + '] 圈住了他');
  }
})();

/* ══ 3b. 总预算 ═════════════════════════════════════════════════════ */
if (totalSec < 1800) E('Σ expectedSec = ' + totalSec + '，未达 DESIGN §9.6 的 1800 秒下限');

/* ══ 5. 决议 004 §2：c5_t_page 与 c5_book 空间隔离 ══════════════════ */
(function () {
  var lv = L.filter(function (l) { return l.id === 'c5'; })[0];
  if (!lv) return E('找不到第五回');
  function trig(key) {
    return lv.triggers.filter(function (t) { return t.event && t.event.play === key; })[0];
  }
  var page = trig('c5_t_page'), book = trig('c5_book');
  if (!page) return E('决议 004 §2: 第五回没有 c5_t_page 的 trigger');
  if (!book) return E('决议 004 §2: 第五回没有 c5_book 的 trigger');
  var d = Math.abs(book.x - page.x);
  if (d < 600) E('决议 004 §2: c5_t_page 与 c5_book 只隔 ' + d + 'px，不足以构成「实际的走动」');
  if (!page.interact) E('决议 004 §2: c5_t_page 必须 interact:true —— 玩家得自己翻开那一页');
  var lo = Math.min(page.x, book.x), hi = Math.max(page.x, book.x);
  var between = lv.waves.filter(function (w) { return w.x > lo && w.x < hi; });
  if (!between.length) E('决议 004 §2: c5_t_page 与 c5_book 之间没有任何一场遭遇');
  else console.log('  [c5] 题眼/物证隔离 ✓ Δx=' + d + 'px，中间夹着 wave' +
                   between.map(function (w) { return w.id; }).join(',') +
                   '（' + (page.x < book.x ? '先物证后题眼' : '先题眼后物证') + '）');
})();

/* ══ 6. 决议 004 §1 / STORY §4.1：第六回 11 拍 ═════════════════════ */
(function () {
  var lv = L.filter(function (l) { return l.id === 'c6'; })[0];
  if (!lv) return E('找不到第六回');
  var BEATS = ['c6_t_climb','c6_t_ghost','c6_t_wave1','c6_t_moon','c6_t_mix',
               'c6_t_wave2','c6_t_flag','c6_t_all','c6_t_wave3','c6_t_see','c6_t_last'];
  var pos = {};
  lv.triggers.forEach(function (t) { if (t.event && t.event.play) pos[t.event.play] = t; });
  var missing = BEATS.filter(function (k) { return !pos[k]; });
  if (missing.length) return E('决议 004 §1: 第六回缺拍 ' + missing.join(','));
  for (var i = 1; i < BEATS.length; i++) {
    if (pos[BEATS[i]].x < pos[BEATS[i - 1]].x)
      E('决议 004 §1: 第六回节拍 x 不单调：' + BEATS[i - 1] + '(' + pos[BEATS[i - 1]].x +
        ') 之后是 ' + BEATS[i] + '(' + pos[BEATS[i]].x + ')');
  }
  // 教学拍必须紧贴它要教的那一波（触发点在该波触发点前 300px 内）
  [['c6_t_mix', 3], ['c6_t_all', 5]].forEach(function (r) {
    var t = pos[r[0]], w = lv.waves.filter(function (w) { return w.id === r[1]; })[0];
    if (!w) return E('决议 004 §1: 找不到 wave' + r[1]);
    if (!(t.x <= w.x && t.x >= w.x - 300))
      E('决议 004 §1: 教学拍 ' + r[0] + ' @' + t.x + ' 没有紧贴 wave' + r[1] + ' @' + w.x);
  });
  // c6_t_wave2 必须挂在刷怪数最高的那一波「进行中」
  var count = {};
  lv.spawns.forEach(function (s) { if (s.wave) count[s.wave] = (count[s.wave] || 0) + 1; });
  var maxW = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0];
  var wm = /^wave:(\d+)$/.exec(pos['c6_t_wave2'].when || '');
  if (!wm) E('决议 004 §1: c6_t_wave2 必须带 when:"wave:N"（波**中**触发，不是波前波后）');
  else if (wm[1] !== maxW)
    E('决议 004 §1: c6_t_wave2 挂在 wave' + wm[1] + '（' + count[wm[1]] + ' 敌），' +
      '但密度最高的是 wave' + maxW + '（' + count[maxW] + ' 敌）');
  else console.log('  [c6] 11 拍齐、x 单调、教学拍紧贴其波；c6_t_wave2 挂在 wave' + maxW +
                   '（' + count[maxW] + ' 敌，全关最高）✓');
  if (!/^wave:/.test(pos['c6_t_ghost'].when || '')) E('决议 004 §1: c6_t_ghost 应在第一波遭遇**中**');
  if (!/^afterWave:/.test(pos['c6_t_wave1'].when || '')) E('决议 004 §1: c6_t_wave1 应在第一波**清完**后');
  if (!/^wave:/.test(pos['c6_t_wave3'].when || '')) E('决议 004 §1: c6_t_wave3 应在最后一波进行中');
})();

/* ══ 2b. 覆盖率：93 个入口 key 是不是都被关卡用上了 ════════════════ */
var allEntries = Object.keys(S).filter(function (k) { return !('cond' in S[k]); });
// 入口＝无 cond 且不是链内被指向的节点
var pointed = {};
Object.keys(S).forEach(function (k) { if (S[k].next) pointed[S[k].next] = 1; });
var realEntries = allEntries.filter(function (k) { return !pointed[k]; });
var unused = realEntries.filter(function (k) { return !usedKeys[k]; });
if (unused.length) W('这些入口 key 没有被任何关卡引用: ' + unused.join(' '));

/* ══ 输出 ═══════════════════════════════════════════════════════════ */
console.log('');
/* ══ 17. 波次必须能从它自己那一层被触发 ═══════════════════════════
 * 实测软锁：第二回三层客栈，波次触发原本只判 x —— 玩家在地面走到 x=1500
 * 触发了「三层那一波」，敌人刷在两层之上，gate 却锁在玩家身边，永远够不到。
 * 运行时已加同层判定；这条规则防止数据侧再造出「从自己那层也触发不了」的波次。 */
L.forEach(function (lv, li) {
  (lv.waves || []).forEach(function (w) {
    var sp = (lv.spawns || []).filter(function (s) { return s.wave === w.id; });
    if (!sp.length) return;
    var floorY = Math.max.apply(null, sp.map(function (s) { return s.y; }));
    // 触发 x 处，该层是否有站得住的地面（容差一层楼 130px）
    var ok = (lv.solids || []).some(function (s) {
      var x0 = s[0], x1 = s[0] + s[2], y = s[1];
      return Math.abs(y - floorY) <= 130 && x1 > w.x && x0 < w.x + (w.w || 60);
    });
    if (!ok) E('[' + li + ' ' + lv.id + '] wave' + w.id + ' 的敌人在 y=' + floorY +
      '，但触发点 x=' + w.x + ' 处那一层没有站得住的地面 —— 这一波无法从它自己那层被触发');
  });
});

/* ══ 18. 战场楼层必须在 gate 里连续 ═══════════════════════════════
 * 实测软锁（第二回第 5 波）：三层地板从 x=1400 起，gate 也从 1400 起。
 * 玩家被 clampPlayer 夹在 x≥1400 走不出去，敌人不受 gate 约束 ——
 * 力士从三层左沿走下二层，站在 gate 区间里但矮一层，玩家永远够不到，
 * 门永远不开。运行时已在 rescueFoes 里把活跃波敌人按回本波楼层；
 * 这条规则守的是那个兜底动作的前提：本波楼层在 gate 内得真有一整段地面可放。
 * 顺带也堵住「玩家自己掉进战场里的洞」。 */
L.forEach(function (lv, li) {
  var P = '[' + li + ' ' + lv.id + '] [规则18] ';
  (lv.waves || []).forEach(function (w) {
    if (!w.gate) return;
    var sp = (lv.spawns || []).filter(function (s) { return s.wave === w.id; });
    if (!sp.length) return;
    var fy = Math.max.apply(null, sp.map(function (s) { return s.y; }));
    // 容差取运行时同一个 FLOOR_TOL=130：60px 的梯田台阶算同一层（跳得上去），
    // 掉一整层（第二回三层间距 220）才算掉出战场
    var segs = (lv.solids || []).filter(function (s) {
      return s[4] !== 2 && Math.abs(s[1] - fy) <= 130;
    }).map(function (s) { return [s[0], s[0] + s[2]]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    var x = w.gate[0], i;
    for (i = 0; i < segs.length; i++) {
      if (segs[i][0] > x) break;                 // 出现断口
      if (segs[i][1] > x) x = segs[i][1];
    }
    if (x < w.gate[1])
      E(P + 'wave' + w.id + ' 的战场楼层 y=' + fy + ' 在 gate ' + JSON.stringify(w.gate) +
        ' 内不连续（走到 x=' + x + ' 就没地面了）—— 掉下去的一方够不到另一方，门会永远锁着');
  });
});

/* ══ 19. Boss 场地必须有整段地面 ═════════════════════════════════
 * 实测隐患：rescueFoes 原来用 groundAt(e.cx(), 0) 捞掉出世界的敌人 ——
 * yFrom=0 等于「从天上往下找第一块地」，多层关卡里那是**屋顶**。
 * Boss 被捞到屋顶上，玩家在 bossArena 里永远打不到他，一样是死局。
 * 运行时已改成从 bossY 往下找并夹回场地；这条规则守它的前提。 */
L.forEach(function (lv, li) {
  if (!lv.boss) return;
  var P = '[' + li + ' ' + lv.id + '] [规则19] ';
  var segs = (lv.solids || []).filter(function (s) {
    return s[4] !== 2 && Math.abs(s[1] - lv.bossY) <= 130;
  }).map(function (s) { return [s[0], s[0] + s[2]]; })
    .sort(function (a, b) { return a[0] - b[0]; });
  var x = lv.bossArena[0], i;
  for (i = 0; i < segs.length; i++) {
    if (segs[i][0] > x) break;
    if (segs[i][1] > x) x = segs[i][1];
  }
  if (x < lv.bossArena[1])
    E(P + 'Boss 场地 ' + JSON.stringify(lv.bossArena) + ' 在 bossY=' + lv.bossY +
      ' 这一层不连续（走到 x=' + x + ' 就没地面了）—— Boss 掉下去就捞不回场地里');
});

/* ══ 20. 高处的敌人必须够得着 ═════════════════════════════════════
 * 第四、六回故意把弓手放在比战场高一层的挑台上（「退无可退，答案是爬上去」）。
 * 但如果放得比一次满跳＋二段跳还高，玩家在 gate 里就永远打不到他，
 * 门永远不开 —— 和敌人掉到下层是同一个死局的镜像。
 * 190 = 满跳 114 + 二段跳 ≈85，与规则 14 的 link() 用的是同一个数。
 * 本波楼层 = 该波 spawn 里最低的那个 y（与 level.js waveFloorY 同定义；
 * 那边的 FLOOR_TOL=130 是另一件事：判「掉出战场」）。 */
L.forEach(function (lv, li) {
  var P = '[' + li + ' ' + lv.id + '] [规则20] ';
  (lv.waves || []).forEach(function (w) {
    if (!w.gate) return;                       // 不锁门就跑得掉，不构成死局
    var sp = (lv.spawns || []).filter(function (s) { return s.wave === w.id; });
    if (!sp.length) return;
    var fy = Math.max.apply(null, sp.map(function (s) { return s.y; }));
    sp.forEach(function (s) {
      if (fy - s.y > 190)
        E(P + 'wave' + w.id + ' 的 ' + s.type + ' @' + s.x + ',' + s.y +
          ' 比本波楼层 y=' + fy + ' 高 ' + (fy - s.y) +
          'px（>190＝满跳+二段跳）—— 玩家被 gate 锁在下面，够不到他，门不会开');
    });
  });
});

/* ══ 21. 同一层上的检查点必须按 x 递增 ═══════════════════════════
 * checkpoints 是按**推进顺序**写的，不保证按 x 排序（第二回三层客栈就不是）。
 * 运行时已改成「x 到了 **且** 脚底在那一层」才算到达检查点；
 * 但如果两个检查点在同一层而序号靠后的 x 更小，前一个就永远拿不到、
 * 后一个会被提前拿到 —— 同层的顺序必须自洽。
 * ★ 130 与 level.js 的 FLOOR_TOL 同值。 */
L.forEach(function (lv, li) {
  var P = '[' + li + ' ' + lv.id + '] [规则21] ';
  var cps = lv.checkpoints;
  for (var i = 0; i < cps.length; i++) {
    for (var j = i + 1; j < cps.length; j++) {
      if (Math.abs(cps[j][1] - cps[i][1]) > 130) continue;    // 不同层，互不干扰
      if (cps[j][0] <= cps[i][0])
        E(P + '检查点#' + j + ' @' + cps[j] + ' 与 #' + i + ' @' + cps[i] +
          ' 在同一层，但 x 没有递增 —— 玩家走到 #' + i + ' 时会直接拿到 #' + j);
    }
  }
});

/* ══ 23. 决议 012 —— 第一回第一波的刀客必须钉死招表 ═══════════════
 * 决议 012 路径三：教具刀客只出破雨，玩家才可能在同一条朱砂虚线上看第二遍、第三遍。
 * `only` 从 levels.js 的 spawn 一路透传到 ai.js:166 的招表；漏了不会报错，
 * 只会让教具变成一个「招式随机的普通刀客」，而观势的可发现性就少了一条腿。 */
(function () {
  var lv = L.filter(function (x) { return x.id === 'c1'; })[0];
  if (!lv) return E('[规则23] 找不到第一回');
  var w1 = (lv.spawns || []).filter(function (s) { return s.wave === 1; });
  if (!w1.length) return E('[规则23] 第一回第 1 波没有 spawn');
  var taught = w1.filter(function (s) { return s.only && s.only.length; });
  if (!taught.length)
    E('[1 c1] [规则23] 第 1 波的刀客没有带 only —— 决议 012 的教具没接上，' +
      '他会随机出招，玩家看不到同一条起手式第二遍');
  taught.forEach(function (s) {
    s.only.forEach(function (m) {
      if (MOVES.indexOf(m) < 0)
        E('[1 c1] [规则23] spawn@' + s.x + ' 的 only 里有不认识的招 "' + m + '"');
    });
  });
})();

/* ══ 22. 决议 023 —— 无门波次不阻塞后面的波（**用 harness 真跑**）════
 * 这条不能静态推：它断言的是运行时语义，而「静态看着没问题、跑起来卡住」
 * 正是这一波里所有软锁的共同形状。所以真的开一个沙盒，把局面摆成
 * 「无门波次留一个活口 + 玩家走到后一波的触发区」，然后看后一波刷不刷。
 * 现实原型：第五回第 2 波没有 gate，玩家把僧人打到 1 血就走人 —— 修之前，
 * 第 3 波（Boss 前那三个）整场再没出现过，不报错、玩家也不会察觉。 */
(function () {
  var boot;
  try { boot = require('./harness.js').boot; }
  catch (e) { return W('规则22 跳过：起不了 harness（' + e.message + '）'); }

  L.forEach(function (lv, li) {
    var P = '[' + li + ' ' + lv.id + '] [规则22] ';
    (lv.waves || []).forEach(function (w, wi) {
      if (w.gate) return;                                   // 有门的波语义不变
      var later = (lv.waves || []).filter(function (n, ni) {
        return ni > wi && (lv.spawns || []).some(function (s) { return s.wave === n.id; });
      });
      if (!later.length) return;                            // 后面没波次，不构成问题
      var N = later[0];

      var H = boot({ seed: 1, render: false });
      H.reset();
      H.load(li);
      var i;
      for (i = 0; i < 900 && H.where() !== 'level'; i++) {   // 点掉开场白
        H.hold(i % 6 === 0 ? { confirm: 1 } : {}); H.step();
      }
      if (H.where() !== 'level') return W(P + 'wave' + w.id + ' 的开场白点不掉，本条跳过');

      H.SJ.Level.spawnWave(w);                              // 摆局面：无门波刷出来
      H.hold({}); H.step();
      var foes = H.foes();
      if (foes.length < 1) return W(P + 'wave' + w.id + ' 没刷出敌人，本条跳过');
      for (i = 1; i < foes.length; i++) foes[i].hp = 0;      // 只留一个活口

      var fy = Math.max.apply(null, (lv.spawns || [])
        .filter(function (s) { return s.wave === N.id; })
        .map(function (s) { return s.y; }));
      var p = H.player();
      p.x = N.x + 4; p.y = fy - p.h; p.vx = 0; p.vy = 0;     // 玩家走到后一波的触发区（同层）
      for (i = 0; i < 30; i++) { H.hold({}); H.step(); }

      var rec = H.dbg().waves.filter(function (r) { return r.id === N.id; })[0];
      if (!rec || !rec.started)
        E(P + 'wave' + w.id + '（无 gate）留一个活口时，玩家走到 wave' + N.id +
          ' 的触发区，wave' + N.id + ' **没有刷** —— 后面所有波次都被这一个活口堵死了');
      else
        console.log('  [' + lv.id + '] 决议 023：wave' + w.id + '（无门）留活口后 wave' +
                    N.id + ' 仍能刷出 ✓');
    });
  });
})();

/* ══ 24. 门只锁同层（**用 harness 真跑**；Lead 补，用户实测软锁）══════
 * 现实原型：第二回三层触发第 5 波，玩家按下+跳下穿到一层，门在一层照样夹住 x≥1400，
 * 而回三层的台阶全在门外。断言两件事：玩家脚底离开波次楼层时门**不**夹；回到那一层门**仍**夹。 */
(function () {
  var boot;
  try { boot = require('./harness.js').boot; }
  catch (e) { return W('规则24 跳过：起不了 harness（' + e.message + '）'); }

  L.forEach(function (lv, li) {
    var P = '[' + li + ' ' + lv.id + '] [规则24] ';
    (lv.waves || []).forEach(function (w) {
      if (!w.gate) return;
      var sp = (lv.spawns || []).filter(function (s) { return s.wave === w.id; });
      if (!sp.length) return;
      var fy = Math.max.apply(null, sp.map(function (s) { return s.y; }));
      // 只测「门内还有别的楼层」的波：门 x 范围内存在脚底高度差 > 130 的实心地面
      var otherFloor = (lv.solids || []).some(function (b) {
        return b[0] < w.gate[1] && b[0] + b[2] > w.gate[0] && Math.abs(b[1] - fy) > 130;
      });
      if (!otherFloor) return;

      var H = boot({ seed: 1, render: false });
      H.reset(); H.load(li);
      var i;
      for (i = 0; i < 900 && H.where() !== 'level'; i++) { H.hold(i % 6 === 0 ? { confirm: 1 } : {}); H.step(); }
      if (H.where() !== 'level') return W(P + 'wave' + w.id + ' 的开场白点不掉，本条跳过');
      H.SJ.Level.spawnWave(w); H.hold({}); H.step();
      var p = H.player();

      // A. 同层：贴着门左界往左顶 40 帧，必须还在门内
      p.x = w.gate[0] + 30; p.y = fy - p.h; p.vx = 0; p.vy = 0;
      for (i = 0; i < 40; i++) { H.hold({ left: 1 }); H.step(); if (Math.abs((p.y + p.h) - fy) > 130) break; }
      if (p.x < w.gate[0] - 1) E(P + 'wave' + w.id + ' 玩家在波次楼层上，门却没锁住（x=' + (p.x|0) + ' < ' + w.gate[0] + '）');

      // B. 异层：把玩家放到门内**真实存在**的另一层地面上（优先楼下，对应「跳下楼」），往左顶 40 帧
      var floors = (lv.solids || []).filter(function (b) {
        return b[0] < w.gate[1] && b[0] + b[2] > w.gate[0] && Math.abs(b[1] - fy) > 130;
      }).sort(function (a, b) { return (b[1] - fy) - (a[1] - fy); });   // 最靠下的在前
      var b = floors[0];
      p.x = Math.max(w.gate[0] + 30, b[0] + 4); p.y = b[1] - p.h; p.vx = 0; p.vy = 0;
      for (i = 0; i < 3; i++) { H.hold({}); H.step(); }                  // 落稳
      if (Math.abs((p.y + p.h) - b[1]) > 20) return W(P + 'wave' + w.id + ' 异层摆位没站稳（脚底 ' + ((p.y + p.h)|0) + ' vs ' + b[1] + '），本条跳过');
      // 一直往左走，直到出门 / 被钉在门边 / 落回波次楼层 / 超时（走到门边所需帧数 + 余量）
      var need = Math.min(900, ((p.x - w.gate[0]) / 3.5 | 0) + 60), pinned = 0, back = false;
      for (i = 0; i < need; i++) {
        H.hold({ left: 1 }); H.step();
        if (p.x < w.gate[0] - 1) break;
        if (Math.abs((p.y + p.h) - fy) <= 130) { back = true; break; }   // 落回同层：该锁，不算
        if (Math.abs(p.x - w.gate[0]) < 0.5) { if (++pinned >= 6) break; }
      }
      if (pinned >= 6)
        E(P + 'wave' + w.id + ' 玩家已不在波次楼层（脚底 ' + ((p.y + p.h)|0) + ' vs ' + fy + '），门仍把人钉在 x=' +
          w.gate[0] + ' —— 跳下楼就回不去了');
      else if (back)
        W(P + 'wave' + w.id + ' 异层摆位走着走着落回了波次楼层，本条未验到门');
      else if (p.x >= w.gate[0])
        W(P + 'wave' + w.id + ' 异层往左走没出门也没被门钉住（x=' + (p.x|0) + '），可能是别的实心块挡住，未验到门');
      else console.log('  [' + lv.id + '] 门只锁同层：wave' + w.id + ' 同层锁 ✓ / 异层放 ✓');
    });
  });
})();

console.log('关卡数        : ' + L.length);
console.log('Σ expectedSec : ' + totalSec + ' 秒（' + (totalSec / 60).toFixed(1) + ' 分）  下限 1800 ' +
            (totalSec >= 1800 ? '✓' : '✗'));
var scr = 0;
L.forEach(function (lv) {
  var n = screens(lv.intro) + screens(lv.outro);
  lv.triggers.forEach(function (t) { if (t.event && t.event.play) n += screens(t.event.play); });
  if (lv.bossScript) ['pre','mid','down','p2','p3'].forEach(function (f) {
    if (lv.bossScript[f]) n += screens(lv.bossScript[f]);
  });
  scr += n;
  console.log('  ' + lv.id.padEnd(3) + ' ' + String(lv.expectedSec).padStart(4) + 's  ' +
              String(lv.encounters) + ' 遭遇  ' + String(n).padStart(3) + ' 屏  ' + lv.title);
});
console.log('剧情总屏数    : ' + scr + '（中性存档；按 3.4s/屏 = ' + Math.round(scr * 3.4) + 's）');
console.log('引用入口 key  : ' + Object.keys(usedKeys).length + ' / ' + realEntries.length);
warns.forEach(function (m) { console.log('⚠ ' + m); });
if (errs.length) {
  console.log('');
  errs.forEach(function (m) { console.log('✗ ' + m); });
  console.log('\n失败：' + errs.length + ' 个错误');
  process.exit(1);
}
console.log('\n全部通过。');
