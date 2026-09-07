/* src/ui/hud.js  【H · UI与剧情演出】
 * 战斗内 HUD：血是朱砂圆点，墨是一枚墨滴读数（不是条），招式槽是淡墨方框，
 * 残墨（学习进度）是一枚细环。DESIGN §3.1：「墨的 HUD 不是条，是画面本身」——
 * 世界褪色本身由 G 在 Level.draw 里读 SJ.Player.inkTint() 实现，
 * 这里只画那枚墨滴的读数，不做任何全屏效果。
 *
 * SJ.Tech.defs 的形状契约里写的是「object」，但 dev/check.html 自己也留了
 * 「万一是数组」的兜底判断——这里跟随同一个已被 Lead 认可的宽容读法。
 */
(function (SJ) {
  'use strict';

  var notices = []; // {str, t0}

  function techLookup(id) {
    if (!id || !SJ.Tech || !SJ.Tech.defs) return null;
    var d = SJ.Tech.defs;
    if (d[id]) return d[id];
    if (d.length) { for (var i = 0; i < d.length; i++) if (d[i] && d[i].id === id) return d[i]; }
    return null;
  }

  function ringPts(cx, cy, r) {
    var n = 16, pts = [], i, a;
    for (i = 0; i <= n; i++) { a = i / n * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    return pts;
  }

  // ── 血：朱砂圆点，每颗 20 点，正在掉的那一颗按比例透明度渐显 ──────
  function drawHearts(g, p) {
    var maxHp = p.maxHp || 60, hp = p.hp != null ? p.hp : maxHp;
    var n = Math.max(1, Math.round(maxHp / 20));
    var r = 7, gap = 20, x0 = 27, y = 26, i, x, seg;
    for (i = 0; i < n; i++) {
      x = x0 + i * gap;
      seg = SJ.clamp(hp - i * 20, 0, 20) / 20;
      g.save();
      g.globalAlpha = 0.28;
      SJ.Ink.stroke(g, ringPts(x, y, r), { w0: 1.3, w1: 1.0, color: SJ.C.ink, alpha: 1, seed: i + 200, hairs: 0, taper: false });
      g.restore();
      if (seg > 0) SJ.Ink.blob(g, x, y, r * 0.80, 300 + i, { color: SJ.C.cinnabar, alpha: 0.28 + seg * 0.66, rough: 0.22 });
    }
  }

  // ── 墨：一枚墨滴，液面按 ink/100 从底部往上填 ─────────────────────
  function dropPath(g, x, y, w, h) {
    g.beginPath();
    g.moveTo(x, y - h * 0.62);
    g.bezierCurveTo(x + w * 0.62, y - h * 0.05, x + w * 0.5, y + h * 0.5, x, y + h * 0.62);
    g.bezierCurveTo(x - w * 0.5, y + h * 0.5, x - w * 0.62, y - h * 0.05, x, y - h * 0.62);
    g.closePath();
  }

  function drawInkDrop(g, p) {
    var x = 27, y = 66, w = 14, h = 20;
    var ink = SJ.clamp(p.ink != null ? p.ink : 100, 0, 100) / 100;
    g.save();
    g.save();
    dropPath(g, x, y, w, h);
    g.clip();
    var top = y - h * 0.62, bottom = y + h * 0.62;
    var fy = bottom - (bottom - top) * ink;
    g.globalAlpha = 0.82;
    g.fillStyle = SJ.C.ink;
    g.fillRect(x - w, fy, w * 2, (bottom - fy) + 4);
    g.restore();
    g.globalAlpha = 0.52;
    dropPath(g, x, y, w, h);
    g.lineWidth = 1.3; g.strokeStyle = SJ.C.ink; g.stroke();
    g.restore();
  }

  // ── 残墨（学习中的那一招）：细环，中心一个招名首字 ────────────────
  function drawProgressRing(g) {
    if (!SJ.Tech || !SJ.Tech.progress) return;
    var prog = SJ.Tech.progress, id = null, val = 0, k;
    for (k in prog) { if (prog[k] > 0 && prog[k] < 100) { id = k; val = prog[k]; break; } }
    if (!id) return;
    var cx = 60, cy = 66, r = 14;
    g.save();
    g.globalAlpha = 0.30;
    SJ.Ink.arcStroke(g, cx, cy, r, -Math.PI / 2, Math.PI * 1.5, 2, { color: SJ.C.ink, alpha: 1, hairs: 0 });
    g.globalAlpha = 0.9;
    SJ.Ink.arcStroke(g, cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * SJ.clamp(val / 100, 0, 1), 2.6, {
      color: SJ.C.gamboge, alpha: 1, hairs: 0
    });
    var def = techLookup(id);
    if (def && def.name) {
      g.font = '600 11px ' + SJ.FONT;
      g.fillStyle = SJ.C.ink; g.globalAlpha = 0.72;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(def.name.charAt(0), cx, cy + 1);
    }
    g.restore();
  }

  // ── 招式槽：四格淡墨方框，占用的格子里放招名首字；不可用时压暗 ────
  function drawSlots(g, p) {
    var slots = p.slots || [null, null, null, null];
    var size = 30, gap = 8, n = 4;
    var totalW = n * size + (n - 1) * gap;
    var x0 = (SJ.W - totalW) / 2, y = SJ.H - size - 18, i, x, id, usable, def, ch;
    for (i = 0; i < n; i++) {
      x = x0 + i * (size + gap);
      id = slots[i];
      usable = id ? (SJ.Tech && SJ.Tech.can ? !!SJ.Tech.can(p, id) : true) : false;
      g.save();
      g.globalAlpha = id ? (usable ? 0.85 : 0.34) : 0.20;
      SJ.Ink.wash(g, x, y, size, size, { color: SJ.C.inkLight, alpha: 0.5, dir: 'v', both: true });
      SJ.Ink.stroke(g, [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]], {
        w0: 1.3, w1: 1.0, color: SJ.C.ink, alpha: 1, seed: 500 + i, hairs: 0, taper: false
      });
      if (id) {
        def = techLookup(id);
        ch = def && def.name ? def.name.charAt(0) : '';
        if (ch) {
          g.font = '600 ' + (size * 0.5) + 'px ' + SJ.FONT;
          g.fillStyle = SJ.C.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(ch, x + size / 2, y + size / 2 + 1);
        }
      }
      g.restore();
    }
  }

  function drawNotice(g) {
    if (!notices.length) return;
    var t = SJ.Game.time;
    while (notices.length && t - notices[0].t0 > 2.4) notices.shift();
    if (!notices.length) return;
    var n = notices[notices.length - 1], el = t - n.t0, a;
    a = el < 0.3 ? el / 0.3 : (el > 1.8 ? SJ.clamp(1 - (el - 1.8) / 0.6, 0, 1) : 1);
    if (a <= 0) return;
    g.save();
    g.font = '500 18px ' + SJ.FONT;
    g.fillStyle = SJ.C.ink; g.globalAlpha = a * 0.85;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(n.str, SJ.W / 2, 34);
    g.restore();
  }

  SJ.HUD = {
    draw: function (g, p) {
      if (!p) return;
      drawHearts(g, p);
      drawInkDrop(g, p);
      drawProgressRing(g);
      drawSlots(g, p);
      drawNotice(g);
    },

    notice: function (str) {
      notices.push({ str: str, t0: SJ.Game.time });
    }
  };

})(window.SJ = window.SJ || {});
