/* dev/nav.js  【T1】导航：迷你物理模型 + 表面图 + BFS
 *
 * 这份模型是**照抄 src/entity/player.js 的积分顺序**写的，不是理论公式：
 *   重力 → control（走/跳/可变跳高截断）→ move（环境速度单独积分再合成位移）
 * 一帧扣一次重力这件事会让「理论 108px」变成实测 114px 左右，
 * 差的这 6px 正好是一级台阶的量级 —— 拿理论值规划会在第四回的 60px 台阶上翻车。
 * dev/jumpcal.js 每次都拿真沙盒交叉校验这份模型，对不上就红。
 */
'use strict';

const P = {
  RUN: 240, ACC: 3000, FRIC: 3200,
  G: 2400, MAXFALL: 1100,
  JUMP: -720, JUMP_SHORT: -420, JUMP2: -640,
  ENV_DRAG: 5,
  W: 26, H: 52,
  DT: 1 / 60
};

/* 一次跳跃的轨迹（相对起跳点，y 向下为正）。
 * opt: {vx 起跳水平速度, dir 方向, dbl 是否二段跳, windAx 环境水平加速度,
 *       hold 按住跳跃键的帧数, maxDrop 掉到多低就不再算} */
function simJump(opt) {
  opt = opt || {};
  const dir = opt.dir === undefined ? 1 : opt.dir;
  const windAx = opt.windAx || 0;
  const hold = opt.hold === undefined ? 14 : opt.hold;      // 按住跳跃键的帧数（≥8 才不被截断）
  const maxDrop = opt.maxDrop === undefined ? 900 : opt.maxDrop;
  const dt = P.DT;

  let vx = opt.vx === undefined ? P.RUN * dir : opt.vx;
  let vy = 0, x = 0, y = 0;
  let envVx = opt.envVx === undefined ? windAx / P.ENV_DRAG : opt.envVx;
  let jumped = false, dbl = false, prevHeld = false, dblStart = -1;
  const pts = [{ f: 0, x: 0, y: 0, vy: 0 }];
  const ed = Math.exp(-P.ENV_DRAG * dt);

  for (let f = 0; f < 400; f++) {
    // 1 重力（起跳那一帧也先扣，随后被 vy=JUMP 覆盖 —— 与 player.js 的顺序一致）
    vy += P.G * dt;
    if (vy > P.MAXFALL) vy = P.MAXFALL;

    // 2 control：机器人的按键策略（autoplay.js 必须照这个执行，否则模型白标定）
    //    起跳按住 hold 帧 → 松开 → 二段跳在**刚过顶点**（vy > -40）再按住 hold 帧
    let want;
    if (f < hold) want = true;
    else if (opt.dbl && !dbl && vy > -40) { want = true; dblStart = f; }
    else if (opt.dbl && dbl && dblStart >= 0 && f < dblStart + hold) want = true;
    else want = false;

    if (want && !prevHeld) {
      if (!jumped) { vy = P.JUMP; jumped = true; }
      else if (opt.dbl && !dbl) { vy = P.JUMP2; dbl = true; }
    }
    if (!want && prevHeld && vy < P.JUMP_SHORT) vy = P.JUMP_SHORT;   // 松手截断可变跳高
    prevHeld = want;

    vx += dir * P.ACC * dt;
    if (Math.abs(vx) > P.RUN) vx = dir * P.RUN;

    // 3 move：环境速度单独积分再合成位移（player.js move()）
    envVx += windAx * dt;
    envVx *= ed;
    if (Math.abs(envVx) < 0.5) envVx = 0;
    x += (vx + envVx) * dt;
    y += vy * dt;
    pts.push({ f: f + 1, x, y, vy });
    if (y > maxDrop) break;
  }
  return pts;
}

function jumpArc(opt) {
  const pts = simJump(Object.assign({ maxDrop: 4 }, opt));
  let rise = 0, run = 0;
  for (const q of pts) { if (-q.y > rise) rise = -q.y; run = Math.abs(q.x); }
  return { rise, run, frames: pts.length - 1, pts };
}

