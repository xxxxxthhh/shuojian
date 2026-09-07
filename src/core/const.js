// 【A】常量与纯函数。无状态，无依赖。
(function (SJ) {
  'use strict';

  SJ.W = 960;
  SJ.H = 540;
  SJ.GRAVITY = 2400;
  SJ.MAXFALL = 1100;

  SJ.C = {
    paper: '#efe7d8',
    paperDark: '#e2d7c1',
    ink: '#1b1a17',
    ink2: '#35322c',
    inkLight: '#6f6a60',
    feibai: 'rgba(27,26,23,0.12)',
    cinnabar: '#b03a2b',
    stone: '#4a6f7c',
    gamboge: '#c8a55b'
  };

  SJ.FONT = '"Songti SC","STSong","Kaiti SC",serif';

  SJ.rand = function (a, b) {
    if (b === undefined) { b = a; a = 0; }
    return a + Math.random() * (b - a);
  };

  // 闭区间 [a,b]
  SJ.randi = function (a, b) {
    if (b === undefined) { b = a; a = 0; }
    return a + Math.floor(Math.random() * (b - a + 1));
  };

  SJ.clamp = function (v, a, b) {
    return v < a ? a : (v > b ? b : v);
  };

  SJ.lerp = function (a, b, t) {
    return a + (b - a) * t;
  };

  SJ.ease = {
    out: function (t) { var u = 1 - t; return 1 - u * u * u; },
    'in': function (t) { return t * t * t; },
    io: function (t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },
    back: function (t) {
      var c1 = 1.70158, c3 = c1 + 1, u = t - 1;
      return 1 + c3 * u * u * u + c1 * u * u;
    },
    elastic: function (t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      var c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }
  };

  // 确定性 0..1。位运算实现，跨引擎逐位一致。
  SJ.hash = function (i) {
    var x = Math.imul((((i * 2654435761) | 0) ^ 0x9e3779b9) | 0, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  };

  // 1D value noise，确定性，-1..1
  SJ.noise = function (x) {
    var i = Math.floor(x), f = x - i;
    var u = f * f * (3 - 2 * f);
    var a = SJ.hash(i), b = SJ.hash(i + 1);
    return (a + (b - a) * u) * 2 - 1;
  };

  // {x,y,w,h} 相交
  SJ.aabb = function (a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  };

})(window.SJ = window.SJ || {});
