// 【A】死区跟随 + lookahead + 边界夹紧。x,y 是视口左上角的世界坐标。
(function (SJ) {
  'use strict';

  var DZW = 120, DZH = 80, SMOOTH = 8, LOOK = 60, LOOKSPD = 5;

  function clampToBounds(C) {
    var wx = C.bx1 - C.bx0;
    if (wx <= SJ.W) C.x = C.bx0 + (wx - SJ.W) / 2;
    else C.x = SJ.clamp(C.x, C.bx0, C.bx1 - SJ.W);

    var wy = C.by1 - C.by0;
    if (wy <= SJ.H) C.y = C.by0 + (wy - SJ.H) / 2;
    else C.y = SJ.clamp(C.y, C.by0, C.by1 - SJ.H);
  }

  SJ.Camera = {
    x: 0,
    y: 0,
    look: 0,
    shakeOffset: { x: 0, y: 0 },
    bx0: -1e9, bx1: 1e9, by0: -1e9, by1: 1e9,

    setBounds: function (x0, x1, y0, y1) {
      this.bx0 = x0; this.bx1 = x1; this.by0 = y0; this.by1 = y1;
      clampToBounds(this);
    },

    // 以世界点 (x,y) 为画面中心，立即到位（不缓动）
    snap: function (x, y) {
      this.x = x - SJ.W / 2;
      this.y = y - SJ.H / 2;
      clampToBounds(this);
    },

    follow: function (target, dt, opts) {
      if (!target) return;
      opts = opts || {};
      var dzw = opts.dzw === undefined ? DZW : opts.dzw;
      var dzh = opts.dzh === undefined ? DZH : opts.dzh;
      var sm = opts.smooth === undefined ? SMOOTH : opts.smooth;
      var la = opts.look === undefined ? LOOK : opts.look;

      var face = target.facing || 0;
      this.look += (face * la - this.look) * (1 - Math.exp(-LOOKSPD * dt));

      var tx = (target.cx ? target.cx() : target.x + target.w / 2) + this.look;
      var ty = (target.cy ? target.cy() : target.y + target.h / 2) + (opts.offsetY || 0);

      var cx = this.x + SJ.W / 2, cy = this.y + SJ.H / 2;
      if (tx > cx + dzw / 2) cx = tx - dzw / 2;
      else if (tx < cx - dzw / 2) cx = tx + dzw / 2;
      if (ty > cy + dzh / 2) cy = ty - dzh / 2;
      else if (ty < cy - dzh / 2) cy = ty + dzh / 2;

      var k = 1 - Math.exp(-sm * dt);   // dt=0（hitstop）时 k=0，画面纹丝不动
      this.x += (cx - SJ.W / 2 - this.x) * k;
      this.y += (cy - SJ.H / 2 - this.y) * k;

      clampToBounds(this);
    },

    apply: function (g) {
      g.save();
      g.translate(-Math.round(this.x + this.shakeOffset.x),
                  -Math.round(this.y + this.shakeOffset.y));
    },

    restore: function (g) {
      g.restore();
    }
  };

})(window.SJ = window.SJ || {});