/* 缓存：给定 (dbl, windAx, dir) 的轨迹，问「要落到相对高度 dy 上，最远能horizontal走多少」 */
const arcCache = {};
function arcFor(dbl, windAx, dir) {
  const k = (dbl ? 'd' : 's') + ':' + windAx + ':' + dir;
  if (!arcCache[k]) arcCache[k] = simJump({ dbl, windAx, dir, maxDrop: 1200 });
  return arcCache[k];
}
/* 落到相对高度 dy（<0 = 更高）时能覆盖的最大水平距离；够不到返回 -1 */
function reachDx(dy, dbl, windAx, dir) {
  const pts = arcFor(dbl, windAx, dir);
  let best = -1;
  for (let i = 1; i < pts.length; i++) {
    // 下落中穿过目标高度的那一帧
    if (pts[i].vy > 0 && pts[i - 1].y <= dy && pts[i].y >= dy) best = Math.abs(pts[i].x);
    // 目标就在上升段之上也算够得着（贴边站上去）
    if (pts[i].vy <= 0 && pts[i].y <= dy && Math.abs(pts[i].x) > best) best = Math.abs(pts[i].x);
  }
  return best;
}
function maxRise(dbl, windAx, dir) {
  const pts = arcFor(dbl, windAx, dir);
  let r = 0;
  for (const q of pts) if (-q.y > r) r = -q.y;
  return r;
}

/* ── 表面图 ────────────────────────────────────────────────────────
 * 节点 = 一块可站立面的顶边。边 = walk（重叠/贴边）/ jump / fall / updraft。
 * 浮筏按它的**整段行程**建面（rule 14 也是这么做的）：等它过来就是路。 */
function buildSurfaces(solids, opt) {
  opt = opt || {};
  const out = [];
  for (const s of solids) {
    if (s.gone) continue;
    if (opt.skipVanish && s.vanish) continue;
    out.push({ x0: s.x, x1: s.x + s.w, y: s.y, oneway: !!s.oneway, vanish: !!s.vanish, solid: s });
  }
  for (const r of (opt.rafts || [])) {
    out.push({ x0: r.ax, x1: r.bx + r.w, y: r.y, oneway: true, raft: true });
  }
  return out;
}

/* 起跳点头顶的净空（脚底到最近天花板底面的距离）。
 * 没有这一条，图会认为「站在柱子顶上能跳到正头顶那层楼板」——
 * 而那层楼板在这里是**天花板**，玩家只会一头撞上去。
 * 第二回 1800 那根柱子正在三楼地板正下方，实测机器人在那儿蹦了 300 秒。 */
function headroom(solids, x, footY) {
  let ceil = -Infinity;
  for (const s of solids) {
    if (s.gone || s.oneway) continue;
    if (x < s.x || x > s.x + s.w) continue;
    const bot = s.y + s.h;
    if (bot <= footY - 2 && bot > ceil) ceil = bot;
  }
  return ceil === -Infinity ? Infinity : footY - ceil;
}

