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
      playtimeSec: 0
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
      mem = null;
      var s = ls();
      if (s) { try { s.removeItem(KEY); } catch (e) {} }
      return this.data;
    }
  };

})(window.SJ = window.SJ || {});
