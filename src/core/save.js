// 【A】存档。localStorage 不可用（file:// / 隐私模式 / Safari 限制）时静默降级到内存。
(function (SJ) {
  'use strict';

  var KEY = 'shuojian';
  var mem = null;          // 内存降级用的存档字符串
  var probed = false, store = null;

  function ls() {
    if (probed) return store;
    probed = true;
    try {
      var s = window.localStorage;
      s.setItem('__sj_probe', '1');
      s.removeItem('__sj_probe');
      store = s;
    } catch (e) {
      store = null;
    }
    return store;
  }

  function readRaw() {
    var s = ls();
    if (!s) return mem;
    try { return s.getItem(KEY); } catch (e) { return mem; }
  }

  function writeRaw(str) {
    mem = str;
    var s = ls();
    if (!s) return;
    try { s.setItem(KEY, str); } catch (e) { /* 配额/隐私模式：内存里已经存了 */ }
  }

  function defaults() {
    return {
      chapter: 0,
      hp: 60,
      maxHp: 60,
      known: [],
      slots: [null, null, null, null],
      mercy: {},
      flags: {},
      deaths: 0,
      playtimeSec: 0,
      // 决议 016：残墨进度 moveId → 0–100。旧档没有这一项，load() 会补 {}。
      techProgress: {}
    };
  }

  SJ.Save = {

    data: defaults(),

    exists: function () {
      return readRaw() != null;
    },

    load: function () {
      var d = defaults();
      var raw = readRaw();
      if (raw) {
        try {
          var o = JSON.parse(raw);
          if (o && typeof o === 'object') {
            for (var k in d) if (o[k] !== undefined && o[k] !== null) d[k] = o[k];
          }
        } catch (e) { /* 存档损坏 → 用默认值 */ }
      }
      this.data = d;
      // 决议 016：进度的真源仍在 Tech，这里只是「载入时读回」的那一下。
      // load() 会**换掉整个 data 对象**，所以 Tech 不许缓存 data.techProgress 的引用，
      // 只能每次现取 —— 与 player.js 把 known/slots 做成取值器是同一个坑。
      // 守卫是必需的：smoke / level-check / script-check 里 save.js 会在没有 tech.js 的
      // 情况下被加载。
      if (SJ.Tech && SJ.Tech.adoptProgress) SJ.Tech.adoptProgress(d.techProgress);
      return d;
    },

    save: function () {
      try {
        writeRaw(JSON.stringify(this.data));
      } catch (e) { /* 循环引用等：不让存档拖垮游戏 */ }
      return this.data;
    },

    reset: function () {
      this.data = defaults();
      if (SJ.Tech && SJ.Tech.adoptProgress) SJ.Tech.adoptProgress(this.data.techProgress);
      mem = null;
      var s = ls();
      if (s) { try { s.removeItem(KEY); } catch (e) {} }
      return this.data;
    }
  };

})(window.SJ = window.SJ || {});
