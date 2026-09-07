/* dev/script-check.js  【D】—— src/data/script.js 的一次性自检
 * 用法： node dev/script-check.js
 * 检查：语法/结构、next 可达、行长、行数、mode 枚举、玩法术语泄漏、
 *       字数总量、无名台词数、以及**全存档排列下的链式遍历模拟**。
 */
'use strict';
var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '..');

global.window = {};
new Function(fs.readFileSync(path.join(ROOT, 'src/data/script.js'), 'utf8'))();
var S = global.window.SJ.Script;

var errs = [], warns = [];
// 重复 key：node --check 与 Object.keys 都抓不到（strict 下静默保留最后一个定义）
(function () {
  var raw = fs.readFileSync(path.join(ROOT, 'src/data/script.js'), 'utf8');
  var seen = {}, m, re = /^  ([a-zA-Z0-9_]+): \{/gm;
  while ((m = re.exec(raw))) {
    if (seen[m[1]]) errs.push('重复 key: ' + m[1]);
    seen[m[1]] = 1;
  }
})();
function E(m) { errs.push(m); }
function W(m) { warns.push(m); }

var MODES = { tea:1, talk:1, card:1, narration:1 };
var MAXLEN = 18;
// 玩法术语黑名单：本文件不得出现任何玩法说明
var BANNED = ['按键','长按','点击','鼠标','招式槽','菜单','暂停','血量','墨值','生命值',
              '教程','冷却','按下','空格','键盘','进度条','解锁','技能','伤害值'];

var keys = Object.keys(S);

/* ── 1. 结构 / 行长 / mode / 术语 ─────────────────────────────── */
var cjk = 0, allch = 0, wumingLines = 0, wumingSpoken = 0, wumingNodes = 0;
keys.forEach(function (k) {
  var n = S[k];
  if (typeof n !== 'object' || !n) return E(k + ': 不是对象');
  if (!MODES[n.mode]) E(k + ': mode 非法 -> ' + n.mode);
  if (typeof n.speaker !== 'string') E(k + ': speaker 必须是 string');
  if (!Array.isArray(n.lines) || !n.lines.length) return E(k + ': lines 缺失');
  if ('cond' in n && typeof n.cond !== 'function') E(k + ': cond 不是函数');
  if (!('next' in n)) E(k + ': 缺 next 字段（结束请显式写 null）');
  if (n.next !== null && !S[n.next]) E(k + ': next 指向不存在的 key -> ' + n.next);

  var min = (n.speaker === '无名' || n.mode === 'card') ? 1 : 2;
  if (n.lines.length < min || n.lines.length > 5)
    E(k + ': 行数 ' + n.lines.length + ' 超出 [' + min + ',5]');

  if (n.speaker === '无名') { wumingNodes++; wumingLines += n.lines.length; }

  n.lines.forEach(function (L, i) {
    if (typeof L !== 'string') return E(k + '[' + i + ']: 不是字符串');
    if (L.length > MAXLEN) E(k + '[' + i + ']: ' + L.length + ' 字 > ' + MAXLEN + ' 「' + L + '」');
    BANNED.forEach(function (b) {
      if (L.indexOf(b) >= 0) E(k + '[' + i + ']: 出现玩法术语「' + b + '」 -> ' + L);
    });
    allch += L.length;
    var m = L.match(/[一-鿿]/g);
    cjk += m ? m.length : 0;
    if (n.speaker === '无名' && L !== '……') wumingSpoken++;
  });
});

/* ── 2. 入口 key 必须无 cond（H 可能只在 advance 时求值） ────────── */
var ENTRIES = [
  'p_intro','p_outro','p_door','p_sit','p_chake','p_kelao','p_kelao_b','p_child',
  'learn_ink','learn_hurt',
  'c1_intro','c1_outro','c1_boss_pre','c1_boss_down',
  'c1_t_ink','c1_t_watch','c1_t_dash','c1_t_rain','wall_c1_a','wall_c1_b',
  'c2_intro','c2_outro','c2_boss_pre','c2_boss_mid','c2_boss_down',
  'c2_t_up','c2_t_lantern','c2_t_multi','wall_c2_a','wall_c2_b',
  'c3_intro','c3_outro','c3_boss_pre','c3_boss_mid','c3_boss_down',
  'c3_t_yan','c3_t_gong','c3_t_raft','c3_t_wind','wall_c3_a','wall_c3_b',
  'c4_intro','c4_outro','c4_boss_pre','c4_boss_mid','c4_boss_down',
  'c4_t_ink','c4_t_tiyun','c4_t_deng','c4_t_lost','c4_t_men','c4_mid','wall_c4_a','wall_c4_b',
  'c5_intro','c5_outro','c5_boss_pre','c5_boss_mid','c5_boss_down',
  'c5_t_fire','c5_t_fenshu','c5_t_seng','c5_t_shelf','c5_t_burn','c5_t_page',
  'wall_c5_a','wall_c5_b','c5_book',
  'c6_intro','c6_outro','c6_boss_pre','c6_boss_p2','c6_boss_p3','c6_boss_down',
  'c6_t_all','c6_t_ghost','c6_t_moon','c6_t_last','c6_t_climb','c6_t_wave1',
  'c6_t_mix','c6_t_wave2','c6_t_flag','c6_t_wave3','c6_t_see','wall_c6_a','wall_c6_b',
  'f_intro','f_reveal','f_end','f_t_rain','f_t_seat','f_t_chake'];
ENTRIES.forEach(function (k) {
  if (!S[k]) return E('入口 key 缺失: ' + k);
  if ('cond' in S[k]) E('入口 key 不得带 cond: ' + k);
});

/* ── 3. 孤儿检查：既非入口又无人指向 ──────────────────────────── */
var reached = {};
keys.forEach(function (k) { if (S[k].next) reached[S[k].next] = 1; });
keys.forEach(function (k) {
  if (ENTRIES.indexOf(k) < 0 && !reached[k]) W('孤儿节点（无人指向且非入口）: ' + k);
});

/* ── 4. 链式遍历模拟：全存档排列 ─────────────────────────────── */
var BOSSES = ['yuzhongdao','dizi','laoweng','baiyi','shouge','shixiong'];
function walk(entry, save) {
  var seen = {}, shown = [], k = entry, guard = 0;
  while (k !== null && k !== undefined) {
    if (!S[k]) { E('walk ' + entry + ': 断链 -> ' + k); return null; }
    if (seen[k]) { E('walk ' + entry + ': 出现环 -> ' + k); return null; }
    seen[k] = 1;
    if (++guard > 200) { E('walk ' + entry + ': 未终止'); return null; }
    var n = S[k];
    if (!n.cond || n.cond(save)) shown.push(k);
    k = n.next;
  }
  return shown;
}
var walks = 0;
for (var mask = 0; mask < 64; mask++) {           // 6 个 boss 的留手/杀 全排列
  for (var kn = 0; kn <= 12; kn++) {              // 学招数 0..12
    var save = { mercy:{}, known:[] };
    for (var b = 0; b < 6; b++) if (mask & (1 << b)) save.mercy[BOSSES[b]] = true;
    for (var j = 0; j < kn; j++) save.known.push('m' + j);
    ENTRIES.forEach(function (e) {
      var shown = walk(e, save);
      walks++;
      if (shown && !shown.length) E('walk ' + e + ' @mask' + mask + '/kn' + kn + ': 一屏都没显示');
    });
    // 结局：必须且只能命中一组
    var sh = walk('f_end', save) || [];
    var g = { all:0, kill:0, mercy:0, mid:0 };
    sh.forEach(function (k2) {
      if (/^f_end_all/.test(k2)) g.all++;
      else if (/^f_end_kill/.test(k2)) g.kill++;
      else if (/^f_end_mercy/.test(k2)) g.mercy++;
      else if (/^f_end_mid/.test(k2)) g.mid++;
    });
    var live = ['all','kill','mercy','mid'].filter(function (x) { return g[x] > 0; });
    if (live.length !== 1)
      E('结局分支 @mask' + mask + '/kn' + kn + ': 命中 ' + live.length + ' 组 -> ' + live.join(','));
    var m = Object.keys(save.mercy).length;
    var want = kn >= 12 ? 'all' : (m === 0 ? 'kill' : (m >= 4 ? 'mercy' : 'mid'));
    if (live[0] !== want)
      E('结局分支 @mercy' + m + '/kn' + kn + ': 应为 ' + want + ' 实为 ' + live[0]);
    // 关卡内变体链也必须恰好命中一个
    [['c4_mid',/^c4_mid_[ab]$/], ['c5_t_page',/^c5_t_page_[ab]$/]].forEach(function (pr) {
      var w2 = (walk(pr[0], save) || []).filter(function (x) { return pr[1].test(x); });
      if (w2.length !== 1) E(pr[0] + ' @mask' + mask + ': 变体命中 ' + w2.length + ' 个');
    });
    // 各回 outro 必须恰好显示一个变体
    [1,2,3,4,5,6].forEach(function (c) {
      var o = walk('c' + c + '_outro', save) || [];
      var v = o.filter(function (x) { return /_outro_[ab]$/.test(x); });
      if (v.length !== 1) E('c' + c + '_outro @mask' + mask + ': 变体命中 ' + v.length + ' 个');
    });
  }
}

/* ── 4b. 叙事语义断言：说书人到底说反了没有 ────────────────────
 * 决议 002 要求 wave 3 集成测试覆盖「留手后第四回旁白确实矛盾」。
 * 这里在数据层先把它钉死：一至三回必须与行为**一致**，
 * 四回起必须与行为**相反**。cond 若被写反 / 变体被对调，这里立刻炸。
 */
var SEM = [
  // [链入口, bossId, 留手时应出现的字样, 杀时应出现的字样, 是否应当矛盾]
  ['c1_outro',   'yuzhongdao', '收了剑',       '剑落下去',   false],
  ['c2_outro',   'dizi',       '放回他手里',   '一剑下去',   false],
  ['c3_outro',   'laoweng',    '推回他手边',   '落进河里',   false],
  ['c4_mid',     'yuzhongdao', '刀客是他杀的', '活下来了',   true ],
  ['c4_outro',   'baiyi',      '一剑挥下',     '没有下手',   true ],
  ['c5_t_page',  'baiyi',      '一剑挥下',     '把剑收了',   true ],
  ['c5_outro',   'shouge',     '死在',         '没有杀他',   true ],
  ['c6_outro',   'shixiong',   '穿过去',       '插回鞘里',   true ]
];
SEM.forEach(function (r) {
  var entry = r[0], boss = r[1], wantSpared = r[2], wantKilled = r[3], inverted = r[4];
  [true, false].forEach(function (isSpared) {
    var save = { mercy:{}, known:[] };
    if (isSpared) save.mercy[boss] = true;
    var shown = walk(entry, save) || [];
    var txt = shown.map(function (k) { return S[k].lines.join(''); }).join('');
    var want = isSpared ? wantSpared : wantKilled;
    var other = isSpared ? wantKilled : wantSpared;
    if (txt.indexOf(want) < 0)
      E('语义 ' + entry + (isSpared ? ' [留手]' : ' [杀]') + ': 找不到应有的「' + want + '」');
    if (txt.indexOf(other) >= 0)
      E('语义 ' + entry + (isSpared ? ' [留手]' : ' [杀]') + ': 混入了另一变体的「' + other + '」');
  });
});
var semErrs = errs.filter(function (e) { return e.indexOf('语义 ') === 0; }).length;

/* ── 4c. 文档同步：_spec/STORY.md 引用的 key 必须真实存在 ──────── */
var mdRefs = 0, mdBad = [];
(function () {
  var md = fs.readFileSync(path.join(ROOT, '_spec/STORY.md'), 'utf8');
  var seen = {}, m, re = /`((?:p_|c[1-6]_|f_|wall_|learn_)[a-z0-9_]+)`/g;
  while ((m = re.exec(md))) { seen[m[1]] = 1; }
  Object.keys(seen).forEach(function (k) {
    mdRefs++;
    if (!S[k]) { mdBad.push(k); E('STORY.md 引用了不存在的 key: ' + k); }
  });
})();

/* ── 5. 总量 ─────────────────────────────────────────────────── */
// 字数按中文习惯计（含标点）；目标区间 3500–6000
if (allch < 3500) E('总字数 ' + allch + ' < 3500');
if (allch > 6000) E('总字数 ' + allch + ' > 6000');
if (wumingSpoken > 20) E('无名台词 ' + wumingSpoken + ' 句 > 20');

console.log('key 数        : ' + keys.length);
console.log('总字数(含标点): ' + allch + '  （纯汉字 ' + cjk + '）');
console.log('无名节点/行   : ' + wumingNodes + ' 节点, ' + wumingLines + ' 行 (含「……」)');
console.log('无名实际台词  : ' + wumingSpoken + ' 句 (不含纯「……」)');
console.log('链式遍历      : ' + walks + ' 次');
console.log('叙事语义      : 一至三回一致 3 条 / 四回起矛盾 5 条 —— ' +
            (semErrs ? '✗ ' + semErrs + ' 条断言失败' : '全部通过'));
console.log('入口 key      : ' + ENTRIES.length);
console.log('STORY.md 同步 : 引用 ' + mdRefs + ' 个 key，' +
            (mdBad.length ? '✗ ' + mdBad.length + ' 个不存在' : '全部存在'));
warns.forEach(function (w) { console.log('WARN  ' + w); });
errs.forEach(function (e) { console.log('ERROR ' + e); });
console.log(errs.length ? '\n✗ ' + errs.length + ' 个错误' : '\n✓ 全部通过');
process.exit(errs.length ? 1 : 0);
