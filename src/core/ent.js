// 【A】实体表。update 过程中增删实体是安全的（先快照，末尾原地压缩）。
(function (SJ) {
  'use strict';

  var list = [];

  SJ.Ent = {

    list: list,

    add: function (e) {
      if (e.z === undefined) e.z = 0;
      if (e.dead === undefined) e.dead = false;
      list.push(e);
      return e;
    },

    remove: function (e) {
      e.dead = true;
      var i = list.indexOf(e);
      if (i >= 0) list.splice(i, 1);
    },

    each: function (fn) {
      var snap = list.slice();
      for (var i = 0; i < snap.length; i++) {
        if (!snap[i].dead) fn(snap[i], i);
      }
    },

    by: function (tag) {
      var out = [];
      for (var i = 0; i < list.length; i++) {
        if (!list[i].dead && list[i].tag === tag) out.push(list[i]);
      }
      return out;
    },

    clear: function () {
      for (var i = 0; i < list.length; i++) list[i].dead = true;
      list.length = 0;
    },

    updateAll: function (dt) {
      var snap = list.slice();
      for (var i = 0; i < snap.length; i++) {
        var e = snap[i];
        if (e.dead || !e.update) continue;
        e.update(dt);
      }
      var w = 0;
      for (var j = 0; j < list.length; j++) {
        if (!list[j].dead) list[w++] = list[j];
      }
      list.length = w;
    },

    // 按 z 升序稳定排序（同 z 保持加入顺序）。排的是副本，不动 update 顺序。
    drawAll: function (g) {
      var arr = [];
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e.dead || !e.draw) continue;
        e._zi = i;
        arr.push(e);
      }
      arr.sort(function (a, b) {
        return ((a.z || 0) - (b.z || 0)) || (a._zi - b._zi);
      });
      for (var j = 0; j < arr.length; j++) arr[j].draw(g);
    }
  };

})(window.SJ = window.SJ || {});
