/* src/story/story.js  【H · UI与剧情演出】
 * 剧本播放引擎 + 生杀抉择的无字演出。纯 classic script，挂 window.SJ.Story。
 *
 * ── cond 链式跳过（决议 002/003，硬约束） ──────────────────────────
 *   进入与每次 advance 时都对当前 node 求值 cond(SJ.Save.data)：
 *   false → 不显示该屏，直接跳到它的 next；next:null 结束。200 步上限保护。
 *
 * ── mercy 单一写入者（决议 002/003，硬约束） ───────────────────────
 *   mercyChoice 内部当场写 SJ.Save.data.mercy[id] = !killed 并 save()，
 *   写完之后才做演出，演出收尾后才 pop 场景、调用 cb(killed)——
 *   这样 G 在 cb 里调 SJ.Level.complete()（outro 先于存档）时，
 *   outro 的 cond 已经读得到本回刚写下的新值。
 *
 * ── narration 渲染（决议 003/004，硬约束） ─────────────────────────
 *   mode:'narration' 一律渲染成「关卡内画外音」：世界背景不替换，
 *   只在一侧叠一层半透明纸色读字面板。不出现说书人具名标签
 *   （speaker 字段无论是 '' 还是 '说书人' 都不加名牌）——
 *   c4_mid / c5_t_page 因此与普通题壁在视觉上毫无区别，
 *   不会被误读成切了一段过场。只有 mode:'tea' 才是整屏茶馆插画。
 *
 * 详细实现笔记见 _spec/notes-H.md。
 */
