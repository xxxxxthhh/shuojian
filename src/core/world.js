// 【A】AABB 逐轴推出 + 单向平台 + 下穿。moveX/moveY 内部做 8px 步进细分，防高速穿墙。
(function (SJ) {
  'use strict';

  var MAXSTEP = 8;
  var solids = [];

  function norm(s) {
    if (Object.prototype.toString.call(s) === '[object Array]') {
      var f = s[4] || 0;
      return { x: s[0], y: s[1], w: s[2], h: s[3],
               oneway: f === 1, vanish: f === 2, gone: false, flag: f };
    }
    if (s.oneway === undefined) s.oneway = s.flag === 1;
    if (s.vanish === undefined) s.vanish = s.flag === 2;
    if (s.gone === undefined) s.gone = false;
    return s;
  }

  function overlaps(b, s) {
    return b.x < s.x + s.w && b.x + b.w > s.x &&
           b.y < s.y + s.h && b.y + b.h > s.y;
  }

  SJ.World = {

    solids: solids,

    load: function (level) {
      solids.length = 0;
      var arr = (level && level.solids) || [];
      for (var i = 0; i < arr.length; i++) solids.push(norm(arr[i]));
      return solids;
    },

    addSolid: function (s) {
      var n = norm(s);
      solids.push(n);
      return n;
    },

    removeSolid: function (s) {
      var i = solids.indexOf(s);
      if (i >= 0) solids.splice(i, 1);
    },

    moveX: function (body, dx) {
      if (!dx) return false;
      var sign = dx < 0 ? -1 : 1, remain = Math.abs(dx), hit = false;
      while (remain > 1e-4) {
        var st = remain < MAXSTEP ? remain : MAXSTEP;
        remain -= st;
        body.x += st * sign;
        for (var i = 0; i < solids.length; i++) {
          var s = solids[i];
          if (s.gone || s.oneway) continue;
          if (!overlaps(body, s)) continue;
          body.x = sign > 0 ? s.x - body.w : s.x + s.w;
          body.vx = 0;
          hit = true;
          break;
        }
        if (hit) break;
      }
      return hit;
    },

    moveY: function (body, dy) {
      if (!dy) return false;   // dt=0（hitstop）时不动、也不清 onGround

      // dropThrough=true → 由 World 自己起一个 0.2s 的忽略窗口，调用方不必维护计时
      if (body.dropThrough === true) {
        body.dropThroughUntil = SJ.Game.time + 0.2;
        body.dropThrough = false;
      }
      var ignoreOneway = !!body.dropThrough ||
                         (body.dropThroughUntil || -1e9) > SJ.Game.time;

      body.onGround = false;
      var sign = dy < 0 ? -1 : 1, remain = Math.abs(dy), hit = false;
      while (remain > 1e-4) {
        var st = remain < MAXSTEP ? remain : MAXSTEP;
        remain -= st;
        var prevBottom = body.y + body.h;
        body.y += st * sign;
        for (var i = 0; i < solids.length; i++) {
          var s = solids[i];
          if (s.gone) continue;
          if (s.oneway) {
            if (ignoreOneway) continue;
            if (sign < 0) continue;                 // 上升穿过
            if (prevBottom > s.y + 0.5) continue;   // 上一步脚底已经不在平台顶之上
          }
          if (!overlaps(body, s)) continue;
          if (sign > 0) { body.y = s.y - body.h; body.onGround = true; }
          else { body.y = s.y + s.h; }
          body.vy = 0;
          hit = true;
          break;
        }
        if (hit) break;
      }
      return hit;
    },

    // 从 yFrom 向下找最近的可站立面（含单向平台）
    groundAt: function (x, yFrom) {
      var best = null;
      for (var i = 0; i < solids.length; i++) {
        var s = solids[i];
        if (s.gone) continue;
        if (x < s.x || x > s.x + s.w) continue;
        if (s.y < yFrom) continue;
        if (best === null || s.y < best) best = s.y;
      }
      return best;
    },

    // 视线是否被实心块挡住（单向平台不挡视线）
    lineBlocked: function (x1, y1, x2, y2) {
      var dx = x2 - x1, dy = y2 - y1;
      for (var i = 0; i < solids.length; i++) {
        var s = solids[i];
        if (s.gone || s.oneway) continue;
        var t0 = 0, t1 = 1, a, b, tmp;

        if (Math.abs(dx) < 1e-9) {
          if (x1 < s.x || x1 > s.x + s.w) continue;
        } else {
          a = (s.x - x1) / dx; b = (s.x + s.w - x1) / dx;
          if (a > b) { tmp = a; a = b; b = tmp; }
          if (a > t0) t0 = a;
          if (b < t1) t1 = b;
          if (t0 > t1) continue;
        }

        if (Math.abs(dy) < 1e-9) {
          if (y1 < s.y || y1 > s.y + s.h) continue;
        } else {
          a = (s.y - y1) / dy; b = (s.y + s.h - y1) / dy;
          if (a > b) { tmp = a; a = b; b = tmp; }
          if (a > t0) t0 = a;
          if (b < t1) t1 = b;
          if (t0 > t1) continue;
        }
        return true;
      }
      return false;
    }
  };

})(window.SJ = window.SJ || {});