function buildGraph(surf, opt) {
  opt = opt || {};
  const windAx = opt.windAx || 0;
  const hazards = opt.hazards || [];
  const solids = opt.solids || [];
  const n = surf.length;
  const adj = [];
  for (let i = 0; i < n; i++) adj.push([]);

  const riseS = maxRise(false, windAx, 1), riseD = maxRise(true, windAx, 1);
  const riseSw = maxRise(false, windAx, -1), riseDw = maxRise(true, windAx, -1);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = surf[i], b = surf[j];
      const dy = b.y - a.y;
      const gapR = b.x0 - a.x1, gapL = a.x0 - b.x1;
      const dir = gapR >= gapL ? 1 : -1;          // b 主要在 a 的哪一侧
      const gap = Math.max(gapR, gapL, 0);
      const rise = dir > 0 ? { s: riseS, d: riseD } : { s: riseSw, d: riseDw };

      let kind = null, cost = gap + Math.abs(dy) * 0.5 + 1;
      if (dy < -6) {
        // 往上：起跳点与头顶净空都要成立
        let toX;
        if (b.oneway) {
          // 单向平台可以从正下方穿上去，起跳点不受限
          toX = dir > 0 ? Math.min(a.x1, Math.max(a.x0, b.x0)) : Math.max(a.x0, Math.min(a.x1, b.x1));
        } else if (dir > 0) {
          if (a.x1 <= b.x0) toX = a.x1;
          else if (a.x0 < b.x0) toX = b.x0 - 2;
          else continue;                                  // A 整段都埋在 B 底下 → 只会撞天花板
        } else {
          if (a.x0 >= b.x1) toX = a.x0;
          else if (a.x1 > b.x1) toX = b.x1 + 2;
          else continue;
        }
        const need = -dy + 54;                            // 脚要越过 B，头顶还得有玩家身高的余量
        if (headroom(solids, toX, a.y) < need) continue;
        if (-dy + 6 <= rise.s && gap <= Math.max(0, reachDx(dy, false, windAx, dir))) kind = 'jump';
        else if (-dy + 6 <= rise.d && gap <= Math.max(0, reachDx(dy, true, windAx, dir))) { kind = 'jump2'; cost += 40; }
      } else {
        // 平或往下：先看走得过去（重叠或贴得很近），否则跳/掉
        if (gap <= 2 && Math.abs(dy) <= 6) kind = 'walk';
        else if (gap <= Math.max(0, reachDx(dy, false, windAx, dir))) kind = 'fall';
        else if (gap <= Math.max(0, reachDx(dy, true, windAx, dir))) { kind = 'fall2'; cost += 40; }
      }
      if (!kind) continue;
      // 落点如果整段泡在 water/fire 里就不是路
      if (kind !== 'walk' && surfaceDrowned(b, hazards)) continue;
      adj[i].push({ to: j, kind, cost, dy, gap, dir });
    }
  }

  // 上升气流把上下两块地面接起来（第四回的断崖）
  for (const h of hazards) {
    if (h.kind !== 'updraft') continue;
    const grp = [];
    for (let i = 0; i < n; i++) {
      const q = surf[i];
      if (q.x1 >= h.x - 120 && q.x0 <= h.x + h.w + 120 &&
          q.y >= h.y - 80 && q.y <= h.y + h.h + 120) grp.push(i);
    }
    for (const a of grp) for (const b of grp) {
      if (a !== b && !adj[a].some(e => e.to === b)) adj[a].push({ to: b, kind: 'updraft', cost: 60, dy: surf[b].y - surf[a].y, gap: 0, dir: 1 });
    }
  }
  return adj;
}

function surfaceDrowned(s, hazards) {
  for (const h of hazards) {
    if (h.kind !== 'water') continue;
    if (s.x0 >= h.x && s.x1 <= h.x + h.w && s.y >= h.y - 4 && s.y <= h.y + h.h) return true;
  }
  return false;
}

/* 玩家脚下那块面 */
function surfaceUnder(surf, x, footY, tol) {
  tol = tol === undefined ? 8 : tol;
  let best = -1, bd = 1e9;
  for (let i = 0; i < surf.length; i++) {
    const q = surf[i];
    if (x < q.x0 - 6 || x > q.x1 + 6) continue;
    const d = Math.abs(q.y - footY);
    if (d <= tol && d < bd) { bd = d; best = i; }
  }
  if (best >= 0) return best;
  // 不在地上（跳跃中）：取正下方最近的一块
  for (let i = 0; i < surf.length; i++) {
    const q = surf[i];
    if (x < q.x0 - 6 || x > q.x1 + 6) continue;
    const d = q.y - footY;
    if (d >= -4 && d < bd) { bd = d; best = i; }
  }
  return best;
}

/* Dijkstra（边权小、点少，直接 O(n²) 取最小） */
function route(adj, from, targets) {
  const n = adj.length;
  const dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  dist[from] = 0;
  for (;;) {
    let u = -1, bd = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
    if (u < 0) break;
    done[u] = true;
    for (const e of adj[u]) {
      if (dist[u] + e.cost < dist[e.to]) { dist[e.to] = dist[u] + e.cost; prev[e.to] = u; }
    }
  }
  let best = -1, bd = Infinity;
  for (const t of targets) if (dist[t] < bd) { bd = dist[t]; best = t; }
  if (best < 0) return null;
  const path = [];
  for (let v = best; v >= 0; v = prev[v]) path.unshift(v);
  return { path, cost: bd, goal: best };
}

module.exports = { P, simJump, jumpArc, reachDx, maxRise, arcFor,
                   buildSurfaces, buildGraph, surfaceUnder, route, surfaceDrowned };
