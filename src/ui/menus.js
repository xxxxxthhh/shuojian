/* src/ui/menus.js  【H · UI与剧情演出】
 * 全部菜单场景。硬约束（Lead 指派 + 决议）：标题画面只有「始／继／音」三项，
 * 任何菜单都不出现按键说明／教程／玩法介绍页。
 *
 * 三处跨模块假设（已同步 team-lead，等 E/G 落地后如有出入以对方实现为准，
 * 详见 _spec/notes-H.md「待确认」一节）：
 *   1. 换招 SJ.Menu.slots() 直接读写 SJ.Save.data.known / SJ.Save.data.slots，
 *      不经过 SJ.Player——假设 E 的 SJ.Player.create 让 p.slots 与这个数组同引用。
 *   2. SJ.Menu.gameover() 确认后调用 SJ.Level.load(SJ.Save.data.chapter, true)
 *      回到本章最近检查点（checkpoint 参数按契约 SJ.Level.load(idx, checkpoint) 的形状假设为真值）。
 *   3. 「始」= SJ.Save.reset() + SJ.Level.load(0)；「继」= SJ.Level.load(SJ.Save.data.chapter)。
 */
(function (SJ) {
  'use strict';

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return (h > 0 ? h + '时' : '') + m + '分';
  }

  function techLookup(id) {
    if (!id || !SJ.Tech || !SJ.Tech.defs) return null;
    var d = SJ.Tech.defs;
    if (d[id]) return d[id];
    if (d.length) { for (var i = 0; i < d.length; i++) if (d[i] && d[i].id === id) return d[i]; }
    return null;
  }

  // 只在真实用户手势里解锁一次 AudioContext（浏览器自动播放策略要求）
  var audioUnlockArmed = false;
  function armAudioUnlock() {
    if (audioUnlockArmed) return;
    audioUnlockArmed = true;
    function go() {
      SJ.Audio.init();
      window.removeEventListener('keydown', go, true);
      window.removeEventListener('mousedown', go, true);
    }
    window.addEventListener('keydown', go, true);
    window.addEventListener('mousedown', go, true);
  }

  function drawBackdrop(g) {
    SJ.Ink.paper(g, 0, 0);
    SJ.Ink.mountains(g, 0, 2, {});
    SJ.Ink.mountains(g, 0, 1, {});
  }

  function dim(g, alpha) {
    g.save();
    g.fillStyle = SJ.C.ink;
    g.globalAlpha = alpha;
    g.fillRect(0, 0, SJ.W, SJ.H);
    g.restore();
  }

  // ══ 标题：始／继／音——仅此三项，硬性要求 ═══════════════════════════
  var titleSel = 0;
  var TITLE_ITEMS = ['始', '继', '音'];

  var titleScene = {
    enter: function () {
      armAudioUnlock();
      titleSel = 0;
    },
    update: function () {
      if (SJ.Input.pressed('left') || SJ.Input.pressed('up')) titleSel = (titleSel + 2) % 3;
      if (SJ.Input.pressed('right') || SJ.Input.pressed('down')) titleSel = (titleSel + 1) % 3;
      if (SJ.Input.pressed('confirm')) {
        if (SJ.Audio.ready) SJ.Audio.sfx('uiConfirm');
        if (titleSel === 0) { SJ.Save.reset(); SJ.Level.load(0); }
        else if (titleSel === 1) { SJ.Level.load(SJ.Save.data.chapter); }
        else { SJ.Audio.setMute(!SJ.Audio.muted); }
      }
    },
    draw: function (g) {
      drawBackdrop(g);
      var W = SJ.W;
      SJ.Ink.vtext(g, '说剑', W / 2 + 36, 68, 82, { color: SJ.C.ink, alpha: 0.92 });

      var gap = 92, x0 = W / 2 - gap, i;
      for (i = 0; i < 3; i++) {
        var x = x0 + i * gap, sel = (i === titleSel);
        var muted = (i === 2 && SJ.Audio.muted);
        g.save();
        g.globalAlpha = muted ? 0.40 : (sel ? 0.96 : 0.55);
        SJ.Ink.vtext(g, TITLE_ITEMS[i], x, 372, 34, { color: sel ? SJ.C.cinnabar : SJ.C.ink, alpha: 1 });
        g.restore();
        if (sel) {
          var mk = 0.5 + 0.5 * Math.sin(SJ.Game.time * 3);
          SJ.Ink.blob(g, x, 372 + 34 * 1.14 + 14, 2.6, 60 + i, { color: SJ.C.cinnabar, alpha: 0.5 + mk * 0.4, rough: 0.3 });
        }
        if (muted) {
          SJ.Ink.stroke(g, [[x - 13, 372 - 8], [x + 11, 372 + 42]], {
            w0: 1.6, w1: 1.0, color: SJ.C.ink, alpha: 0.55, seed: 90, hairs: 0
          });
        }
      }
    },
    exit: function () {}
  };

  // ══ 暂停：继续／换招／音／出——同样不解释按键，只给出四个词 ══════════
  var pauseSel = 0;
  var PAUSE_ITEMS = ['继续', '换招', '音', '出'];

  var pauseScene = {
    enter: function () { pauseSel = 0; },
    update: function () {
      if (SJ.Input.pressed('left')) pauseSel = (pauseSel + 3) % 4;
      if (SJ.Input.pressed('right')) pauseSel = (pauseSel + 1) % 4;
      if (SJ.Input.pressed('pause')) { SJ.Audio.sfx('uiBack'); SJ.Game.pop(); return; }
      if (SJ.Input.pressed('confirm')) {
        SJ.Audio.sfx('uiConfirm');
        if (pauseSel === 0) SJ.Game.pop();
        else if (pauseSel === 1) SJ.Menu.slots();
        else if (pauseSel === 2) SJ.Audio.setMute(!SJ.Audio.muted);
        else SJ.Menu.title();
      }
    },
    draw: function (g) {
      var W = SJ.W, H = SJ.H;
      dim(g, 0.34);
      var gap = 108, x0 = W / 2 - gap * 1.5, i;
      for (i = 0; i < 4; i++) {
        var x = x0 + i * gap, sel = i === pauseSel;
        var label = (i === 2 && SJ.Audio.muted) ? '静' : PAUSE_ITEMS[i];
        g.save();
        g.globalAlpha = sel ? 0.96 : 0.52;
        SJ.Ink.vtext(g, label, x, H / 2 - 50, 26, { color: sel ? SJ.C.cinnabar : SJ.C.paper, alpha: 1 });
        g.restore();
        if (sel) SJ.Ink.blob(g, x, H / 2 - 50 + label.length * 26 * 1.14 + 14, 2.6, 61 + i, {
          color: SJ.C.cinnabar, alpha: 0.7, rough: 0.3
        });
      }
    },
    exit: function () {}
  };

  // ══ 换招：四槽 × 已学招式，DESIGN §3.2「换招是玩法的一部分」════════
  var slotsCur = 0;

  var slotsScene = {
    enter: function () { slotsCur = 0; },
    update: function () {
      var known = SJ.Save.data.known || [];
      var slots = SJ.Save.data.slots || (SJ.Save.data.slots = [null, null, null, null]);
      if (SJ.Input.pressed('left')) slotsCur = (slotsCur + 3) % 4;
      if (SJ.Input.pressed('right')) slotsCur = (slotsCur + 1) % 4;
      if (SJ.Input.pressed('up') || SJ.Input.pressed('down')) {
        var dir = SJ.Input.pressed('up') ? -1 : 1;
        var options = [null].concat(known);
        var idx = options.indexOf(slots[slotsCur]);
        if (idx < 0) idx = 0;
        var tries = 0, cand;
        do {
          idx = (idx + dir + options.length) % options.length;
          cand = options[idx];
          tries++;
        } while (tries <= options.length && cand !== null &&
                 slots.indexOf(cand) !== -1 && slots.indexOf(cand) !== slotsCur);
        slots[slotsCur] = cand;
        SJ.Save.save();
        if (SJ.Audio.ready) SJ.Audio.sfx('ui');
      }
      if (SJ.Input.pressed('pause') || SJ.Input.pressed('confirm')) {
        if (SJ.Audio.ready) SJ.Audio.sfx('uiBack');
        SJ.Game.pop();
      }
    },
    draw: function (g) {
      var W = SJ.W, H = SJ.H;
      dim(g, 0.32);
      var known = SJ.Save.data.known || [];
      var slots = SJ.Save.data.slots || [];
      var i, def, ch;

      // 已学招式一览（顶部小字，已在槽里的压暗）
      for (i = 0; i < known.length; i++) {
        def = techLookup(known[i]);
        ch = def && def.name ? def.name.charAt(0) : '？';
        g.save();
        g.globalAlpha = slots.indexOf(known[i]) !== -1 ? 0.32 : 0.85;
        SJ.Ink.vtext(g, ch, 58 + i * 30, 56, 22, { color: SJ.C.paper, alpha: 1 });
        g.restore();
      }

      // 四个槽位
      var size = 74, gap = 24, n = 4, totalW = n * size + (n - 1) * gap;
      var x0 = (W - totalW) / 2, y = H / 2 - size / 2 + 40;
      for (i = 0; i < 4; i++) {
        var x = x0 + i * (size + gap), sel = i === slotsCur;
        g.save();
        g.globalAlpha = sel ? 0.55 : 0.28;
        SJ.Ink.wash(g, x, y, size, size, { color: SJ.C.paper, alpha: 0.6, dir: 'v', both: true });
        SJ.Ink.stroke(g, [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]], {
          w0: sel ? 2.2 : 1.3, w1: sel ? 1.6 : 1.0, color: sel ? SJ.C.cinnabar : SJ.C.paper,
          alpha: 1, seed: 700 + i, hairs: 0, taper: false
        });
        g.restore();
        var id = slots[i];
        if (id) {
          def = techLookup(id);
          ch = def && def.name ? def.name.charAt(0) : '？';
          g.save();
          g.font = '600 ' + (size * 0.46) + 'px ' + SJ.FONT;
          g.fillStyle = SJ.C.paper; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.globalAlpha = 0.92;
          g.fillText(ch, x + size / 2, y + size / 2 + 2);
          g.restore();
        }
      }
    },
    exit: function () {}
  };

  // ══ 死亡：无字，一枚渐亮的墨点邀人按下确认 ═══════════════════════
  var goT0 = 0;

  var gameoverScene = {
    enter: function () { goT0 = SJ.Game.time; },
    update: function () {
      var el = SJ.Game.time - goT0;
      if (el < 0.5) return;
      if (SJ.Input.pressed('confirm')) {
        SJ.Game.pop();
        SJ.Level.load(SJ.Save.data.chapter, true);
      }
    },
    draw: function (g) {
      dim(g, 0.5);
      var breathe = 0.4 + 0.3 * (Math.sin(SJ.Game.time * 2) * 0.5 + 0.5);
      SJ.Ink.blob(g, SJ.W / 2, SJ.H / 2, 3, 5, { color: SJ.C.paper, alpha: breathe, rough: 0.3 });
    },
    exit: function () {}
  };

  // ══ 结局：集大成列「谁的影子」，其余三支只留一句静场 + 时长 ═════════
  var endingKind = 'mid';

  var endingScene = {
    enter: function (data) { endingKind = (data && data.kind) || 'mid'; },
    update: function () {
      if (SJ.Input.pressed('confirm')) {
        if (SJ.Audio.ready) SJ.Audio.sfx('uiConfirm');
        SJ.Menu.title();
      }
    },
    draw: function (g) {
      SJ.Ink.paper(g, 0, 0);
      var W = SJ.W, H = SJ.H, i;
      if (endingKind === 'all') {
        var known = SJ.Save.data.known || [];
        var n = known.length, gap = 62, x0 = W / 2 + (n - 1) * gap / 2;
        for (i = 0; i < n; i++) {
          var def = techLookup(known[i]);
          var name = def && def.name ? def.name : '？';
          var from = def && def.from ? def.from : '';
          var x = x0 - i * gap;
          SJ.Ink.vtext(g, name, x, 128, 20, { color: SJ.C.ink, alpha: 0.85 });
          if (from) SJ.Ink.vtext(g, from, x, 128 + name.length * 20 * 1.14 + 16, 14, {
            color: SJ.C.inkLight, alpha: 0.7
          });
        }
      }
      SJ.Ink.htext(g, fmtTime(SJ.Save.data.playtimeSec), W / 2, H - 56, 16, { color: SJ.C.inkLight, alpha: 0.6 });
    },
    exit: function () {}
  };

  SJ.Menu = {
    title: function () { SJ.Game.setScene(titleScene); },
    pause: function () { SJ.Game.push(pauseScene); },
    slots: function () { SJ.Game.push(slotsScene); },
    gameover: function () { SJ.Game.push(gameoverScene); },
    ending: function (kind) { SJ.Game.setScene(endingScene, { kind: kind }); }
  };

})(window.SJ = window.SJ || {});
