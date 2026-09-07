// 【A】引导。SJ.Menu 就绪后由它接管；否则退到一个能跑的占位场景（手感调校在 dev/sandbox.html）。
(function (SJ) {
  'use strict';

  function bootScene() {
    var SOLIDS = [
      [0, 480, 1600, 160, 0],
      [260, 384, 180, 18, 1],
      [540, 300, 180, 18, 1],
      [860, 396, 220, 24, 0],
      [1200, 312, 170, 18, 1]
    ];
    var p = { x: 90, y: 400, w: 24, h: 44, vx: 0, vy: 0, facing: 1,
              onGround: false, coyote: 0, jumps: 0 };

    return {
      enter: function () {
        SJ.World.load({ solids: SOLIDS });
        SJ.Camera.setBounds(0, 1600, 0, 640);
        SJ.Camera.snap(p.x + p.w / 2, p.y);
      },

      update: function (dt) {
        var I = SJ.Input, ax = I.axis();
        if (ax) p.facing = ax;

        var target = ax * 240;
        var rate = (ax === 0) ? 3200 : 3000;
        p.vx += SJ.clamp(target - p.vx, -rate * dt, rate * dt);
        p.vy = Math.min(p.vy + SJ.GRAVITY * dt, SJ.MAXFALL);

        if (p.onGround) { p.coyote = 0.10; p.jumps = 0; }
        else p.coyote = Math.max(0, p.coyote - dt);

        var wantJump = I.buffered('jump', 120);
        if (wantJump && I.down('down') && p.onGround) {
          p.dropThrough = true;
          I.consume('jump');
        } else if (wantJump) {
          if (p.onGround || p.coyote > 0) {
            p.vy = -720; p.jumps = 1; p.coyote = 0; I.consume('jump');
          } else if (p.jumps === 1) {
            p.vy = -640; p.jumps = 2; I.consume('jump');
          }
        }
        if (I.released('jump') && p.vy < -420) p.vy = -420;

        SJ.World.moveX(p, p.vx * dt);
        SJ.World.moveY(p, p.vy * dt);

        if (I.pressed('attack')) {
          SJ.Game.slowmo(0, 0.045);
          SJ.Game.shake(7, 0.24);
          SJ.Game.flash('#ffffff', 0.10, 0.45);
        }

        SJ.Camera.follow(p, dt);
      },

      draw: function (g) {
        g.fillStyle = SJ.C.paper;
        g.fillRect(0, 0, SJ.W, SJ.H);

        SJ.Camera.apply(g);
        var ss = SJ.World.solids;
        for (var i = 0; i < ss.length; i++) {
          var s = ss[i];
          g.fillStyle = s.oneway ? SJ.C.inkLight : SJ.C.ink2;
          g.fillRect(s.x, s.y, s.w, s.h);
        }
        g.fillStyle = SJ.C.ink;
        g.fillRect(p.x, p.y, p.w, p.h);
        g.fillStyle = SJ.C.cinnabar;
        g.fillRect(p.x + (p.facing > 0 ? p.w - 5 : 0), p.y + 7, 5, 5);
        SJ.Camera.restore(g);

        g.fillStyle = SJ.C.inkLight;
        g.font = '16px ' + SJ.FONT;
        g.textAlign = 'center';
        g.fillText('说剑 · 引导占位（SJ.Menu 尚未就绪）', SJ.W / 2, 40);
        g.textAlign = 'left';
      }
    };
  }

  function boot() {
    var canvas = document.getElementById('sj');
    if (!canvas) {
      canvas = document.createElement('canvas');
      document.body.appendChild(canvas);
    }
    SJ.Game.init(canvas);
    if (SJ.Menu && SJ.Menu.title) SJ.Menu.title();
    else SJ.Game.setScene(bootScene());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window.SJ = window.SJ || {});
