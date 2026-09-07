// 【A】主循环、场景栈、时间控制（slowmo / shake / flash / fade）。
(function (SJ) {
  'use strict';

  var STEP = 1 / 60;
  var MAXSTEPS = 5;

  var stack = [];
  var acc = 0;
  var lastTs = 0;
  var running = false;

  var slows = [];                 // {s, t} 叠加取最小
  var shakeMag = 0, shakeT = 0, shakeDur = 1;
  var flashColor = '#fff', flashT = 0, flashDur = 1, flashA = 0;
  var fadeActive = false, fadeAlpha = 0, fadeFrom = 0, fadeTo = 0;
  var fadeT = 0, fadeDur = 1, fadeColor = '#000', fadeCb = null;

  function resize() {
    var G = SJ.Game, c = G.canvas;
    if (!c) return;
    var dpr = window.devicePixelRatio || 1;
    var s = Math.min(window.innerWidth / SJ.W, window.innerHeight / SJ.H);
    if (!(s > 0)) s = 1;
    var cssW = Math.max(1, Math.floor(SJ.W * s));
    var cssH = Math.max(1, Math.floor(SJ.H * s));
    c.style.width = cssW + 'px';
    c.style.height = cssH + 'px';
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    G.scale = c.width / SJ.W;
    G.g.imageSmoothingEnabled = true;
  }

  function slowScale() {
    var s = 1;
    for (var i = 0; i < slows.length; i++) if (slows[i].s < s) s = slows[i].s;
    return s;
  }

  function step() {
    var G = SJ.Game;

    // 时间控制自身用不缩放的步长推进，hitstop 才不会把自己冻住
    for (var i = slows.length - 1; i >= 0; i--) {
      slows[i].t -= STEP;
      if (slows[i].t <= 0) slows.splice(i, 1);
    }

    if (shakeT > 0) {
      shakeT -= STEP;
      if (shakeT <= 0) {
        shakeT = 0; shakeMag = 0;
        SJ.Camera.shakeOffset.x = 0;
        SJ.Camera.shakeOffset.y = 0;
      } else {
        var k = shakeT / shakeDur, amp = shakeMag * k * k;
        SJ.Camera.shakeOffset.x = (Math.random() * 2 - 1) * amp;
        SJ.Camera.shakeOffset.y = (Math.random() * 2 - 1) * amp;
      }
    }

    if (flashT > 0) flashT -= STEP;

    if (fadeActive) {
      fadeT += STEP;
      var p = fadeT / fadeDur;
      if (p >= 1) {
        p = 1; fadeActive = false;
      }
      fadeAlpha = fadeFrom + (fadeTo - fadeFrom) * SJ.ease.io(p);
      if (!fadeActive && fadeCb) { var cb = fadeCb; fadeCb = null; cb(); }
    }

    var dt = STEP * slowScale();
    G.rawDt = STEP;
    G.time += dt;
    G.frame++;

    // 决议 006：playtimeSec 的唯一写入者。必须用 rawDt——用被 slowmo/hitstop
    // 缩放过的 dt 会把「玩了 30 分钟」记成 20 分钟，而这个数字正是用来验收
    // DESIGN §9.6「单周目 30 分钟以上」的。标题/暂停等场景由 H 设 countsPlaytime=false。
    if (G.scene && G.scene.countsPlaytime !== false) {
      SJ.Save.data.playtimeSec += STEP;
    }

    var top = stack[stack.length - 1];
    if (top && top.update) top.update(dt);

    SJ.Input.update();
  }

  function render() {
    var G = SJ.Game, g = G.g;
    if (!g) return;

    g.setTransform(G.scale, 0, 0, G.scale, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, SJ.W, SJ.H);

    for (var i = 0; i < stack.length; i++) {
      var s = stack[i];
      if (!s.draw) continue;
      g.save();
      s.draw(g);
      g.restore();
    }

    // 覆盖层一律回到基准变换，场景忘了 Camera.restore 也不会歪
    g.setTransform(G.scale, 0, 0, G.scale, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    if (SJ.FX && SJ.FX.drawScreen) SJ.FX.drawScreen(g);

    g.setTransform(G.scale, 0, 0, G.scale, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    if (flashT > 0) {
      var fp = 1 - flashT / flashDur;
      g.globalAlpha = flashA * Math.pow(1 - fp, 1.6);
      g.fillStyle = flashColor;
      g.fillRect(0, 0, SJ.W, SJ.H);
      g.globalAlpha = 1;
    }

    if (fadeAlpha > 0.001) {
      g.globalAlpha = SJ.clamp(fadeAlpha, 0, 1);
      g.fillStyle = fadeColor;
      g.fillRect(0, 0, SJ.W, SJ.H);
      g.globalAlpha = 1;
    }
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!lastTs) lastTs = ts;
    var raw = (ts - lastTs) / 1000;
    lastTs = ts;
    if (!(raw > 0)) raw = 0;
    if (raw > 0.25) raw = 0.25;     // 切标签页回来不要一次补几百帧

    acc += raw;
    var n = 0;
    while (acc >= STEP && n < MAXSTEPS) { acc -= STEP; n++; step(); }
    if (acc >= STEP) acc = 0;       // 追不上就丢掉积压，不做死亡螺旋

    render();
  }

  SJ.Game = {
    canvas: null,
    g: null,
    scale: 1,
    scene: null,
    time: 0,
    frame: 0,
    rawDt: STEP,

    init: function (canvas) {
      this.canvas = canvas;
      this.g = canvas.getContext('2d');
      resize();
      window.addEventListener('resize', resize);
      SJ.Input.init(canvas);
      if (!running) { running = true; requestAnimationFrame(loop); }
    },

    setScene: function (scene, data) {
      for (var i = stack.length - 1; i >= 0; i--) {
        if (stack[i].exit) stack[i].exit();
      }
      stack.length = 0;
      this.push(scene, data);
    },

    push: function (scene, data) {
      stack.push(scene);
      this.scene = scene;
      if (scene.enter) scene.enter(data);
    },

    pop: function () {
      var s = stack.pop();
      if (s && s.exit) s.exit();
      this.scene = stack[stack.length - 1] || null;
      return s;
    },

    stack: stack,

    // 叠加取最小值。hitstop: slowmo(0, 0.045)
    slowmo: function (scale, sec) {
      slows.push({ s: scale, t: sec });
    },

    timeScale: function () { return slowScale(); },

    shake: function (mag, sec) {
      var remain = shakeT > 0 ? shakeMag * (shakeT / shakeDur) : 0;
      if (mag >= remain) { shakeMag = mag; shakeDur = Math.max(sec, 1 / 60); shakeT = shakeDur; }
    },

    flash: function (color, sec, alpha) {
      flashColor = color || '#fff';
      flashDur = Math.max(sec || 0.12, 1 / 60);
      flashT = flashDur;
      flashA = alpha === undefined ? 0.85 : alpha;
    },

    // 'out' = 罩上黑幕；'in' = 从当前幕色淡出到透明；
    // 其他字符串当颜色用（'paper' 映射到纸色），罩上该色。
    fade: function (kind, sec, cb) {
      if (kind === 'in') {
        fadeTo = 0;
      } else {
        fadeTo = 1;
        fadeColor = (kind === 'out' || !kind) ? '#000'
                  : (kind === 'paper' ? SJ.C.paper : kind);
      }
      fadeFrom = fadeAlpha;
      fadeT = 0;
      fadeDur = Math.max(sec || 0, 1 / 60);
      fadeCb = cb || null;
      fadeActive = true;
    },

    // 测试/工具用：直接推进一个固定步
    _step: step,
    _render: render
  };

})(window.SJ = window.SJ || {});
