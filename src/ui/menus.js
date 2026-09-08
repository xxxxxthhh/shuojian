/* src/ui/menus.js  【H · UI与剧情演出】
 * 全部菜单场景。硬约束（Lead 指派 + 决议）：标题画面只有「始／继／音」三项，
 * 任何菜单都不出现按键说明／教程／玩法介绍页。
 *
 * 决议 006/007（Lead 裁定，已落地，不再是假设）：
 *   1. 换招走 SJ.Player.setSlot(i, moveId)（E 实现，唯一写入者），
 *      可选招式读 SJ.player.known——不读 SJ.Save.data.slots 的共享引用
 *      （读档会换掉整个 data 对象，别名会静默断开）。
 *   2. 死亡确认后调用 SJ.Level.restartFromCheckpoint()（G 实现，不用关心检查点怎么编码）。
 *   3. 「始」＝二次确认（无存档一次到位；有存档需再按一次，靠字变朱砂提示）
 *      → SJ.Save.reset() + SJ.Level.load(0)；
 *      「继」＝ SJ.Level.load(SJ.Save.data.chapter)，无存档时变暗、不可选但仍显示。
 *   4. 标题／暂停／换招／结算四个 scene 设 countsPlaytime=false
 *      （playtimeSec 由 Game 用 rawDt 累加，挂在菜单里不算游玩时间）。
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

  // ══ 音量条（决议 017）══════════════════════════════════════════
  // 「音」不再是开关，是一条可调的墨线：J 进去，← → 调，J（或 Esc）收工。
  // 必须做成子模式 —— 标题与暂停的 ← → 本来都是切菜单项，进了音量才归音量。
  // 不写字、不写数字（DESIGN §0 铁律 3：不做教程弹窗）。muted 与 setMute 不动。
  var volEdit = false, volHold = 0, VOL_STEP = 0.1;

  function volEnter() {
    volEdit = true; volHold = 0;
    // 顺手解锁 AudioContext：调音量总得听得见。浏览器可能拒绝建 ctx（自动播放策略、
    // 无头环境），拒绝了也只是没声音，不能把菜单带崩。
    try { SJ.Audio.init(); } catch (e) {}
  }

  // 返回 true = 这一帧的输入被音量条吃掉了，菜单本体不要再处理
  function volUpdate(dt) {
    if (!volEdit) return false;
    var I = SJ.Input, d = 0;
    if (I.pressed('left')) { d = -1; volHold = 0; }
    else if (I.pressed('right')) { d = 1; volHold = 0; }
    else if (I.down('left') || I.down('right')) {
      volHold += dt || 0;                 // 按住连调：从满到零约 1.5s，不用点十下
      if (volHold > 0.35) { volHold -= 1 / 6; d = I.down('left') ? -1 : 1; }
    } else volHold = 0;
    if (d) {
      SJ.Audio.setVolume(Math.round((SJ.Audio.getVolume() + d * VOL_STEP) * 100) / 100);
      if (SJ.Audio.ready) SJ.Audio.sfx('ui');
    }
    if (I.pressed('confirm') || I.pressed('pause')) {
      volEdit = false;
      if (SJ.Audio.ready) SJ.Audio.sfx('uiConfirm');
    }
    return true;
  }

  // 一条墨线 + 一枚朱砂点。线的长短就是音量，不需要任何说明。
  function drawVolBar(g, cx, y, w, color) {
    var v = SJ.Audio.getVolume(), x0 = cx - w / 2, hx = x0 + w * v, br;
    SJ.Ink.stroke(g, [[x0, y], [x0 + w, y]], {
      w0: 1.6, w1: 1.3, color: color, alpha: 0.28, taper: false, hairs: 0, core: false, seed: 210
    });
    if (v > 0.001) SJ.Ink.stroke(g, [[x0, y], [hx, y]], {
      w0: 4.4, w1: 3.6, color: color, alpha: 0.80, taper: false, hairs: 0, core: false, seed: 211
    });
    br = volEdit ? (0.62 + 0.38 * Math.sin(SJ.Game.time * 5)) : 0.5;
    SJ.Ink.blob(g, hx, y, 4.2, 212, { color: SJ.C.cinnabar, alpha: br, rough: 0.3 });
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
  // 「始」在已有存档时需二次确认（决议 007 §3）：第一次按确认只把它「点亮」
  // （armed=true，字变朱砂、心跳加速），第二次按确认才真的清档重开。
  // 选别的项、或超过 ARM_TIMEOUT 没再按，armed 自动解除。
  var titleSel = 0;
  var TITLE_ITEMS = ['始', '继', '音'];
  var startArmed = false, startArmedT = 0;
  var ARM_TIMEOUT = 2.5;

  var titleScene = {
    countsPlaytime: false,
    enter: function () {
      armAudioUnlock();
      titleSel = 0;
      startArmed = false;
    },
    update: function (dt) {
      if (volUpdate(dt)) return;          // 音量条开着时 ← → 归它，不切菜单项
      var hasSave = SJ.Save.exists();
      if (startArmed) {
        startArmedT += dt;
        if (startArmedT > ARM_TIMEOUT) startArmed = false;
      }
      if (SJ.Input.pressed('left') || SJ.Input.pressed('up')) {
        titleSel = (titleSel + 2) % 3;
        if (titleSel === 1 && !hasSave) titleSel = 0; // 「继」无存档时不可选，跳过
        if (titleSel !== 0) startArmed = false;
      }
      if (SJ.Input.pressed('right') || SJ.Input.pressed('down')) {
        titleSel = (titleSel + 1) % 3;
        if (titleSel === 1 && !hasSave) titleSel = 2;
        if (titleSel !== 0) startArmed = false;
      }
      if (SJ.Input.pressed('confirm')) {
        if (titleSel === 0) {
          if (hasSave && !startArmed) {
            startArmed = true; startArmedT = 0;
            if (SJ.Audio.ready) SJ.Audio.sfx('ui');
          } else {
            if (SJ.Audio.ready) SJ.Audio.sfx('uiConfirm');
            SJ.Save.reset();
            // 残墨进度只在内存里（DESIGN §8 的存档结构没有这一项），
            // 不重置的话新档会带着上一周目的进度：第一次挨打就直接「悟」。
            if (SJ.Tech && SJ.Tech.resetProgress) SJ.Tech.resetProgress();
            SJ.Level.load(0);
          }
        } else if (titleSel === 1) {
          if (hasSave) { if (SJ.Audio.ready) SJ.Audio.sfx('uiConfirm'); SJ.Level.load(SJ.Save.data.chapter); }
        } else {
          if (SJ.Audio.ready) SJ.Audio.sfx('uiConfirm');
          volEnter();
        }
      }
    },
    draw: function (g) {
      drawBackdrop(g);
      var W = SJ.W, hasSave = SJ.Save.exists();
      SJ.Ink.vtext(g, '说剑', W / 2 + 36, 68, 82, { color: SJ.C.ink, alpha: 0.92 });

      var gap = 92, x0 = W / 2 - gap, i;
      for (i = 0; i < 3; i++) {
        var x = x0 + i * gap, sel = (i === titleSel);
        var muted = (i === 2 && SJ.Audio.muted);
        var disabled = (i === 1 && !hasSave);
        var armed = (i === 0 && startArmed);
        var col = (sel || armed) ? SJ.C.cinnabar : SJ.C.ink;
        g.save();
        g.globalAlpha = disabled ? 0.22 : (muted ? 0.40 : (armed ? 1 : (sel ? 0.96 : 0.55)));
        SJ.Ink.vtext(g, TITLE_ITEMS[i], x, 372, 34, { color: col, alpha: 1 });
        g.restore();
        if (armed) {
          // 二次确认的心跳：比普通选中标记更急促、更满，提醒「再按一次就真的执行」
          var hb = 0.5 + 0.5 * Math.sin(SJ.Game.time * 9);
          SJ.Ink.blob(g, x, 372 - 14, 3.4 + hb * 1.4, 95, { color: SJ.C.cinnabar, alpha: 0.55 + hb * 0.4, rough: 0.34 });
        } else if (sel && !disabled) {
          var mk = 0.5 + 0.5 * Math.sin(SJ.Game.time * 3);
          SJ.Ink.blob(g, x, 372 + 34 * 1.14 + 14, 2.6, 60 + i, { color: SJ.C.cinnabar, alpha: 0.5 + mk * 0.4, rough: 0.3 });
        }
        if (muted) {
          SJ.Ink.stroke(g, [[x - 13, 372 - 8], [x + 11, 372 + 42]], {
            w0: 1.6, w1: 1.0, color: SJ.C.ink, alpha: 0.55, seed: 90, hairs: 0
          });
        }
      }
      // 音量条只在「音」被选中时露出来：标题只有三个字，平时不添第四样东西
      if (titleSel === 2) drawVolBar(g, W / 2, 448, 214, SJ.C.ink);
    },
    exit: function () { volEdit = false; }
  };

  // ══ 暂停：继续／换招／音／出——同样不解释按键，只给出四个词 ══════════
  var pauseSel = 0;
  var PAUSE_ITEMS = ['继续', '换招', '音', '出'];

  var pauseScene = {
    countsPlaytime: false,
    enter: function () { pauseSel = 0; volEdit = false; },
    update: function (dt) {
      if (volUpdate(dt)) return;          // 同上：音量条开着时 ← → 归它
      if (SJ.Input.pressed('left')) pauseSel = (pauseSel + 3) % 4;
      if (SJ.Input.pressed('right')) pauseSel = (pauseSel + 1) % 4;
      if (SJ.Input.pressed('pause')) { SJ.Audio.sfx('uiBack'); SJ.Game.pop(); return; }
      if (SJ.Input.pressed('confirm')) {
        SJ.Audio.sfx('uiConfirm');
        if (pauseSel === 0) SJ.Game.pop();
        else if (pauseSel === 1) SJ.Menu.slots();
        else if (pauseSel === 2) volEnter();
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
      if (pauseSel === 2) drawVolBar(g, W / 2, H / 2 + 46, 214, SJ.C.paper);
    },
    exit: function () { volEdit = false; }
  };

  // ══ 换招：四槽 × 已学招式，DESIGN §3.2「换招是玩法的一部分」════════
  var slotsCur = 0;

  var slotsScene = {
    countsPlaytime: false,
    enter: function () { slotsCur = 0; },
    update: function () {
      var known = SJ.player.known || [];
      var slots = SJ.player.slots || [];
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
        SJ.Player.setSlot(slotsCur, cand);   // 唯一写入者（决议 007 §1）
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
      var known = SJ.player.known || [];
      var slots = SJ.player.slots || [];
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
        SJ.Level.restartFromCheckpoint();   // 决议 007 §2：G 实现，H 不用管检查点怎么编码
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
    countsPlaytime: false,
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
