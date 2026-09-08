/* dev/harness.js  【T1】无头跑帧的共享启动器
 *
 * 为什么要单独一份：walk.js 里那套 SJ.Input 替身把 down/pressed/buffered 全接成
 * 「held || edge」，于是 buffered('jump') 恒真 —— 玩家一落地就再跳一次，
 * 实测第一回跳了 967 次。那不是「机器人笨」，是**输入模型本身是假的**。
 * 这里改成如实复刻 src/core/input.js 的语义（按下沿/抬起沿/缓冲/consume），
 * 只把它的时钟换成虚拟帧钟 —— 否则无头跑得比实时快几百倍，
 * buffered 的 120ms 窗口会覆盖上百帧。
 *
 * 用法：
 *   const H = require('./harness.js').boot({ seed: 1 });
 *   H.load(1);                       // 载入第 1 关
 *   H.hold({ right: 1, jump: 1 });   // 这一帧按住的键（没列出的就是松开）
 *   H.step();                        // 走一帧（真的 update + render）
 */
'use strict';
const fs = require('fs'), path = require('path');

// ── 复用 smoke.js 的沙盒头（canvas / DOM / localStorage 替身 + 按 index.html 顺序加载）──
function loadSandbox() {
  const head = fs.readFileSync(path.join(__dirname, 'smoke.js'), 'utf8')
    .split('/* ══ 第二阶段')[0]
    .replace(/process\.exit\([^)]*\);?/g, '')
    .replace(/console\.log\(errors[\s\S]*$/, '');
  const box = {};
  const log = console.log;
  console.log = function () {};              // 吞掉 smoke 头部的自检打印
  try {
    // eval 在本模块作用域里跑，smoke.js 头部用的 __dirname 正好指向 dev/
    eval(head + '\nbox.SJ = SJ; box.mainCanvas = mainCanvas; box.sandbox = sandbox;');
  } finally { console.log = log; }
  return box;
}

// ── 确定性随机（敌人 AI 全靠 SJ.rand → Math.random，不定种子跑两遍结果不同）──
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── 如实复刻的 SJ.Input（唯一改动：时钟走帧，不走墙钟）────────────── */
function fakeInput(SJ, state) {
  const ACTIONS = SJ.Input.actions.slice();
  const held = {}, pressEdge = {}, releaseEdge = {}, lastPress = {};
  ACTIONS.forEach(a => { held[a] = false; pressEdge[a] = false; releaseEdge[a] = false; lastPress[a] = -1e9; });

  SJ.Input = {
    actions: ACTIONS,
    init: function () {},
    update: function () { ACTIONS.forEach(a => { pressEdge[a] = false; releaseEdge[a] = false; }); },
    down: a => !!held[a],
    pressed: a => !!pressEdge[a],
    released: a => !!releaseEdge[a],
    buffered: function (a, ms) {
      if (ms === undefined) ms = 120;
      return state.ms() - lastPress[a] <= ms;
    },
    consume: function (a) { lastPress[a] = -1e9; pressEdge[a] = false; },
    axis: () => (held.right ? 1 : 0) - (held.left ? 1 : 0),
    any: () => ACTIONS.some(a => held[a]),

    // 机器人接口：给出这一帧「按住的键集合」，由这里算按下沿/抬起沿
    _set: function (want) {
      for (const a of ACTIONS) {
        const w = !!(want && want[a]);
        if (w && !held[a]) { pressEdge[a] = true; lastPress[a] = state.ms(); }
        else if (!w && held[a]) { releaseEdge[a] = true; }
        held[a] = w;
      }
    },
    _held: held
  };
}

function boot(opt) {
  opt = opt || {};
  const box = loadSandbox();
  const SJ = box.SJ, g = box.mainCanvas.getContext('2d');
  // smoke 头部把加载异常收进 errors 数组里静静吞掉。少一个命名空间的表现是
  // 「跑到某一帧才 TypeError」，离真正的原因隔着几千帧 —— 这里当场炸掉。
  for (const k of ['Ink', 'Figure', 'FX', 'Combat', 'Tech', 'Player', 'Enemies',
                   'Bosses', 'Story', 'HUD', 'Menu', 'Level', 'Levels', 'Script']) {
    if (!SJ[k]) throw new Error('[harness] 沙盒里缺 SJ.' + k + '，脚本没加载全');
  }

  if (opt.seed !== undefined) Math.random = mulberry32(opt.seed);

  const state = { frame: 0, ms: () => state.frame * (1000 / 60) };
  fakeInput(SJ, state);
  try { SJ.Audio.init(); } catch (e) {}
  SJ.Game.init(box.mainCanvas);

  const H = {
    SJ, g, sandbox: box.sandbox,
    get frame() { return state.frame; },
    levelScene: null,
    render: opt.render !== false,

    reset: function () {                       // 全新存档（cond 分支才是可预期的）
      SJ.Save.reset();
    },

    load: function (idx, checkpoint) {
      SJ.Level.load(idx, checkpoint);
      H.levelScene = SJ.Game.stack[0] || null;  // 认出关卡场景本体，用来判定结局
      return SJ.Level.def;
    },

    hold: function (want) { SJ.Input._set(want || {}); },

    step: function () {
      SJ.Game._step(1 / 60);
      if (H.render) SJ.Game._render(g);
      state.frame++;
    },

    // ── 只读探针 ────────────────────────────────────────────────
    stack: () => SJ.Game.stack,
    top: () => SJ.Game.stack[SJ.Game.stack.length - 1] || null,
    dbg: () => (SJ.Level._debug ? SJ.Level._debug() : {}),
    player: () => SJ.player,
    foes: () => SJ.Ent.by('foe').filter(e => !e.dead && e.hp > 0),
    playtime: () => SJ.Save.data.playtimeSec,

    /* 场景判定。Menu.ending 走的是 setScene（不是 push），
     * 栈会被清空成 [endingScene] —— walk.js 只认「关卡序号变了」，
     * 所以终章明明通关了它还在原地撞墙。 */
    where: function () {
      const st = SJ.Game.stack;
      if (!st.length) return 'empty';
      if (st[0] !== H.levelScene) return 'ending';      // 关卡场景被整个换掉 = 结局/标题
      if (st.length === 1) return 'level';
      return 'overlay';                                  // 对白 / 生杀抉择 / 暂停 / 死亡
    }
  };
  return H;
}

module.exports = { boot, mulberry32 };
