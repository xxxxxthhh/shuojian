// 【A】键盘 + 鼠标。edge 状态每帧只 true 一次，由 SJ.Game 在每个固定步末尾调 update() 翻转。
(function (SJ) {
  'use strict';

  var ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'guard',
                 'dash', 't1', 't2', 't3', 't4', 'pause', 'confirm', 'interact'];

  // 一个物理键可以映射到多个 action（W/↑ 同时是 up / jump / interact，是有意的）
  var MAP = {
    KeyA: ['left'], ArrowLeft: ['left'],
    KeyD: ['right'], ArrowRight: ['right'],
    KeyW: ['up', 'jump', 'interact'], ArrowUp: ['up', 'jump', 'interact'],
    KeyS: ['down'], ArrowDown: ['down'],
    Space: ['jump', 'confirm'],
    KeyJ: ['attack', 'confirm'],
    KeyK: ['guard'],
    KeyL: ['dash'], ShiftLeft: ['dash'], ShiftRight: ['dash'],
    KeyU: ['t1'], KeyI: ['t2'], KeyO: ['t3'], KeyP: ['t4'],
    KeyF: ['interact'],
    Escape: ['pause']
  };

  var MOUSE = { 0: ['attack'], 2: ['guard'] };

  var held = {};        // action -> 按住它的来源数量（多键映射同一 action 时不会互相顶掉）
  var pressEdge = {};
  var releaseEdge = {};
  var lastPress = {};
  var srcDown = {};     // 物理来源 key -> true，用于过滤 key repeat

  for (var i = 0; i < ACTIONS.length; i++) {
    held[ACTIONS[i]] = 0;
    pressEdge[ACTIONS[i]] = false;
    releaseEdge[ACTIONS[i]] = false;
    lastPress[ACTIONS[i]] = -1e9;
  }

  function now() { return Date.now(); }

  function srcPress(src, acts) {
    if (srcDown[src]) return;
    srcDown[src] = true;
    for (var i = 0; i < acts.length; i++) {
      var a = acts[i];
      if (held[a] === 0) {
        pressEdge[a] = true;
        lastPress[a] = now();
      }
      held[a]++;
    }
  }

  function srcRelease(src, acts) {
    if (!srcDown[src]) return;
    srcDown[src] = false;
    for (var i = 0; i < acts.length; i++) {
      var a = acts[i];
      held[a]--;
      if (held[a] <= 0) { held[a] = 0; releaseEdge[a] = true; }
    }
  }

  function clearAll() {
    for (var k in srcDown) srcDown[k] = false;
    for (var i = 0; i < ACTIONS.length; i++) {
      var a = ACTIONS[i];
      if (held[a] > 0) releaseEdge[a] = true;
      held[a] = 0;
    }
  }

  SJ.Input = {

    init: function (canvas) {
      if (this._inited) return;
      this._inited = true;

      window.addEventListener('keydown', function (e) {
        var acts = MAP[e.code];
        if (!acts) return;
        if (e.metaKey || e.ctrlKey) return;   // 不吞 devtools / 刷新等系统快捷键
        e.preventDefault();
        if (e.repeat) return;
        srcPress('k:' + e.code, acts);
      });

      window.addEventListener('keyup', function (e) {
        var acts = MAP[e.code];
        if (!acts) return;
        srcRelease('k:' + e.code, acts);
      });

      if (canvas) {
        canvas.addEventListener('mousedown', function (e) {
          var acts = MOUSE[e.button];
          if (!acts) return;
          e.preventDefault();
          srcPress('m:' + e.button, acts);
        });
        canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      }

      // 抬起挂在 window 上：鼠标移出 canvas 再松开也能收到
      window.addEventListener('mouseup', function (e) {
        var acts = MOUSE[e.button];
        if (!acts) return;
        srcRelease('m:' + e.button, acts);
      });

      window.addEventListener('blur', clearAll);
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) clearAll();
      });
    },

    // SJ.Game 在每个固定步的末尾调用。重复调用是安全的（只是提前清掉 edge）。
    update: function () {
      for (var i = 0; i < ACTIONS.length; i++) {
        pressEdge[ACTIONS[i]] = false;
        releaseEdge[ACTIONS[i]] = false;
      }
    },

    down: function (a) { return held[a] > 0; },
    pressed: function (a) { return !!pressEdge[a]; },
    released: function (a) { return !!releaseEdge[a]; },

    buffered: function (a, ms) {
      if (ms === undefined) ms = 120;
      return now() - lastPress[a] <= ms;
    },

    consume: function (a) {
      lastPress[a] = -1e9;
      pressEdge[a] = false;
    },

    axis: function () {
      return (held.right > 0 ? 1 : 0) - (held.left > 0 ? 1 : 0);
    },

    any: function () {
      for (var i = 0; i < ACTIONS.length; i++) {
        if (held[ACTIONS[i]] > 0) return true;
      }
      return false;
    },

    actions: ACTIONS
  };

})(window.SJ = window.SJ || {});
