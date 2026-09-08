/* 音量条自检（T4 · 决议 017）。无头断言，不需要浏览器也不需要人耳。
 * 用法: node dev/vol-check.js      退出码非 0 = 失败
 *
 * 查五件事：
 *   1. 缺省 0.9（= 原来 master.gain 写死的那个值），没有存档也不报错
 *   2. set → get 往返
 *   3. 越界夹紧到 [0,1]；非数字忽略（不把音量弄成 NaN）
 *   4. 写进 localStorage['sj_volume']，「刷新」后读得回来
 *   5. 建图时 master.gain 真的拿到了存值（而不是仍然写死 0.9）
 *   6. setVolume 不碰 muted，也不碰 Save 结构
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const errors = [];
function ok(cond, msg) { if (!cond) errors.push(msg); }
function near(a, b) { return Math.abs(a - b) < 1e-6; }

// ── 最小 Web Audio 替身：只做 audio.js 建图会碰到的那几个节点 ──
function fakeAudio(made) {
  const mk = () => {
    const n = {
      gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime(v) { this.value = v; }, cancelScheduledValues() {} },
      connect() {}, disconnect() {}
    };
    if (made) made.push(n);            // buildGraph 里第一个 createGain 就是 master
    return n;
  };
  function AC() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = 'running';
    this.destination = { connect() {} };
  }
  AC.prototype.resume = function () {};
  AC.prototype.createGain = mk;
  AC.prototype.createStereoPanner = () => ({ pan: { value: 0 }, connect() {}, disconnect() {} });
  AC.prototype.createDynamicsCompressor = () => ({
    threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
    attack: { value: 0 }, release: { value: 0 }, connect() {}
  });
  AC.prototype.createConvolver = () => ({ buffer: null, connect() {} });
  AC.prototype.createBuffer = (ch, len) => ({
    numberOfChannels: ch, length: len,
    getChannelData: () => new Float32Array(len)
  });
  AC.prototype.createBufferSource = () => ({ buffer: null, loop: false, playbackRate: { value: 1 }, connect() {}, start() {}, stop() {} });
  AC.prototype.createBiquadFilter = () => ({ type: '', frequency: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} }, Q: { value: 0 }, connect() {} });
  AC.prototype.createOscillator = () => ({ type: '', frequency: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} });
  return AC;
}

// 用同一个 store 反复「刷新」：store 就是浏览器里那份 localStorage
function boot(store, withAudio, made) {
  const sandbox = {
    console, Math, Date, JSON, Object, Array, String, Number, Boolean, Error,
    Float32Array, Uint8ClampedArray, isFinite, isNaN, parseFloat, parseInt, Promise,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    performance: { now: () => 0 },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    }
  };
  if (withAudio) sandbox.AudioContext = fakeAudio(made);
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['src/core/const.js', 'src/audio/audio.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.SJ;
}

// 1 · 缺省
let store = {};
let SJ = boot(store, false);
ok(typeof SJ.Audio.setVolume === 'function', 'SJ.Audio.setVolume 不存在');
ok(typeof SJ.Audio.getVolume === 'function', 'SJ.Audio.getVolume 不存在');
ok(near(SJ.Audio.getVolume(), 0.9), '缺省音量应为 0.9，实际 ' + SJ.Audio.getVolume());

// 2 · 往返
SJ.Audio.setVolume(0.42);
ok(near(SJ.Audio.getVolume(), 0.42), 'set(0.42) 之后 get 应为 0.42，实际 ' + SJ.Audio.getVolume());
SJ.Audio.setVolume(0);
ok(near(SJ.Audio.getVolume(), 0), 'set(0) 之后 get 应为 0，实际 ' + SJ.Audio.getVolume());
SJ.Audio.setVolume(1);
ok(near(SJ.Audio.getVolume(), 1), 'set(1) 之后 get 应为 1，实际 ' + SJ.Audio.getVolume());

// 3 · 越界与非数字
SJ.Audio.setVolume(3.7);
ok(near(SJ.Audio.getVolume(), 1), '越上界应夹到 1，实际 ' + SJ.Audio.getVolume());
SJ.Audio.setVolume(-2);
ok(near(SJ.Audio.getVolume(), 0), '越下界应夹到 0，实际 ' + SJ.Audio.getVolume());
SJ.Audio.setVolume(0.55);
SJ.Audio.setVolume('响一点');
ok(near(SJ.Audio.getVolume(), 0.55), '非数字应被忽略，实际 ' + SJ.Audio.getVolume());
SJ.Audio.setVolume(NaN);
ok(near(SJ.Audio.getVolume(), 0.55), 'NaN 应被忽略，实际 ' + SJ.Audio.getVolume());

// 4 · 存 localStorage，「刷新」后读回
ok(store['sj_volume'] === '0.55', "localStorage['sj_volume'] 应为 '0.55'，实际 " + JSON.stringify(store['sj_volume']));
let SJ2 = boot(store, false);
ok(near(SJ2.Audio.getVolume(), 0.55), '刷新后应从 localStorage 读回 0.55，实际 ' + SJ2.Audio.getVolume());

// 存了脏值也要能起来（别让一个坏字符串把游戏卡在开机）
let SJ3 = boot({ sj_volume: 'zzz' }, false);
ok(near(SJ3.Audio.getVolume(), 0.9), '脏存值应退回缺省 0.9，实际 ' + SJ3.Audio.getVolume());

// 5 · 建图时 master.gain 拿到存值（原来这里是写死的 0.9）
let SJ4 = boot({ sj_volume: '0.25' }, true);
SJ4.Audio.init();
ok(SJ4.Audio.ready === true, 'Audio.init() 之后 ready 应为 true');
SJ4.Audio.setVolume(0.7);
ok(near(SJ4.Audio.getVolume(), 0.7), 'ctx 建好之后 set/get 仍应往返');
// 建图那一刻 master.gain 就要是存值（原来这里写死 0.9），之后 setVolume 要落到它身上
let made = [];
let SJ5 = boot({ sj_volume: '0.25' }, true, made);
SJ5.Audio.init();
ok(near(SJ5.Audio.getVolume(), 0.25), '建图后 getVolume 应仍是存值 0.25，实际 ' + SJ5.Audio.getVolume());
ok(made.length > 0, 'buildGraph 没有创建任何 gain 节点？');
ok(made.length && near(made[0].gain.value, 0.25),
   'master.gain 建图时应等于存值 0.25，实际 ' + (made.length ? made[0].gain.value : 'n/a'));
SJ5.Audio.setVolume(0.6);
ok(made.length && near(made[0].gain.value, 0.6),
   'setVolume 应斜坡到 master.gain=0.6，实际 ' + (made.length ? made[0].gain.value : 'n/a'));
SJ5.Audio.setVolume(0.25);

// 6 · 不碰 muted、不碰 Save
ok(SJ5.Audio.muted === false, 'setVolume 不该动 muted');
SJ5.Audio.setMute(true);
ok(SJ5.Audio.muted === true && near(SJ5.Audio.getVolume(), 0.25), 'setMute 不该动音量');
ok(Object.keys(store).join(',') === 'sj_volume', 'setVolume 只应写 sj_volume，实际写了 ' + Object.keys(store).join(','));

if (errors.length) {
  console.log('✗ 音量自检失败 ' + errors.length + ' 条:');
  errors.forEach(e => console.log('   - ' + e));
  process.exit(1);
}
console.log('✓ 音量自检通过（缺省/往返/夹紧/非数字/持久化/建图取值/与 muted 正交）');
