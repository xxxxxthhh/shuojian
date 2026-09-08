(function (SJ) {
  'use strict';

  // ---------------------------------------------------------------------
  // 说剑 · 音频引擎 —— 纯 Web Audio 程序化合成，零音频文件。
  // 结构：底层小合成器（噪声/拨弦/笛/鼓/木/磬/号角）→ sfx 一次性事件
  //       → music 按轨道的环境层 + 程序化 scheduler（五声音阶随机生成）
  //       → 全局：DynamicsCompressor + 程序化混响（ConvolverNode）。
  // ---------------------------------------------------------------------

  var ctx = null;
  var master, muteGain, compressor, convolver, wetGain, dryGain, preBus, sfxBus, musicBus;
  var noiseBufShort, noiseBufLong;
  var currentTrack = null;      // {gain, stop}
  var currentMusicName = null;
  var curIntensity = 0.45, targetIntensity = 0.45;
  var intensityStarted = false;

  // ---- 小工具 ----------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function weighted(weights) {
    var sum = 0, i;
    for (i = 0; i < weights.length; i++) sum += weights[i];
    var r = Math.random() * sum;
    for (i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
    return weights.length - 1;
  }

  // D 宫 五声音阶：D E F# A B（供 music 生成器使用）
  var PENTA = [293.66, 329.63, 369.99, 440.00, 493.88];
  function scaleFreq(step, octShift) {
    var n = PENTA.length;
    var idx = ((step % n) + n) % n;
    var oct = Math.floor(step / n) + (octShift || 0);
    return PENTA[idx] * Math.pow(2, oct);
  }

  function makeNoiseBuffer(sec) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * sec));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function makeImpulse(sec) {
    var len = Math.floor(ctx.sampleRate * sec);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.exp(-4 * (i / len));
      }
    }
    return buf;
  }

  // ---------------------------------------------------------------------
  // 底层合成体（每个都接受 dest 目标节点 + o 选项，o.t 为起始时间，默认 now）
  // 全部自行 onended 断开内部节点，并用 setTimeout 兜底断开外壳节点。
  // ---------------------------------------------------------------------

  // 噪声瞬态/嗖声：滤波白噪声，频率可从 freq0 扫到 freq1
  function noiseBurst(dest, o) {
    o = o || {};
    var t = (o.t != null) ? o.t : ctx.currentTime;
    var vol = o.vol != null ? o.vol : 0.3;
    var dur = o.dur || 0.12;
    var out = ctx.createGain(); out.gain.value = 1; out.connect(dest);
    var src = ctx.createBufferSource();
    src.buffer = dur > 1.2 ? noiseBufLong : noiseBufShort;
    src.loop = true; // 缓冲区可能比 dur 短（如 0.4s 短噪声配 0.9s 包络），循环避免包络衰减期间断成静音
    var filt = ctx.createBiquadFilter();
    filt.type = o.filterType || 'bandpass';
    var f0 = Math.max(20, o.freq0 != null ? o.freq0 : 2000);
    var f1 = Math.max(20, o.freq1 != null ? o.freq1 : f0);
    filt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    filt.Q.value = o.Q != null ? o.Q : 1;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(filt); filt.connect(g); g.connect(out);
    src.start(t); src.stop(t + dur + 0.03);
    src.onended = function () { src.disconnect(); filt.disconnect(); g.disconnect(); };
    setTimeout(function () { out.disconnect(); }, (dur + 0.2) * 1000);
    return out;
  }

  // 低频下扫 thump：鼓/落地/受击一类的重量感
  function thump(dest, o) {
    o = o || {};
    var t = (o.t != null) ? o.t : ctx.currentTime;
    var vol = o.vol != null ? o.vol : 0.4;
    var dur = o.dur || 0.12;
    var f0 = Math.max(20, o.f0 != null ? o.f0 : 200);
    var f1 = Math.max(20, o.f1 != null ? o.f1 : 70);
    var out = ctx.createGain(); out.gain.value = 1; out.connect(dest);
    var osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + dur + 0.04);
    osc.onended = function () { osc.disconnect(); g.disconnect(); };
    setTimeout(function () { out.disconnect(); }, (dur + 0.2) * 1000);
    return out;
  }

  // 短促正弦哔声：UI / coin / heart 用
  function blip(dest, freq, o) {
    o = o || {};
    var t = (o.t != null) ? o.t : ctx.currentTime;
    var vol = o.vol != null ? o.vol : 0.25;
    var dur = o.dur || 0.08;
    var out = ctx.createGain(); out.gain.value = 1; out.connect(dest);
    var osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.freq2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freq2), t + dur * 0.85);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + dur + 0.03);
    osc.onended = function () { osc.disconnect(); g.disconnect(); };
    setTimeout(function () { out.disconnect(); }, (dur + 0.15) * 1000);
    return out;
  }

  // 战鼓：正弦快速下扫 120→45Hz + 噪声瞬态
  function drum(dest, o) {
    o = o || {};
    var t = (o.t != null) ? o.t : ctx.currentTime;
    var vol = o.vol != null ? o.vol : 0.6;
    var decay = o.decay || 0.26;
    var out = ctx.createGain(); out.gain.value = 1; out.connect(dest);
    var osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(o.f0 || 120, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 || 45), t + (o.sweep || 0.12));
    var og = ctx.createGain();
    og.gain.setValueAtTime(vol, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + decay);
    osc.connect(og); og.connect(out);
    var nsrc = ctx.createBufferSource(); nsrc.buffer = noiseBufShort;
    var nfilt = ctx.createBiquadFilter(); nfilt.type = 'lowpass'; nfilt.frequency.value = 1200;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.55, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    nsrc.connect(nfilt); nfilt.connect(ng); ng.connect(out);
    osc.start(t); osc.stop(t + decay + 0.05);
    nsrc.start(t); nsrc.stop(t + 0.06);
    osc.onended = function () { osc.disconnect(); og.disconnect(); };
    nsrc.onended = function () { nsrc.disconnect(); nfilt.disconnect(); ng.disconnect(); };
    setTimeout(function () { out.disconnect(); }, (decay + 0.2) * 1000);
    return out;
  }

  // 木鱼/醒木：极短高 Q 带通噪声
  function woodClick(dest, o) {
    o = o || {};
    var t = (o.t != null) ? o.t : ctx.currentTime;
    var vol = o.vol != null ? o.vol : 0.5;
    var decay = o.decay || 0.09;
    var out = ctx.createGain(); out.gain.value = 1; out.connect(dest);
    var nsrc = ctx.createBufferSource(); nsrc.buffer = noiseBufShort;
    var filt = ctx.createBiquadFilter(); filt.type = 'bandpass';
    filt.frequency.value = o.freq || 900; filt.Q.value = o.Q || 12;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    nsrc.connect(filt); filt.connect(g); g.connect(out);
    nsrc.start(t); nsrc.stop(t + decay + 0.03);
    nsrc.onended = function () { nsrc.disconnect(); filt.disconnect(); g.disconnect(); };
    setTimeout(function () { out.disconnect(); }, (decay + 0.15) * 1000);
    return out;
  }

  // 磬/铃：几个不成整数比的正弦叠加，长衰减
  function bellTone(dest, freq, o) {
    o = o || {};
    var t = (o.t != null) ? o.t : ctx.currentTime;
    var vol = o.vol != null ? o.vol : 0.35;
    var dur = o.dur || 2.4;
    var partials = o.partials || [1, 2.76, 4.09, 5.4];
    var out = ctx.createGain(); out.gain.value = 1; out.connect(dest);
    partials.forEach(function (ratio, i) {
      var osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq * ratio;
      var decay = dur * (1 - i * 0.12);
      var g = ctx.createGain();
      g.gain.setValueAtTime(vol / (i + 1), t);
      g.gain.exponentialRampToValueAtTime(0.0006, t + decay);
      osc.connect(g); g.connect(out);
      osc.start(t); osc.stop(t + decay + 0.05);
      osc.onended = function () { osc.disconnect(); g.disconnect(); };
    });
    setTimeout(function () { out.disconnect(); }, (dur + 0.3) * 1000);
    return out;
  }

  // 古琴/古筝拨弦：短促噪声爆发 + 基频/2/3/5 次谐波各自衰减 + 轻微 pitch bend（吟猱）
  function pluck(dest, freq, o) {
    o = o || {};
    var t = (o.t != null) ? o.t : ctx.currentTime;
    var vol = o.vol != null ? o.vol : 0.4;
    var dur = o.dur || 1.4;
    var out = ctx.createGain(); out.gain.value = 1; out.connect(dest);
    // 拨弦瞬态
    var nsrc = ctx.createBufferSource(); nsrc.buffer = noiseBufShort;
    var nfilt = ctx.createBiquadFilter(); nfilt.type = 'bandpass'; nfilt.frequency.value = freq * 2.2; nfilt.Q.value = 1.2;
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0006, t + 0.05);
    nsrc.connect(nfilt); nfilt.connect(ng); ng.connect(out);
    nsrc.start(t); nsrc.stop(t + 0.06);
    nsrc.onended = function () { nsrc.disconnect(); nfilt.disconnect(); ng.disconnect(); };
    // 泛音组
    var harmonics = o.harmonics || [[1, dur, 1.0], [2, dur * 0.55, 0.5], [3, dur * 0.4, 0.32], [5, dur * 0.22, 0.18]];
    var bend = o.bend !== false;
    harmonics.forEach(function (h) {
      var mult = h[0], decay = h[1], amp = h[2];
      var osc = ctx.createOscillator(); osc.type = 'sine';
      var f0 = freq * mult;
      osc.frequency.setValueAtTime(f0, t);
      if (bend) {
        osc.frequency.linearRampToValueAtTime(f0 * (1 + (o.bendAmt || 0.008)), t + decay * 0.5);
        osc.frequency.linearRampToValueAtTime(f0, t + decay * 0.9);
      }
      var og = ctx.createGain();
      og.gain.setValueAtTime(vol * amp, t);
      og.gain.exponentialRampToValueAtTime(0.0006, t + decay);
      osc.connect(og); og.connect(out);
      osc.start(t); osc.stop(t + decay + 0.05);
      osc.onended = function () { osc.disconnect(); og.disconnect(); };
    });
    setTimeout(function () { out.disconnect(); }, (dur + 0.2) * 1000);
    return out;
  }

  // 竹笛/箫：三角波 + 低通 + 气声噪声 + 慢 vibrato
  function flute(dest, freq, o) {
    o = o || {};
    var t = (o.t != null) ? o.t : ctx.currentTime;
    var vol = o.vol != null ? o.vol : 0.3;
    var dur = o.dur || 0.6;
    var out = ctx.createGain(); out.gain.value = 1; out.connect(dest);
    var osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = freq;
    var filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = freq * 4; filt.Q.value = 0.5;
    var env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(vol, t + Math.min(0.06, dur * 0.2));
    env.gain.setValueAtTime(vol, t + Math.max(0, dur - 0.12));
    env.gain.linearRampToValueAtTime(0.0001, t + dur);
    var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = o.vibratoRate || 4.5;
    var lfoGain = ctx.createGain(); lfoGain.gain.value = o.vibratoDepth != null ? o.vibratoDepth : 4;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
    var nsrc = ctx.createBufferSource(); nsrc.buffer = noiseBufLong; nsrc.loop = true;
    var nfilt = ctx.createBiquadFilter(); nfilt.type = 'bandpass'; nfilt.frequency.value = freq * 3; nfilt.Q.value = 0.8;
    var ng = ctx.createGain(); ng.gain.value = vol * 0.07;
    osc.connect(filt); filt.connect(env); env.connect(out);
    nsrc.connect(nfilt); nfilt.connect(ng); ng.connect(out);
    osc.start(t); osc.stop(t + dur + 0.05);
    lfo.start(t); lfo.stop(t + dur + 0.05);
    nsrc.start(t); nsrc.stop(t + dur + 0.05);
    osc.onended = function () { osc.disconnect(); filt.disconnect(); env.disconnect(); };
    lfo.onended = function () { lfo.disconnect(); lfoGain.disconnect(); };
    nsrc.onended = function () { nsrc.disconnect(); nfilt.disconnect(); ng.disconnect(); };
    setTimeout(function () { out.disconnect(); }, (dur + 0.2) * 1000);
    return out;
  }

  // 号角式长音：锯齿波 + 低通 + 缓慢起落包络（城楼）
  function horn(dest, freq, o) {
    o = o || {};
    var t = (o.t != null) ? o.t : ctx.currentTime;
    var vol = o.vol != null ? o.vol : 0.2;
    var dur = o.dur || 2.0;
    var out = ctx.createGain(); out.gain.value = 1; out.connect(dest);
    var osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(freq, t);
    var filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = freq * 2.2; filt.Q.value = 0.6;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    osc.connect(filt); filt.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + dur + 0.05);
    osc.onended = function () { osc.disconnect(); filt.disconnect(); g.disconnect(); };
    setTimeout(function () { out.disconnect(); }, (dur + 0.2) * 1000);
    return out;
  }

  // 持续音（低音鼓点/河流底音）：正弦 + detune LFO，淡入起 / stop() 淡出后自行断开
  function makeDrone(dest, freq, o) {
    o = o || {};
    var vol = o.vol != null ? o.vol : 0.12;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator(); osc.type = o.type || 'sine'; osc.frequency.value = freq;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 2.0);
    var lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = o.lfoRate || 0.1;
    var lfoGain = ctx.createGain(); lfoGain.gain.value = o.lfoDepth != null ? o.lfoDepth : 1.5;
    lfo.connect(lfoGain); lfoGain.connect(osc.detune);
    osc.connect(g); g.connect(dest);
    osc.start(t); lfo.start(t);
    return {
      stop: function () {
        var tt = ctx.currentTime;
        g.gain.cancelScheduledValues(tt);
        g.gain.setValueAtTime(g.gain.value, tt);
        g.gain.linearRampToValueAtTime(0.0001, tt + 0.6);
        setTimeout(function () {
          try { osc.stop(); } catch (e) {}
          try { lfo.stop(); } catch (e) {}
          osc.disconnect(); g.disconnect(); lfo.disconnect(); lfoGain.disconnect();
        }, 700);
      }
    };
  }

  // 循环滤波噪声（雨/风/水/雪风环境底层），可选 LFO 扫滤波频率
  function makeNoiseLoopFiltered(dest, o) {
    o = o || {};
    var src = ctx.createBufferSource();
    src.buffer = noiseBufLong; src.loop = true;
    var filt = ctx.createBiquadFilter();
    filt.type = o.type || 'lowpass';
    filt.frequency.value = o.freq || 800;
    filt.Q.value = o.Q != null ? o.Q : 0.7;
    var g = ctx.createGain(); g.gain.value = o.gain != null ? o.gain : 0.12;
    src.connect(filt); filt.connect(g); g.connect(dest);
    src.start();
    var lfo = null, lfoGain = null;
    if (o.freqLfoRate) {
      lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = o.freqLfoRate;
      lfoGain = ctx.createGain(); lfoGain.gain.value = o.freqLfoDepth || 200;
      lfo.connect(lfoGain); lfoGain.connect(filt.frequency);
      lfo.start();
    }
    return {
      gain: g,
      stop: function () {
        try { src.stop(); } catch (e) {}
        try { lfo && lfo.stop(); } catch (e) {}
        src.disconnect(); filt.disconnect(); g.disconnect();
        if (lfo) { lfo.disconnect(); lfoGain.disconnect(); }
      }
    };
  }

  // ---- 环境层 ------------------------------------------------------------
  function ambRain(dest, vol) {
    var loop = makeNoiseLoopFiltered(dest, { type: 'highpass', freq: 1800, Q: 0.4, gain: vol || 0.12, freqLfoRate: 0.15, freqLfoDepth: 300 });
    var stopped = false;
    var timer = null;
    (function tick() {
      if (stopped) return;
      noiseBurst(dest, { dur: 0.045, freq0: rnd(3000, 6000), freq1: rnd(1500, 3000), filterType: 'bandpass', Q: 2, vol: rnd(0.03, 0.08) });
      timer = setTimeout(tick, rnd(0.05, 0.22) * 1000);
    })();
    return { stop: function () { stopped = true; clearTimeout(timer); loop.stop(); } };
  }
  function ambWind(dest, vol) {
    return makeNoiseLoopFiltered(dest, { type: 'lowpass', freq: 500, Q: 0.6, gain: vol || 0.1, freqLfoRate: 0.06, freqLfoDepth: 250 });
  }
  function ambWater(dest, vol) {
    return makeNoiseLoopFiltered(dest, { type: 'lowpass', freq: 260, Q: 0.7, gain: vol || 0.12, freqLfoRate: 0.09, freqLfoDepth: 80 });
  }
  function ambSnowWind(dest, vol) {
    return makeNoiseLoopFiltered(dest, { type: 'lowpass', freq: 340, Q: 0.5, gain: vol || 0.06, freqLfoRate: 0.035, freqLfoDepth: 120 });
  }

  // ---- Scheduler ---------------------------------------------------------
  // 简单事件循环：stepFn() 触发一次事件并返回到下一次的秒数（用于稀疏/环境事件）
  function startLoop(stepFn, initialDelay) {
    var timer = null, stopped = false;
    function tick() {
      if (stopped) return;
      var next = stepFn();
      if (typeof next !== 'number' || next <= 0) next = 1;
      timer = setTimeout(tick, next * 1000);
    }
    timer = setTimeout(tick, (initialDelay != null ? initialDelay : 0.5) * 1000);
    return { stop: function () { stopped = true; clearTimeout(timer); } };
  }
  // 音频时钟 lookahead 调度器：stepFn(t) 在音频时钟 t 处安排声音，返回到下一拍的秒数
  function makeScheduler(stepFn) {
    var lookahead = 0.1, scheduleAhead = 0.25;
    var nextTime = ctx.currentTime + 0.05;
    var timer = null, stopped = false;
    function poll() {
      if (stopped) return;
      // 后台标签页被节流后 setTimeout 会大幅延迟，nextTime 可能已远落后于音频时钟；
      // 追上时钟再继续，避免一次性把积压的好几拍全部挤在同一时刻触发。
      if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05;
      while (nextTime < ctx.currentTime + scheduleAhead) {
        var advance = stepFn(nextTime);
        nextTime += (typeof advance === 'number' && advance > 0) ? advance : 0.5;
      }
      timer = setTimeout(poll, lookahead * 1000);
    }
    poll();
    return { stop: function () { stopped = true; clearTimeout(timer); } };
  }

  // ---------------------------------------------------------------------
  // sfx 表
  // ---------------------------------------------------------------------
  var SFX = {
    swing1: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.10, freq0: 3000 * o.rate, freq1: 1200 * o.rate, filterType: 'bandpass', Q: 1.0, vol: 0.30 });
    },
    swing2: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.09, freq0: 3600 * o.rate, freq1: 1500 * o.rate, filterType: 'bandpass', Q: 1.1, vol: 0.34 });
    },
    swing3: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.15, freq0: 4200 * o.rate, freq1: 900 * o.rate, filterType: 'bandpass', Q: 0.9, vol: 0.40 });
      thump(dest, { t: o.t, f0: 150 * o.rate, f1: 70 * o.rate, dur: 0.12, vol: 0.18 });
    },
    hit: function (dest, o) {
      thump(dest, { t: o.t, f0: 220 * o.rate, f1: 80 * o.rate, dur: 0.09, vol: 0.45 });
      noiseBurst(dest, { t: o.t, dur: 0.07, freq0: 2500 * o.rate, freq1: 1000 * o.rate, filterType: 'bandpass', vol: 0.28 });
    },
    hitHeavy: function (dest, o) {
      thump(dest, { t: o.t, f0: 170 * o.rate, f1: 55 * o.rate, dur: 0.18, vol: 0.60 });
      noiseBurst(dest, { t: o.t, dur: 0.12, freq0: 2200 * o.rate, freq1: 600 * o.rate, filterType: 'bandpass', Q: 0.8, vol: 0.40 });
    },
    parry: function (dest, o) {
      bellTone(dest, 1200 * o.rate, { t: o.t, dur: 0.4, vol: 0.35, partials: [1, 2.4] });
      noiseBurst(dest, { t: o.t, dur: 0.03, freq0: 5000 * o.rate, freq1: 3000 * o.rate, vol: 0.2 });
    },
    block: function (dest, o) {
      thump(dest, { t: o.t, f0: 140 * o.rate, f1: 70 * o.rate, dur: 0.12, vol: 0.30 });
      noiseBurst(dest, { t: o.t, dur: 0.08, freq0: 1500 * o.rate, freq1: 700 * o.rate, vol: 0.20 });
    },
    guard: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.14, freq0: 1800 * o.rate, freq1: 2400 * o.rate, filterType: 'bandpass', Q: 0.6, vol: 0.16 });
    },
    dash: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.16, freq0: 5000 * o.rate, freq1: 1200 * o.rate, filterType: 'bandpass', Q: 0.7, vol: 0.30 });
    },
    jump: function (dest, o) {
      thump(dest, { t: o.t, f0: 300 * o.rate, f1: 150 * o.rate, dur: 0.08, vol: 0.22 });
      noiseBurst(dest, { t: o.t, dur: 0.05, freq0: 2000 * o.rate, freq1: 1200 * o.rate, vol: 0.12 });
    },
    land: function (dest, o) {
      thump(dest, { t: o.t, f0: 180 * o.rate, f1: 55 * o.rate, dur: 0.10, vol: 0.35 });
      noiseBurst(dest, { t: o.t, dur: 0.09, freq0: 1200 * o.rate, freq1: 400 * o.rate, vol: 0.22 });
    },
    step: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.045, freq0: 900 * o.rate, freq1: 350 * o.rate, vol: 0.10 });
    },
    hurt: function (dest, o) {
      thump(dest, { t: o.t, f0: 260 * o.rate, f1: 120 * o.rate, dur: 0.11, vol: 0.30 });
      noiseBurst(dest, { t: o.t, dur: 0.08, freq0: 2200 * o.rate, freq1: 900 * o.rate, vol: 0.18 });
    },
    death: function (dest, o) {
      pluck(dest, 110 * o.rate, { t: o.t, dur: 1.8, vol: 0.40, bend: false, harmonics: [[1, 1.8, 1], [2, 1.0, 0.4], [3, 0.6, 0.2]] });
      noiseBurst(dest, { t: o.t, dur: 0.3, freq0: 1200 * o.rate, freq1: 200 * o.rate, vol: 0.25 });
    },
    enemyDeath: function (dest, o) {
      thump(dest, { t: o.t, f0: 200 * o.rate, f1: 60 * o.rate, dur: 0.35, vol: 0.40 });
      noiseBurst(dest, { t: o.t, dur: 0.25, freq0: 1200 * o.rate, freq1: 300 * o.rate, vol: 0.25 });
    },
    draw: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.22, freq0: 900 * o.rate, freq1: 3200 * o.rate, filterType: 'bandpass', Q: 1.2, vol: 0.22 });
    },
    sheathe: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.22, freq0: 3200 * o.rate, freq1: 900 * o.rate, filterType: 'bandpass', Q: 1.2, vol: 0.20 });
    },
    learn: function (dest, o) {
      bellTone(dest, 660 * o.rate, { t: o.t, dur: 2.2, vol: 0.40, partials: [1, 2.0, 3.76, 5.4] });
      pluck(dest, 440 * o.rate, { t: o.t, dur: 1.2, vol: 0.25, bend: false });
    },
    qi: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.28, freq0: 2200 * o.rate, freq1: 5000 * o.rate, filterType: 'bandpass', Q: 0.8, vol: 0.22 });
      flute(dest, 880 * o.rate, { t: o.t, dur: 0.3, vol: 0.15, vibratoDepth: 2 });
    },
    arrow: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.2, freq0: 6000 * o.rate, freq1: 1800 * o.rate, filterType: 'bandpass', Q: 1.3, vol: 0.25 });
    },
    bell: function (dest, o) {
      bellTone(dest, 523 * o.rate, { t: o.t, dur: 2.6, vol: 0.35 });
    },
    woodclap: function (dest, o) {
      woodClick(dest, { t: o.t, freq: 1000 * o.rate, Q: 14, decay: 0.07, vol: 0.55 });
    },
    page: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.35, freq0: 2500 * o.rate, freq1: 2000 * o.rate, filterType: 'bandpass', Q: 0.5, vol: 0.18 });
    },
    door: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.55, freq0: 400 * o.rate, freq1: 900 * o.rate, filterType: 'bandpass', Q: 8, vol: 0.18 });
      thump(dest, { t: o.t + 0.5, f0: 90 * o.rate, f1: 55 * o.rate, dur: 0.10, vol: 0.15 });
    },
    fire: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.4, freq0: 3000 * o.rate, freq1: 1200 * o.rate, filterType: 'bandpass', Q: 0.6, vol: 0.25 });
      noiseBurst(dest, { t: o.t + 0.07, dur: 0.03, freq0: 6000, freq1: 4000, filterType: 'bandpass', Q: 3, vol: 0.10 });
      noiseBurst(dest, { t: o.t + 0.16, dur: 0.03, freq0: 5500, freq1: 3500, filterType: 'bandpass', Q: 3, vol: 0.08 });
    },
    water: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.18, freq0: 2600 * o.rate, freq1: 900 * o.rate, filterType: 'bandpass', Q: 1.0, vol: 0.20 });
    },
    wind: function (dest, o) {
      noiseBurst(dest, { t: o.t, dur: 0.9, freq0: 500 * o.rate, freq1: 1400 * o.rate, filterType: 'lowpass', Q: 0.5, vol: 0.14 });
    },
    ui: function (dest, o) {
      blip(dest, 520 * o.rate, { t: o.t, dur: 0.05, vol: 0.18, type: 'sine' });
    },
    uiConfirm: function (dest, o) {
      blip(dest, 520 * o.rate, { t: o.t, dur: 0.07, vol: 0.20, type: 'sine', freq2: 780 * o.rate });
    },
    uiBack: function (dest, o) {
      blip(dest, 520 * o.rate, { t: o.t, dur: 0.07, vol: 0.20, type: 'sine', freq2: 340 * o.rate });
    },
    coin: function (dest, o) {
      blip(dest, 1200 * o.rate, { t: o.t, dur: 0.09, vol: 0.22, type: 'triangle', freq2: 1800 * o.rate });
      bellTone(dest, 1600 * o.rate, { t: o.t, dur: 0.3, vol: 0.15, partials: [1, 2.4] });
    },
    heart: function (dest, o) {
      blip(dest, 660 * o.rate, { t: o.t, dur: 0.16, vol: 0.20, type: 'sine' });
      blip(dest, 990 * o.rate, { t: o.t, dur: 0.16, vol: 0.15, type: 'sine' });
    }
  };

  // ---------------------------------------------------------------------
  // music 轨道
  // ---------------------------------------------------------------------
  var TRACKS = {
    tea: function (dest) {
      var rain = ambRain(dest, 0.11);
      var qinLoop = startLoop(function () {
        pluck(dest, scaleFreq(weighted([0.35, 0.1, 0.15, 0.3, 0.1]), 0), { dur: 1.6, vol: 0.22 });
        return rnd(2.5, 5.0);
      }, 1.5);
      var murmurLoop = startLoop(function () {
        noiseBurst(dest, { dur: 0.5, freq0: 600, freq1: 450, filterType: 'bandpass', Q: 0.6, vol: rnd(0.03, 0.07) });
        return rnd(4, 9);
      }, 3);
      return { stop: function () { rain.stop(); qinLoop.stop(); murmurLoop.stop(); } };
    },
    bamboo: function (dest) {
      var rain = ambRain(dest, 0.09);
      var lastDeg = 0;
      var fluteLoop = startLoop(function () {
        lastDeg += Math.round(rnd(-2, 2));
        flute(dest, scaleFreq(lastDeg, 1), { dur: rnd(0.5, 0.9), vol: 0.20, vibratoDepth: 3.5, vibratoRate: 4 });
        return rnd(1.2, 2.6);
      }, 1);
      var qinLoop = startLoop(function () {
        pluck(dest, scaleFreq(weighted([0.3, 0.15, 0.2, 0.25, 0.1]), 0), { dur: 1.4, vol: 0.14 });
        return rnd(6, 12);
      }, 3);
      return { stop: function () { rain.stop(); fluteLoop.stop(); qinLoop.stop(); } };
    },
    inn: function (dest) {
      var stopped = false;
      var drumLoop = makeScheduler(function (t) {
        if (Math.random() < 0.85) drum(dest, { t: t, f0: 130, f1: 48, decay: 0.22, vol: 0.5 });
        return 0.42;
      });
      var pipaLoop = startLoop(function () {
        var freq = scaleFreq(weighted([0.3, 0.15, 0.25, 0.2, 0.1]), 1);
        var n = 3 + Math.floor(Math.random() * 4);
        for (var i = 0; i < n; i++) {
          (function (delay) {
            setTimeout(function () {
              if (!stopped) pluck(dest, freq, { dur: 0.3, vol: 0.16, harmonics: [[1, 0.28, 1], [2, 0.16, 0.4]], bend: false });
            }, delay);
          })(i * 65);
        }
        return rnd(0.5, 0.95);
      }, 0.3);
      return { stop: function () { stopped = true; drumLoop.stop(); pipaLoop.stop(); } };
    },
    river: function (dest) {
      var water = ambWater(dest, 0.13);
      var drone = makeDrone(dest, scaleFreq(-8, 0), { vol: 0.14, type: 'sine', lfoRate: 0.06, lfoDepth: 1 });
      var fluteLoop = startLoop(function () {
        flute(dest, scaleFreq(weighted([0.3, 0.1, 0.2, 0.3, 0.1]), 1), { dur: rnd(1.6, 2.6), vol: 0.18, vibratoDepth: 3, vibratoRate: 3.5 });
        return rnd(4, 8);
      }, 2);
      return { stop: function () { water.stop(); drone.stop(); fluteLoop.stop(); } };
    },
    snow: function (dest) {
      var wind = ambSnowWind(dest, 0.05);
      var bellLoop = startLoop(function () {
        bellTone(dest, scaleFreq(weighted([0.3, 0.1, 0.15, 0.3, 0.15]), 1), { dur: rnd(2.2, 3.2), vol: 0.16 });
        return rnd(4, 10);
      }, 2);
      return { stop: function () { wind.stop(); bellLoop.stop(); } };
    },
    library: function (dest) {
      var qinLoop = startLoop(function () {
        pluck(dest, scaleFreq(weighted([0.3, 0.15, 0.2, 0.25, 0.1]), 0), { dur: 1.5, vol: 0.16 });
        return rnd(5, 12);
      }, 3);
      var paperLoop = startLoop(function () {
        noiseBurst(dest, { dur: rnd(0.3, 0.6), freq0: 2600, freq1: 2200, filterType: 'bandpass', Q: 0.5, vol: rnd(0.03, 0.07) });
        return rnd(3, 8);
      }, 2);
      return { stop: function () { qinLoop.stop(); paperLoop.stop(); } };
    },
    wall: function (dest) {
      var wind = ambWind(dest, 0.05);
      var drumLoop = makeScheduler(function (t) {
        var dens = 0.5 + curIntensity * 0.35;
        if (Math.random() < dens) drum(dest, { t: t, f0: 115, f1: 42, decay: 0.24, vol: 0.4 + curIntensity * 0.3 });
        return 0.55 - curIntensity * 0.12;
      });
      var hornLoop = startLoop(function () {
        horn(dest, scaleFreq(weighted([0.4, 0.1, 0.2, 0.2, 0.1]), -1), { dur: 2.2, vol: 0.16 });
        return rnd(6, 10);
      }, 3);
      return { stop: function () { wind.stop(); drumLoop.stop(); hornLoop.stop(); } };
    },
    boss: function (dest) {
      var drone = makeDrone(dest, scaleFreq(-5, 0), { vol: 0.10, type: 'sawtooth', lfoRate: 0.08, lfoDepth: 2 });
      var drumLoop = makeScheduler(function (t) {
        var dens = 0.4 + curIntensity * 0.55;
        if (Math.random() < dens) drum(dest, { t: t, f0: 125, f1: 46, decay: 0.2, vol: 0.35 + curIntensity * 0.35 });
        return Math.max(0.22, 0.5 - curIntensity * 0.22);
      });
      var stabLoop = startLoop(function () {
        var deg = weighted([0.25, 0.1, 0.2, 0.3, 0.15]);
        pluck(dest, scaleFreq(deg, 0), { dur: 0.5, vol: 0.14 + curIntensity * 0.12, harmonics: [[1, 0.4, 1], [2, 0.24, 0.4], [3, 0.16, 0.2]] });
        if (curIntensity > 0.6) flute(dest, scaleFreq(deg + 2, 1), { dur: 0.35, vol: 0.08 * curIntensity, vibratoDepth: 6 });
        return rnd(0.5, 1.1) / (0.6 + curIntensity * 0.8);
      }, 0.4);
      return { stop: function () { drone.stop(); drumLoop.stop(); stabLoop.stop(); } };
    },
    final: function (dest) {
      var drone = makeDrone(dest, scaleFreq(-5, 0), { vol: 0.12, type: 'sawtooth', lfoRate: 0.1, lfoDepth: 3 });
      var drumLoop = makeScheduler(function (t) {
        var dens = 0.55 + curIntensity * 0.4;
        if (Math.random() < dens) drum(dest, { t: t, f0: 130, f1: 44, decay: 0.18, vol: 0.4 + curIntensity * 0.4 });
        if (curIntensity > 0.5 && Math.random() < curIntensity * 0.5) {
          drum(dest, { t: t + 0.16, f0: 120, f1: 50, decay: 0.12, vol: 0.25 + curIntensity * 0.25 });
        }
        return Math.max(0.18, 0.4 - curIntensity * 0.2);
      });
      var stabLoop = startLoop(function () {
        var deg = weighted([0.2, 0.15, 0.2, 0.3, 0.15]);
        pluck(dest, scaleFreq(deg, 0), { dur: 0.4, vol: 0.16 + curIntensity * 0.14, harmonics: [[1, 0.32, 1], [2, 0.2, 0.4], [3, 0.12, 0.22]] });
        if (curIntensity > 0.4) bellTone(dest, scaleFreq(deg + 4, 1), { dur: 0.9, vol: 0.1 * curIntensity, partials: [1, 2.1, 3.9] });
        return rnd(0.35, 0.8) / (0.7 + curIntensity * 0.9);
      }, 0.3);
      return { stop: function () { drone.stop(); drumLoop.stop(); stabLoop.stop(); } };
    },
    ending: function (dest) {
      var deg = 0, dir = 1;
      var melLoop = startLoop(function () {
        deg += dir * (Math.random() < 0.7 ? 1 : 2);
        if (deg > 6) dir = -1;
        if (deg < -2) dir = 1;
        pluck(dest, scaleFreq(deg, 0), { dur: 2.2, vol: 0.22, harmonics: [[1, 2.2, 1], [2, 1.2, 0.4], [3, 0.7, 0.2]] });
        return rnd(1.8, 3.0);
      }, 1);
      return { stop: function () { melLoop.stop(); } };
    },
    silence: function (dest) {
      var loop = makeNoiseLoopFiltered(dest, { type: 'lowpass', freq: 220, Q: 0.4, gain: 0.025, freqLfoRate: 0.03, freqLfoDepth: 40 });
      return { stop: function () { loop.stop(); } };
    }
  };

  // ---------------------------------------------------------------------
  // 图与生命周期
  // ---------------------------------------------------------------------
  // ── 音量（决议 017）───────────────────────────────────────────
  // 作用于 master.gain，缺省 0.9（= 原来写死的那个值），存 localStorage['sj_volume']，
  // **不进 Save 结构**。muted 是另一件事，语义不变。
  var VOL_KEY = 'sj_volume', volume = null;

  function loadVolume() {
    if (volume != null) return volume;
    volume = 0.9;
    try {
      var v = window.localStorage && window.localStorage.getItem(VOL_KEY);
      if (v != null && v !== '' && isFinite(+v)) volume = clamp(+v, 0, 1);
    } catch (e) {}                       // 隐私模式下 localStorage 会抛，用缺省值
    return volume;
  }

  function buildGraph() {
    // 建图时就把存下来的音量装进去 —— 玩家上次调过的音量必须在第一声之前生效
    master = ctx.createGain(); master.gain.value = loadVolume();
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20; compressor.knee.value = 24;
    compressor.ratio.value = 4; compressor.attack.value = 0.003; compressor.release.value = 0.25;
    compressor.connect(ctx.destination);
    muteGain = ctx.createGain(); muteGain.gain.value = 1;
    muteGain.connect(compressor);
    master.connect(muteGain);

    convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(1.6);
    wetGain = ctx.createGain(); wetGain.gain.value = 0.30;
    dryGain = ctx.createGain(); dryGain.gain.value = 0.9;

    preBus = ctx.createGain(); preBus.gain.value = 1;
    preBus.connect(dryGain); dryGain.connect(master);
    preBus.connect(convolver); convolver.connect(wetGain); wetGain.connect(master);

    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.85; sfxBus.connect(preBus);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.55; musicBus.connect(preBus);
  }

  function intensityTick() {
    var t = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (intensityTick.last == null) intensityTick.last = t;
    var dt = (t - intensityTick.last) / 1000;
    intensityTick.last = t;
    var k = 1 - Math.exp(-dt / 0.6);
    curIntensity += (targetIntensity - curIntensity) * k;
  }

  function sfxChain(o) {
    var vol = (o && o.vol != null) ? o.vol : 1;
    var pan = (o && o.pan != null) ? o.pan : 0;
    var g = ctx.createGain(); g.gain.value = vol;
    g._sjPanner = null;
    if (ctx.createStereoPanner) {
      var p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
      g.connect(p); p.connect(sfxBus);
      g._sjPanner = p;
    } else {
      g.connect(sfxBus);
    }
    return g;
  }

  // ---------------------------------------------------------------------
  // 对外接口 SJ.Audio
  // ---------------------------------------------------------------------
  var Audio = {
    ready: false,
    muted: false,

    init: function () {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume();
        return;
      }
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      noiseBufShort = makeNoiseBuffer(0.4);
      noiseBufLong = makeNoiseBuffer(2.5);
      buildGraph();
      Audio.ready = true;
      if (ctx.state === 'suspended') ctx.resume();
      if (!intensityStarted) {
        intensityStarted = true;
        setInterval(intensityTick, 100);
      }
    },

    sfx: function (name, o) {
      if (!Audio.ready || Audio.muted) return;
      var fn = SFX[name];
      if (!fn) return;
      var rate = clamp((o && o.rate != null) ? o.rate : 1, 0.25, 4);
      var voiceBus = sfxChain(o);
      fn(voiceBus, { rate: rate, t: ctx.currentTime });
      setTimeout(function () {
        voiceBus.disconnect();
        if (voiceBus._sjPanner) voiceBus._sjPanner.disconnect();
      }, 3000);
    },

    music: function (name, o) {
      if (!Audio.ready) return;
      if (name === currentMusicName) return;
      var fade = (o && o.fade != null) ? o.fade : 1.2;
      if (currentTrack) {
        (function (tr) {
          var g = tr.gain.gain; var t = ctx.currentTime;
          g.cancelScheduledValues(t);
          g.setValueAtTime(g.value, t);
          g.linearRampToValueAtTime(0.0001, t + fade);
          setTimeout(function () { tr.stop(); tr.gain.disconnect(); }, fade * 1000 + 80);
        })(currentTrack);
        currentTrack = null;
      }
      currentMusicName = name;
      if (!name) return;
      var trackGain = ctx.createGain();
      trackGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      trackGain.gain.linearRampToValueAtTime(1, ctx.currentTime + fade);
      trackGain.connect(musicBus);
      var builder = TRACKS[name];
      var built = builder ? builder(trackGain) : { stop: function () {} };
      currentTrack = { gain: trackGain, stop: built.stop };
    },

    intensity: function (v) {
      targetIntensity = clamp(v, 0, 1);
    },

    duck: function (sec) {
      if (!Audio.ready) return;
      sec = sec || 0.5;
      var t = ctx.currentTime;
      var g = musicBus.gain;
      var base = 0.55;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(base * 0.3, t + 0.06);
      g.setValueAtTime(base * 0.3, t + 0.06 + sec);
      g.linearRampToValueAtTime(base, t + 0.06 + sec + 0.5);
    },

    // v ∈ [0,1]，越界夹紧，非数字忽略。ctx 还没建也能调（存起来，建图时装上）。
    setVolume: function (v) {
      v = +v;
      if (!isFinite(v)) return loadVolume();
      v = clamp(v, 0, 1);
      loadVolume();                      // 先把缓存填上，免得覆盖前没读过存值
      volume = v;
      try { if (window.localStorage) window.localStorage.setItem(VOL_KEY, String(v)); } catch (e) {}
      if (ctx && master) {
        // 直接赋值会「咔」一声：50ms 斜坡过去
        var t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(v, t + 0.05);
      }
      return v;
    },

    getVolume: function () { return loadVolume(); },

    setMute: function (b) {
      Audio.muted = !!b;
      if (!ctx) return;
      var t = ctx.currentTime;
      muteGain.gain.cancelScheduledValues(t);
      muteGain.gain.setValueAtTime(muteGain.gain.value, t);
      muteGain.gain.linearRampToValueAtTime(Audio.muted ? 0 : 1, t + 0.05);
    }
  };

  SJ.Audio = Audio;

})(window.SJ = window.SJ || {});