(function (SJ) {
  'use strict';

  var MAXHOPS = 200;
  var PUNCT = '，。！？；：、——…—,.!?;:';

  // ══ cond 链式跳过 ═══════════════════════════════════════════════
  function resolve(key) {
    var k = key, hops = 0, node;
    while (k != null) {
      node = SJ.Script[k];
      if (!node) {
        console.warn('[SJ.Story] 未知剧本 key：“' + k + '”，链条在此中止');
        return null;
      }
      if (!node.cond || node.cond(SJ.Save.data)) return k;
      k = node.next;
      hops++;
      if (hops > MAXHOPS) {
        console.warn('[SJ.Story] 链式跳转超过 ' + MAXHOPS + ' 步（起点 “' + key + '”），强制结束，防止死循环');
        return null;
      }
    }
    return null;
  }

  // ══ 逐字书写节奏 ════════════════════════════════════════════════
  // 把 lines（每条是竖排的一「列」）拆成字符累计时长表：
  // 基础每字 0.085–0.12s（随机但确定性），标点后多顿 0.14s，换列多顿 0.16s。
  // 「像人在写字」是节奏要求，不是慢的借口（Lead：第五回 c5_book 九屏连播
  // 翻页必须快）——brushReveal 仍是纯 p=0..1 的渲染器，这里只是把
  // p 的推进速度按字符而非线性时间来算。玩家永远可以按一下确认瞬间补完本屏，
  // 这张时间表只决定「不催的时候」自然写出的速度。
  function buildTiming(lines) {
    var cum = [], t = 0, ci, i, ch, base, prevCh, idx = 0, col;
    for (ci = 0; ci < lines.length; ci++) {
      col = lines[ci];
      for (i = 0; i < col.length; i++) {
        ch = col.charAt(i);
        base = 0.085 + SJ.hash(ci * 31.7 + i * 5.3 + 0.5) * 0.035;
        prevCh = (i > 0) ? col.charAt(i - 1) : (ci > 0 ? lines[ci - 1].slice(-1) : null);
        if (prevCh && PUNCT.indexOf(prevCh) >= 0) base += 0.14;
        if (i === 0 && ci > 0) base += 0.16;
        t += base;
        cum.push(t);
        idx++;
      }
    }
    return { total: idx, cum: cum, totalTime: t };
  }

  function timingToP(timing, elapsed) {
    if (!timing || timing.total <= 0) return 1;
    if (elapsed <= 0) return 0;
    if (elapsed >= timing.totalTime) return 1;
    var cum = timing.cum, n = cum.length, i = 0, prev, dur, frac;
    while (i < n && cum[i] <= elapsed) i++;
    prev = i > 0 ? cum[i - 1] : 0;
    dur = cum[i] - prev;
    frac = dur > 0 ? (elapsed - prev) / dur : 1;
    return SJ.clamp((i + frac) / timing.total, 0, 1);
  }

  // ══ 竖排文字块：所有 mode 共用 ══════════════════════════════════
  function textMetrics(lines, size) {
    var maxLen = 0, i;
    for (i = 0; i < lines.length; i++) if (lines[i].length > maxLen) maxLen = lines[i].length;
    return { maxLen: maxLen, lh: size * 1.14, height: maxLen * size * 1.14 };
  }

  // x：最右一列（第一行）的锚点 x。opts: {yTop, minY, maxY, weight, cw, hint:false}
  function drawTextBlock(g, lines, p, x, size, color, alpha, opts) {
    opts = opts || {};
    var m = textMetrics(lines, size);
    var minY = opts.minY != null ? opts.minY : 40;
    var maxY = opts.maxY != null ? opts.maxY : (SJ.H - 60);
    var cw = opts.cw || 1.34;
    var yTop = opts.yTop != null ? opts.yTop
      : SJ.clamp((SJ.H - m.height) / 2, minY, Math.max(minY, maxY));
    SJ.Ink.brushReveal(g, lines.join('\n'), x, yTop + size * 0.62, size, p, {
      color: color, alpha: alpha, weight: opts.weight || '500', cw: cw
    });
    // 写完之后的一枚呼吸墨点：不是按钮，只是「笔停在这」的暗示
    if (p >= 1 && opts.hint !== false) {
      var lastLen = lines[lines.length - 1].length;
      var hx = x - (lines.length - 1) * size * cw;
      var hy = yTop + lastLen * m.lh + size * 0.55;
      var breathe = 0.35 + 0.3 * (Math.sin(SJ.Game.time * 2.3) * 0.5 + 0.5);
      SJ.Ink.blob(g, hx, hy, size * 0.09, 77, { color: color, alpha: alpha * breathe, rough: 0.32 });
    }
  }

  function frameRect(g, x, y, w, h, alpha, seed) {
    SJ.Ink.stroke(g, [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], {
      w0: 1.6, w1: 1.2, color: SJ.C.ink, alpha: alpha, seed: seed || 31, hairs: 0, taper: false
    });
  }

  // ══ mode:'tea' —— 整屏茶馆插画（黑底纸色字，全剧唯一的「反色」场景，
  //    DESIGN §5：话本由说书人开口，视觉上必须与「纸色世界」明确切开） ══
  function drawTea(g, node, p) {
    var W = SJ.W, H = SJ.H, t = SJ.Game.time;
    g.save();
    g.fillStyle = SJ.C.ink;
    g.fillRect(0, 0, W, H);

    // 灯火余晕：唯一的暖色氛围，避免纯黑死板
    var amb = g.createRadialGradient(560, 190, 10, 560, 190, 480);
    amb.addColorStop(0, SJ.Ink.rgba(SJ.C.gamboge, 0.06));
    amb.addColorStop(1, SJ.Ink.rgba(SJ.C.gamboge, 0));
    g.fillStyle = amb; g.fillRect(0, 0, W, H);

    drawTeaWindow(g, 652, 64, 190, 168, t);
    SJ.Ink.lantern(g, 560, 152, 13, t);
    drawTeaDesk(g, 494, 336, 156);

    if (SJ.Figure && SJ.Figure.draw && SJ.Figure.pose) {
      var breatheP = (Math.sin(t * 0.55) + 1) / 2;
      SJ.Figure.draw(g, {
        x: 560, y: 378, facing: -1, scale: 1.05,
        pose: SJ.Figure.pose('sit', breatheP, t),
        color: SJ.C.inkLight, alpha: 0.88, lineScale: 1,
        weapon: null, cloth: 0.22, t: t
      });
    }

    // 地面暗示：一道极轻的渐亮
    var floor = g.createLinearGradient(0, H - 46, 0, H);
    floor.addColorStop(0, SJ.Ink.rgba(SJ.C.inkLight, 0));
    floor.addColorStop(1, SJ.Ink.rgba(SJ.C.inkLight, 0.11));
    g.fillStyle = floor; g.fillRect(0, H - 46, W, 46);

    var size = node.lines.length >= 4 ? 22 : 25;
    drawTextBlock(g, node.lines, p, 428, size, SJ.C.paper, 0.94, { minY: 44, maxY: H - 60 });
    g.restore();
  }

  function drawTeaWindow(g, x, y, w, h, t) {
    g.save();
    SJ.Ink.stroke(g, [[x, y], [x + w, y]], { w0: 2.2, w1: 1.6, color: SJ.C.paper, alpha: 0.38, seed: 1, hairs: 0 });
    SJ.Ink.stroke(g, [[x, y + h], [x + w, y + h]], { w0: 2.2, w1: 1.6, color: SJ.C.paper, alpha: 0.38, seed: 2, hairs: 0 });
    SJ.Ink.stroke(g, [[x, y], [x, y + h]], { w0: 2.2, w1: 1.6, color: SJ.C.paper, alpha: 0.38, seed: 3, hairs: 0 });
    SJ.Ink.stroke(g, [[x + w, y], [x + w, y + h]], { w0: 2.2, w1: 1.6, color: SJ.C.paper, alpha: 0.38, seed: 4, hairs: 0 });

    g.save();
    g.beginPath(); g.rect(x + 3, y + 3, w - 6, h - 6); g.clip();
    g.fillStyle = SJ.Ink.rgba(SJ.C.stone, 0.10); g.fillRect(x, y, w, h);
    var n = 16, i, k, k2, rx, ry, len;
    for (i = 0; i < n; i++) {
      k = SJ.hash(i * 3.7 + 1); k2 = SJ.hash(i * 7.1 + 4);
      rx = x + ((k * w * 1.3 + t * 66) % (w + 30)) - 15;
      ry = y + ((k2 * h * 1.4 + t * 250) % (h + 40)) - 20;
      len = 13 + k2 * 9;
      SJ.Ink.stroke(g, [[rx, ry], [rx - len * 0.28, ry + len]], {
        w0: 1.1, w1: 0.2, color: SJ.C.paper, alpha: 0.13 + k * 0.08, seed: i + 40, hairs: 0
      });
    }
    g.restore();

    var midx = x + w / 2, midy = y + h / 2;
    SJ.Ink.stroke(g, [[midx, y + 2], [midx, y + h - 2]], { w0: 1.3, w1: 1.0, color: SJ.C.paper, alpha: 0.28, seed: 5, hairs: 0 });
    SJ.Ink.stroke(g, [[x + 2, midy], [x + w - 2, midy]], { w0: 1.3, w1: 1.0, color: SJ.C.paper, alpha: 0.28, seed: 6, hairs: 0 });
    g.restore();
  }

  function drawTeaDesk(g, x, y, w) {
    SJ.Ink.stroke(g, [[x, y], [x + w, y]], { w0: 2.6, w1: 1.8, color: SJ.C.inkLight, alpha: 0.55, seed: 11, hairs: 0 });
    SJ.Ink.stroke(g, [[x + 10, y], [x + 3, y + 32]], { w0: 2.1, w1: 1.0, color: SJ.C.inkLight, alpha: 0.45, seed: 12, hairs: 0 });
    SJ.Ink.stroke(g, [[x + w - 10, y], [x + w - 3, y + 32]], { w0: 2.1, w1: 1.0, color: SJ.C.inkLight, alpha: 0.45, seed: 13, hairs: 0 });
    g.save();
    g.fillStyle = SJ.Ink.rgba(SJ.C.inkLight, 0.5);
    g.fillRect(x + w * 0.30, y - 7, 15, 6.5);
    g.restore();
    SJ.Ink.blob(g, x + w * 0.72, y - 5, 6.5, 21, { color: SJ.C.inkLight, alpha: 0.4, rough: 0.14 });
  }

  // ══ mode:'card' —— 章节卡（两行=题名版式）／单行=空白宣纸+印（决议 003） ══
  function drawCard(g, node, p) {
    SJ.Ink.paper(g, 0, 0);
    if (node.lines.length <= 1) { drawColophon(g, node, p); return; }
    var W = SJ.W, H = SJ.H;
    frameRect(g, 128, 82, W - 256, H - 164, 0.5, 31);
    frameRect(g, 140, 94, W - 280, H - 188, 0.26, 32);

    var title = node.lines[0], sub = node.lines[1];
    var sizeT = 58, sizeS = 30;
    var totalChars = title.length + sub.length;
    var pt = SJ.clamp(totalChars ? p * totalChars / title.length : 1, 0, 1);
    var ps = SJ.clamp(totalChars ? (p * totalChars - title.length) / sub.length : 1, 0, 1);

    var titleX = W / 2 + 44;
    var titleY = (H - title.length * sizeT * 1.14) / 2 + sizeT * 0.62;
    SJ.Ink.brushReveal(g, title, titleX, titleY, sizeT, pt, { color: SJ.C.ink, alpha: 0.92 });

    var subX = titleX - sizeT * 1.34 - 26;
    var subY = (H - sub.length * sizeS * 1.14) / 2 + sizeS * 0.62;
    SJ.Ink.brushReveal(g, sub, subX, subY, sizeS, ps, { color: SJ.C.inkLight, alpha: 0.85 });
  }

  // 单行 card：空白宣纸 + 落款式小字 + 朱砂印（印文读 node.seal）
  // 锚点按「印章底边必须留在 H 以内」反推（实测发现原来的 y=372 会让印顶到画布
  // 底边外 6px，截图对照才看出来）——的的确确不能只算不看。
  var COLOPHON_SEAL_SIZE = 54, COLOPHON_GAP = 14;
  function drawColophon(g, node, p) {
    var text = node.lines[0] || '';
    var size = 22, x = 792;
    var y = SJ.H - COLOPHON_SEAL_SIZE - COLOPHON_GAP - text.length * size * 1.14 - 40;
    SJ.Ink.brushReveal(g, text, x, y, size, p, { color: SJ.C.ink, alpha: 0.82 });
    if (node.seal) {
      var sealAlpha = SJ.clamp((p - 0.45) * 2, 0, 1);
      g.save();
      g.globalAlpha = sealAlpha;
      SJ.Ink.seal(g, x - 32, y + text.length * size * 1.14 + COLOPHON_GAP, COLOPHON_SEAL_SIZE, node.seal);
      g.restore();
    }
  }

  // ══ mode:'narration' / 'talk' —— 世界不替换，侧边纸色读字面板 ══════
  // 两者共用同一渲染：narration 永不带具名标签（无论 speaker 是 '' 还是
  // '说书人'——决议 003/004 的核心要求）；talk 带一个小小的朱砂名牌。
  //
  // 实测发现（截图对照，不是猜的）：关卡世界本身 90% 也是纸色（DESIGN §1），
  // 单纯叠一层同色的纸色 wash 在纸色背景上几乎看不见——面板「浮」不起来。
  // 改用 paperDark 提高辨识度，并在接缝处加一道极淡的焦墨阴影 + 一道细线，
  // 让这块面板在任何背景（纸色的白天场景、也包括更暗的雪山/藏经阁）上都读得出
  // 「这是叠在世界上方的一层」，而不是靠色相差异这一条腿走路。
  // T4 二次过：背景现在一关一景（scenery.js），面板后面可能压着竹林、书架、城墙，
  // 比原先的空纸吵得多。所以三处收紧：
  //   底色 0.74 → 0.82（面板要盖得住背景的笔触，不能透出竹竿来）
  //   字   0.88 → 0.92（对比度）
  //   列距 cw 1.34 → 1.55（竖排最挤的是列与列之间；实测最多 5 列 × 16 字，
  //        1.55 时最左一列到 x=787，面板左边在 620，放得下）
  function drawSidePanel(g, node, p, speakerName) {
    var W = SJ.W, H = SJ.H, panelW = 340, panelX = W - panelW;
    SJ.Ink.wash(g, panelX - 36, 0, 36, H, { color: SJ.C.ink, alpha: 0.12, dir: 'h', flip: true });
    SJ.Ink.wash(g, panelX, 0, panelW, H, { color: SJ.C.paperDark, alpha: 0.82, dir: 'h', flip: true });
    SJ.Ink.stroke(g, [[panelX + 1, 8], [panelX + 1, H - 8]], {
      w0: 1.1, w1: 0.8, color: SJ.C.ink, alpha: 0.16, seed: 8, hairs: 0, taper: false
    });
    var x = W - 42, size = 21;
    if (speakerName) {
      SJ.Ink.vtext(g, speakerName, x, 46, 16, { color: SJ.C.cinnabar, alpha: 0.85, seed: 2 });
      x -= 16 * 1.34 + 16;
    }
    drawTextBlock(g, node.lines, p, x, size, SJ.C.ink, 0.92, {
      minY: speakerName ? 96 : 50, maxY: H - 66, cw: 1.55
    });
  }

  // ══ 页码：长链才给 ══════════════════════════════════════════════
  // 第五回的藏经阁书页连着九屏（c5_book…c5_book_i），H 自报「九屏疲劳未测」。
  // 给一个「写到第几张」的位置感，玩家才知道还有多久 —— 但不写字：
  // 上面一个数、中间一道横、下面一个数，像书页角上的墨记（DESIGN §0 铁律 3：不做说明）。
  // 阈值 5 屏：两三屏的对白不需要页码，加了反而吵。
  var CN = '〇一二三四五六七八九';
  function cn(n) {
    n = n | 0;
    if (n < 10) return CN.charAt(n);
    if (n < 20) return '十' + (n % 10 ? CN.charAt(n % 10) : '');
    return CN.charAt((n / 10) | 0) + '十' + (n % 10 ? CN.charAt(n % 10) : '');
  }

  function drawPageMark(g, idx, total) {
    // 面板左侧那条空档：竖排文字最多 5 列、占到 x≈787，页码放在 710，
    // 既压在面板底色够厚的地方，又不会和最左一列打架。
    var x = SJ.W - 250, y = SJ.H - 116, sz = 14, col = SJ.C.cinnabar;
    SJ.Ink.vtext(g, cn(idx), x, y, sz, { color: col, alpha: 0.66, seed: 3 });
    SJ.Ink.stroke(g, [[x - sz * 0.46, y + sz * 1.00], [x + sz * 0.46, y + sz * 1.00]], {
      w0: 1.4, w1: 1.0, color: col, alpha: 0.42, taper: false, hairs: 0, core: false, seed: 4
    });
    SJ.Ink.vtext(g, cn(total), x, y + sz * 2.0, sz, { color: col, alpha: 0.44, seed: 5 });
  }

  // 进链时把这条链实际会显示的 key 走一遍（cond 已由 resolve 处理）。
  // 只用来算页码，不参与播放；播放仍然是一步一 resolve。
  function chainKeys(entry) {
    var keys = [], k = resolve(entry), hops = 0, node;
    while (k != null && hops < MAXHOPS) {
      keys.push(k);
      node = SJ.Script[k];
      k = resolve(node ? node.next : null);
      hops++;
    }
    return keys;
  }

  function drawNarration(g, node, p) { drawSidePanel(g, node, p, null); }
  function drawTalk(g, node, p) { drawSidePanel(g, node, p, node.speaker || null); }

  function drawActiveNode(g, node, p) {
    if (!node) return;
    if (node.mode === 'tea') drawTea(g, node, p);
    else if (node.mode === 'card') drawCard(g, node, p);
    else if (node.mode === 'talk') drawTalk(g, node, p);
    else drawNarration(g, node, p); // 'narration' 与任何未知 mode 的兜底
  }

  // ══ 播放引擎：play() 与 ending() 共用的链式播放器 ══════════════════
  var chain = null; // {onDone, onShow, key, revealStart, timing, lastMode, keys}
  var PAGEMARK_MIN = 5;   // 少于这么多屏就不标页码

  function showKey(key) {
    if (key == null) { finishChain(); return; }
    var node = SJ.Script[key];
    if (!node) { console.warn('[SJ.Story] key 不存在：“' + key + '”'); finishChain(); return; }
    var enteringTea = node.mode === 'tea' && chain.lastMode !== 'tea';
    chain.lastMode = node.mode;
    chain.key = key;
    chain.revealStart = SJ.Game.time;
    chain.timing = buildTiming(node.lines);
    if (enteringTea && SJ.Audio && SJ.Audio.sfx) SJ.Audio.sfx('woodclap');
    if (chain.onShow) chain.onShow(key, node);
  }

  function finishChain() {
    var done = chain ? chain.onDone : null;
    SJ.Game.pop();     // 先弹出，再回调——回调里常会 push/setScene 新内容
    chain = null;
    if (done) done();
  }

  function advanceChain() {
    var node = SJ.Script[chain.key];
    showKey(resolve(node ? node.next : null));
  }

  var chainScene = {
    enter: function (data) {
      chain = {
        onDone: data.onDone || function () {}, onShow: data.onShow || null,
        key: null, revealStart: 0, timing: null, lastMode: null,
        keys: chainKeys(data.entry)
      };
      showKey(resolve(data.entry));
    },
    update: function () {
      // 防呆（Lead 补）：这一层没有节点可显示时，绝不能静静地留在栈顶——
      // 它不画东西又吞掉全部输入，玩家看到的就是「画面静止、没有字、走不了」。
      // 宁可立刻收场，也不要制造一个无声的死局。
      if (!chain) { SJ.Game.pop(); return; }
      var node = SJ.Script[chain.key];
      if (!node) { finishChain(); return; }
      var p = timingToP(chain.timing, SJ.Game.time - chain.revealStart);
      if (SJ.Input.pressed('confirm')) {
        if (p < 1) chain.revealStart = SJ.Game.time - chain.timing.totalTime; // 一键补完这一屏
        else advanceChain();
      }
    },
    draw: function (g) {
      if (!chain) return;
      var node = SJ.Script[chain.key];
      if (!node) return;   // 这一帧无内容可画；update 已负责收场
      drawActiveNode(g, node, timingToP(chain.timing, SJ.Game.time - chain.revealStart));
      // ★ Lead 收窄：页码**只给 narration**（c5_book 那种「读书页」的旁白）。
      // talk 是对白、tea 是整屏说书、card 是章节卡 —— 那些是戏，不该让玩家数还剩几页。
      // 链里的 key 找不到（cond 中途变了）就不画。
      if (node.mode === 'narration' && chain.keys.length >= PAGEMARK_MIN) {
        var at = chain.keys.indexOf(chain.key);
        if (at >= 0) drawPageMark(g, at + 1, chain.keys.length);
      }
    },
    exit: function () {}
  };

  function runChain(entryKey, onShow, onDone) {
    SJ.Game.push(chainScene, { entry: entryKey, onShow: onShow, onDone: onDone });
  }

  // ══ chapterCard：脱离剧本数据的独立章节卡（供 G 在无需对白时直接调） ══
  var cardState = null;
  var cardScene = {
    enter: function (data) {
      cardState = {
        node: { mode: 'card', lines: [data.title, data.subtitle], speaker: '' },
        revealStart: SJ.Game.time,
        timing: buildTiming([data.title, data.subtitle]),
        cb: data.cb
      };
    },
    update: function () {
      if (!cardState) return;
      var p = timingToP(cardState.timing, SJ.Game.time - cardState.revealStart);
      if (SJ.Input.pressed('confirm')) {
        if (p < 1) { cardState.revealStart = SJ.Game.time - cardState.timing.totalTime; return; }
        var cb = cardState.cb;
        SJ.Game.pop();
        cardState = null;
        cb();
      }
    },
    draw: function (g) {
      if (!cardState) return;
      drawCard(g, cardState.node, timingToP(cardState.timing, SJ.Game.time - cardState.revealStart));
    },
    exit: function () {}
  };

  // ══ mercyChoice：无字生杀抉择（DESIGN §3.3，全剧唯一 mercy 写入点） ══
  // 意象：朱砂「剑落」= 攻击键；淡墨「脚印」= 任意移动/身法键；
  // 3 秒完全不动 = 留手。前 0.6s 锁输入，防止玩家从 boss_down 对白
  // 一路按空格/J punch 到这里，被误判成「杀」。
  var MC_LOCKOUT = 0.6, MC_TIMEOUT = 3.0, MC_BEAT = 0.9;
  var mc = null;

  function mcDecide(killed) {
    mc.resolved = true;
    mc.killed = killed;
    mc.resolveT = 0;
    SJ.Save.data.mercy[mc.bossId] = !killed;   // !! 唯一写入者 !! 决议 002
    SJ.Save.save();
    if (SJ.Audio && SJ.Audio.sfx) SJ.Audio.sfx(killed ? 'hitHeavy' : 'sheathe');
    if (killed && SJ.Game.flash) SJ.Game.flash(SJ.C.cinnabar, 0.16, 0.55);
  }

  var mercyScene = {
    enter: function (data) {
      mc = { bossId: data.bossId, cb: data.cb, t0: SJ.Game.time, resolved: false, killed: false, resolveT: 0 };
    },
    update: function (dt) {
      if (!mc) return;
      if (mc.resolved) {
        mc.resolveT += dt;
        if (mc.resolveT >= MC_BEAT) {
          var cb = mc.cb, killed = mc.killed;
          SJ.Game.pop();          // 先弹出，cb 里 G 马上会 Level.complete()（决议 003 时序）
          mc = null;
          cb(killed);
        }
        return;
      }
      var el = SJ.Game.time - mc.t0;
      if (el < MC_LOCKOUT) return;
      if (SJ.Input.pressed('attack')) { mcDecide(true); return; }
      if (SJ.Input.pressed('left') || SJ.Input.pressed('right') ||
          SJ.Input.pressed('dash') || SJ.Input.pressed('down')) { mcDecide(false); return; }
      if (el >= MC_TIMEOUT) { mcDecide(false); return; }
    },
    draw: function (g) { if (mc) drawMercyImagery(g, SJ.Game.time - mc.t0); },
    exit: function () {}
  };

  function drawMercyImagery(g, el) {
    var W = SJ.W, H = SJ.H;
    var tension = SJ.clamp((el - MC_LOCKOUT) / (MC_TIMEOUT - MC_LOCKOUT), 0, 1);

    g.save();
    var vg = g.createRadialGradient(W / 2, H * 0.55, H * 0.25, W / 2, H * 0.55, H * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, SJ.Ink.rgba(SJ.C.ink, 0.04 + tension * 0.12));
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    g.restore();

    var cy = H * 0.66, killX = W / 2 - 150, leaveX = W / 2 + 150;
    var burst = mc.resolved ? SJ.clamp(mc.resolveT / MC_BEAT, 0, 1) : 0;

    // 剑落——朱砂，脉动随张力加快；决出胜负后炸开一团墨，随即淡去
    if (!mc.resolved || mc.killed) {
      var pulseRate = 2.0 + tension * 3.2;
      var pulse = 0.55 + 0.35 * (Math.sin(el * pulseRate) * 0.5 + 0.5);
      var killAlpha = mc.resolved ? (1 - burst) : pulse;
      g.save();
      SJ.Ink.stroke(g, [[killX, cy - 46], [killX, cy + 18]], {
        w0: 5, w1: 1.2, color: SJ.C.cinnabar, alpha: killAlpha, seed: 5, hairs: 2
      });
      SJ.Ink.blob(g, killX, cy - 50, 4, 8, { color: SJ.C.cinnabar, alpha: killAlpha * 0.9, rough: 0.3 });
      if (!mc.resolved) {
        var dropPhase = (el * 0.7) % 1;
        SJ.Ink.blob(g, killX, cy + 18 + dropPhase * 30, 2.6 * (1 - dropPhase * 0.4), 9, {
          color: SJ.C.cinnabar, alpha: (1 - dropPhase) * 0.85, rough: 0.2
        });
      } else if (mc.killed) {
        // 剑落下那一摊：去对称（Lead 批准在这里开）。剑是从上往下的，
        // 所以墨往下方一侧收拢，不是四面均匀散开的蜘蛛腿。
        SJ.Ink.splat(g, killX, cy + 18, 15 * SJ.clamp(mc.resolveT * 3, 0, 1), 13, {
          color: SJ.C.cinnabar, alpha: (1 - burst) * 0.9, n: 5,
          aniso: 0.62, dir: Math.PI * 0.5
        });
      }
      g.restore();
    }

    // 走开——淡墨脚印，向外散开变淡；留手后静静淡出
    if (!mc.resolved || !mc.killed) {
      var leaveAlpha = mc.resolved ? (1 - burst) : 1;
      for (var i = 0; i < 4; i++) {
        var fx = leaveX + i * 26, fy = cy + (i % 2 === 0 ? -6 : 8);
        var fa = leaveAlpha * (0.5 - i * 0.10);
        if (fa > 0) SJ.Ink.blob(g, fx, fy, 6 - i * 0.7, 40 + i, {
          color: SJ.C.inkLight, alpha: fa, rough: 0.35, squash: 0.55
        });
      }
    }
  }

  // ══ 对外接口 ═══════════════════════════════════════════════════
  SJ.Story = {

    // 播放一条剧本链，直到 next:null，然后 onDone()。
    play: function (key, onDone) {
      runChain(key, null, onDone || function () {});
    },

    flag: function (k, v) {
      SJ.Save.data.flags[k] = v;
      SJ.Save.save();
      return v;
    },
    get: function (k) {
      return SJ.Save.data.flags[k];
    },

    // 不走剧本数据的独立章节卡（G 用于无需对白的重复进入场景）
    chapterCard: function (title, subtitle, cb) {
      SJ.Game.push(cardScene, { title: title, subtitle: subtitle, cb: cb || function () {} });
    },

    // 分支已经在 script.js 内部用 cond 解决；这里只需要知道
    // 「实际显示的第一个分支专属 key」长什么样，取前缀当 kind。
    ending: function () {
      var kind = 'mid';
      var re = /^f_end_(all|kill|mercy|mid)/;
      runChain('f_end', function (key) {
        var m = re.exec(key);
        if (m) kind = m[1];
      }, function () {
        SJ.Menu.ending(kind);
      });
    },

    mercyChoice: function (bossId, cb) {
      SJ.Game.push(mercyScene, { bossId: bossId, cb: cb || function () {} });
    }
  };

})(window.SJ = window.SJ || {});
