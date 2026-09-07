# H（UI 与剧情演出）实现笔记

负责文件：`src/story/story.js`、`src/ui/hud.js`、`src/ui/menus.js`、`dev/ui.html`。
全部纯 classic script，只依赖已交付的 `core/*`、`render/ink.js`、`audio/audio.js`、`data/script.js`。

---

## 1. `SJ.Story` 播放引擎

### 1.1 cond 链式跳过（决议 002/003，硬约束）

```js
function resolve(key) {           // 从 key 开始往前走，返回第一个 cond 为真的 key，或 null
  var k = key, hops = 0, node;
  while (k != null) {
    node = SJ.Script[k];
    if (!node) { console.warn(...); return null; }
    if (!node.cond || node.cond(SJ.Save.data)) return k;
    k = node.next;
    hops++;
    if (hops > 200) { console.warn(...); return null; }   // 防死循环
  }
  return null;
}
```

`resolve()` 在两处调用：`play()`/`ending()` 的入口，以及每次 `advance` 时对 `next` 再解一次。
这就是契约要求的「进入时与每次 advance 时都求值」——因为「进入」本身就是对 `data.entry`
调一次 `resolve`，逻辑和 advance 完全复用同一函数，不会出现两套判断漂移的问题。

200 步上限：命中就 `console.warn` 并把这条链当作「没有可显示的屏」处理，直接收场
（`finishChain()`），不会吞掉输入卡死游戏。D 保证的「入口无 cond、变体互斥穷尽」下这个
上限永远不会触发；它纯粹是防御 D 数据万一出错时的兜底，不是常规路径。

### 1.2 逐字书写节奏（不是打字机，也不能拖成一堵墙）

`buildTiming(lines)` 把每屏文字拆成「每个字的时长」累计表：基础每字 0.085–0.12s（用
`SJ.hash` 保证确定性，不会每次重播都不一样），标点后额外顿 0.14s，换列额外顿 0.16s。
`timingToP(timing, elapsed)` 把「已经过去的秒数」换算成 `brushReveal` 要的 `p=0..1`。

**这套时间表只决定「不催的时候」的自然书写速度**——真正决定节奏的是下面这条：

> 按确认键：本屏没写完 → 立刻补完（把 `revealStart` 前移到 `now - totalTime`）；
> 本屏已经写完 → 进下一屏。**绝不自动前进。**

这是 Lead 转达 D 对 `c5_book` 九屏的明确要求（决议 010 §3）：「翻页快、逐屏可跳，但不
自动前进——节奏必须由玩家掌握」。我的实现从一开始就是这个形状（不是后补的），所以
这条要求不需要额外改动；只把 §1.2 的基础字速从 0.125–0.195s 调快到 0.085–0.12s，
是 Lead 那条「逐字写出的速度本身要够快」的直接回应。

粗算：全剧 4100 字 / 188 屏 ≈ 22 字/屏，按新速度约 2–3 秒自然写完，落在 G 的
3.4 秒/屏预算内，还留出玩家反应/决定何时按下一步的余量。`c5_t_page`（题眼四屏「需要
落地，别催」）与 `c4_mid`（第一回矛盾，最重要的两屏之一）不受这条「快」影响——它们
慢不下来的原因不是我加了延迟，而是玩家自己选择在写完之后停留多久都不会被打断
（没有超时、没有自动前进），停顿感天然来自「我选择不按」。

### 1.3 渲染按 `mode` 分派，`speaker` 只影响是否显示名牌（决议 003/004 核心）

```
mode:'tea'        → drawTea       整屏茶馆插画（唯一会替换背景的模式）
mode:'card'       → drawCard      两行=题名版式；单行=空白宣纸+落款+印
mode:'talk'       → drawSidePanel(..., node.speaker)   世界不替换，带朱砂名牌
mode:'narration'  → drawSidePanel(..., null)           世界不替换，永不带名牌
未知 mode         → 兜底按 narration 处理
```

**`narration` 永远不看 `speaker` 字段。** `c4_mid` 和 `c5_t_page` 的 `speaker` 都是
`'说书人'`（前者）或 `''`（后者），但两者渲染完全一样——都是关卡内半透明纸色侧栏，
世界背景照常可见，没有任何具名标签。这是有意的设计选择：如果按 `speaker==='说书人'`
特判加个名牌，反而会让这两屏读起来像「说书人在插一句解说」，破坏「无名自己在读/亲历」
的第一人称效果。这条我在 dev/ui.html 里没法用眼睛「验证」出来（两种渲染本来就该长得
一样），但用脚本直接查了 `script.js` 的数据：`c4_mid*` 与 `c5_t_page*` 全部
`mode:'narration'`（见下方自检片段），逻辑上不可能被误判成别的分支——这比截一张图
更可靠，因为它覆盖的是「所有会走到这条分支的 key」，不只是我截图时选中的那一个。

```
c4_mid / c4_mid_a / c4_mid_b / c4_mid_end       → narration, speaker='说书人'
c5_t_page / _a / _b / _end                      → narration, speaker=''
c5_book ~ c5_book_i（9 屏，_b 除外）              → narration（_b 是 talk，单行）
```

### 1.4 `chapterCard(title, subtitle, cb)`

不经过 `SJ.Script`，直接拿两个字符串走同一套 `drawCard` 渲染与逐字节奏。设计意图：
G 在重复进入同一章节（比如死亡重生、或「继」直接从章节开头进）时，不需要重播整段
说书人对白，只要一个简短的章节卡过渡。**这是我的假设，没有和 G 对齐调用时机**——
如果 G 觉得每次都走完整的 `cN_intro` 链更好，这个函数可以先不用，不影响其他部分。

### 1.5 `mercyChoice(bossId, cb)`——无字生杀抉择

意象（DESIGN §3.3「不要写字、不要做按钮」）：

- 左侧朱砂「剑落」：一道悬空的朱砂笔画 + 一滴缓慢下坠的墨，脉动随时间加快。
- 右侧淡墨「脚印」：四个渐远渐淡的墨团，暗示「走开」这条路径本来就在那里。
- 3 秒不动 = 走开；按攻击键 = 落剑；按任意移动/身法键 = 主动走开（不用等满 3 秒）。

**输入锁定 0.6 秒**（`MC_LOCKOUT`）：玩家从 `cN_boss_down` 对白一路按 Space/J 推进
到这里时，`confirm` 键与 `attack` 键都映射在 J 上，如果不锁，惯性按键会被误判成
「杀」。锁定期间只画意象、不读输入；3 秒计时从场景开始就走（不是锁定结束后才开始），
所以「3 秒不动」的总时长不会因为加了锁定而变长。

**写入时序（决议 002/003，全剧最不能出错的一处）**：

```
玩家决定的那一刻（mcDecide）：
  1. SJ.Save.data.mercy[bossId] = !killed     ← 唯一写入者，这里，一行代码
  2. SJ.Save.save()
  3. 播放收尾意象 0.9 秒（MC_BEAT）
  4. SJ.Game.pop()                             ← 先弹出场景
  5. cb(killed)                                ← 再回调
```

**第 4/5 步的顺序不能反**（这条是 advisor 复核时指出的，我最初写反了）：`cb` 里 G 会
立刻调 `SJ.Level.complete()`，而 `complete()` 会 `SJ.Story.play(cN_outro, ...)`（push）
或直接切关（`setScene`，清空整个栈）。如果先 `cb` 后 `pop`，`pop()` 会把 G 刚 push
进来的新内容弹掉，或者在 `setScene` 已经清空栈之后再 `pop` 一个空栈——两种情况都会
炸。`SJ.Story.play()` 的 `finishChain()` 与 `chapterCard` 的确认回调都遵守同一条
「先 pop 再回调」的顺序，全文件统一。

---

## 2. `SJ.HUD`

- **血**：朱砂圆点，每颗 20 点，正在掉的那一颗用 `alpha = 剩余/20` 做过渡，不是整颗跳变。
- **墨**：一个墨滴形状（贝塞尔画出的水滴轮廓），液面按 `ink/100` 从底部往上填，裁剪在
  滴形内——这是「墨滴读数」而不是进度条的字面实现。
- **残墨环**：只在 `SJ.Tech.progress` 里有条目处于 `0 < v < 100` 时出现（同时只应该有
  一个在推进，多个时取第一个），细环 + 招名首字。
- **招式槽**：四个淡墨方框，槽里有招显示招名首字；`SJ.Tech.can(p,id)` 为假时整格压暗
  （表达冷却/墨不够，不用数字）。
- **卡住提示**（Lead 直接加在 hud.js 里，决议 008 §3）：朝障碍推了 3.5 秀不动，头顶
  浮一道朱砂上扬笔锋，无字无框，一动就消失——我保留了这处改动，没有动它。

`SJ.Tech.defs` 的形状契约写的是 object，但 `dev/check.html` 自己也留了「万一是数组」
的兜底判断（`if (d.length) for...`）——`hud.js`/`menus.js` 的 `techLookup` 跟随同一个
已被 Lead 认可的宽容读法，不是我自己发明的兜底。

---

## 3. `SJ.Menu`

### 3.1 标题：始／继／音（决议 007 §3）

- **始**：无存档时按一次直接 `SJ.Save.reset()` + `SJ.Level.load(0)`；**有存档时需要
  二次确认**——第一次按确认只把状态置为 `armed`（字变朱砂、旁边一枚心跳更快的墨点），
  2.5 秒内再按一次才真的执行；切到别的项或超时会自动解除 `armed`。全程没有加字、没有
  弹窗，标题画面依然只有三项。
- **继**：`SJ.Level.load(SJ.Save.data.chapter)`。无存档时这一项变暗（alpha 0.22）且
  左右切换会跳过它，但**仍然绘制**——三项结构是硬性要求，不能因为没存档就少一项。
- **音**：`SJ.Audio.setMute`，选中时会在字上画一道斜线表示静音。
- `titleScene.countsPlaytime = false`（决议 006）。
- `SJ.Audio.init()` 的解锁：不是在 `enter()` 里直接调用（那时还没有真实用户手势），
  而是挂一次性的原生 `keydown`/`mousedown` 监听器，第一次真实按键/点击时才调用并立刻
  摘除监听器——这样才符合浏览器的 autoplay 策略。

### 3.2 暂停：继续／换招／音／出

Esc 打开（G 在关卡里检测 `pressed('pause')` 后调 `SJ.Menu.pause()`），本层再按 Esc
直接 `pop()` 关闭。四个词都是动作名词，不是按键说明。`countsPlaytime = false`。

### 3.3 换招（决议 007 §1，这条我最初猜错了方向）

我最初的假设是「`SJ.Menu.slots()` 直接读写 `SJ.Save.data.slots`，指望 `p.slots`
与它同一个数组引用」。Lead 否掉了这个假设：`SJ.Save.load()` 会整体替换 `SJ.Save.data`
对象，引用会在读档后**静默断开**——换招在本局有效，重开游戏复原，且不报错，是这个
项目一直在防的那类「不崩溃但悄悄不对」的坑。

现在的实现：

```js
SJ.Player.setSlot(slotsCur, cand);   // 唯一写入者，E 实现
```

可选招式读 `SJ.player.known`，当前槽内容读 `SJ.player.slots`——都不碰
`SJ.Save.data` 本身。左右切槽位，上下在「空 + 已学招式（跳过已被别的槽占用的）」之间
循环，Esc/确认退出。`countsPlaytime = false`。

### 3.4 死亡（决议 007 §2）

无字，一枚渐亮渐暗的墨点邀人按确认。确认后调 `SJ.Level.restartFromCheckpoint()`——
不知道也不需要知道检查点怎么编码，G 的内部事。

### 3.5 结局

`SJ.Story.ending()` 内部用同一条 `resolve()` 链跑 `f_end`，**不自己判 mercy/known
分支**：只是在链推进过程中记录「第一个匹配 `f_end_(all|kill|mercy|mid)` 前缀的 key」
当作 `kind`，链播完后调 `SJ.Menu.ending(kind)`。这样 kind 永远和 D 数据里真正显示的
分支一致，不存在「H 自己算了一遍，算错了」的可能。

`SJ.Menu.ending('all')` 按 `SJ.Save.data.known` 的顺序（即学会顺序）列出每招的名字
和 `from`（「谁的影子」），其余三支只留一句静场氛围 + `SJ.Save.data.playtimeSec`
（格式化成「x 时 y 分」）。`countsPlaytime = false`。

---

## 4. `playtimeSec`（决议 006）与 `countsPlaytime`

`SJ.Game` 是唯一写入者，每帧 `+= rawDt`，条件是 `scene.countsPlaytime !== false`。
我这边只需要在四个「菜单/结算」性质的 scene 上显式设 `countsPlaytime: false`：
标题、暂停、换招、结算。**`story.js` 的三个 scene（对话链 / 章节卡 / 生杀抉择）完全
不设这个字段**，因为它们发生在实际游玩过程中，理应计入游玩时间——这是 Lead 第二条
消息里特别提醒的，我照办，没有画蛇添足地给对话层也设 false。

---

## 5. G 该怎么调用我（完整时序）

```
关卡开场：
  SJ.Story.play('cN_intro', function () {
    // 链播完（含 cN_card）后触发；这里 G 才真正 SJ.Level.load(...) 进入可玩关卡
  });

Boss 倒地未死：
  SJ.Story.play('cN_boss_down', function () {
    SJ.Story.mercyChoice(bossId, function (killed) {
      // 这里 SJ.Save.data.mercy[bossId] 已经写好、已经 save() 过了
      SJ.Level.complete();   // 内部顺序是「播 outro → 存档」，outro 读到的就是本回的新值
    });
  });

关卡内一次性旁白（trigger）：
  SJ.Story.play('c1_t_ink');   // 不用管 onDone，默认 no-op

暂停：
  Input.pressed('pause') → SJ.Menu.pause()

死亡：
  hp 归零 → SJ.Menu.gameover()   // 确认后自己调 SJ.Level.restartFromCheckpoint()

终局：
  SJ.Story.ending()   // 内部自己播 f_end 链、自己判 kind、自己调 SJ.Menu.ending(kind)
```

**唯一的硬约束**：`SJ.Level.complete()` 必须在 `mercyChoice` 的 `cb` 里调用，且
`cb` 触发时 `mercy[bossId]` 已经是最新值——这是我这边保证的，G 不需要再自己写
`save.mercy` 的任何一行。

---

## 6. `dev/ui.html`——演出预览台

单文件工具，加载真实的 `const/input/camera/world/ent/save/game/ink/audio/script`，
真实的 `render/figure.js`（F 交付后已接入，见下方 §7），再加载我自己的
`story/hud/menus`。`fx.js`／`tech.js`／`player.js`／`level.js` 这几个我暂时没接（`fx.js`
是纯粒子系统、我的场景不产生粒子，`tech/player/level` 的真实实现依赖一整套关卡/战斗
运行时，接进一个「单独播一屏」的预览台成本远高于收益），页面里仍有几处**只存在于这个
dev 文件、绝不写进 src/** 的占位实现：

- `SJ.Tech.defs/progress/can`：按 DESIGN §6 抄一份真实的 12 招名字/来源，可用性由
  一个假的 `Tech.can` 模拟。
- `SJ.player` / `SJ.Player.setSlot`：一个可以从面板滑杆/下拉直接改的假玩家对象。
- `SJ.Level.load / restartFromCheckpoint / bossDefeated`：只打日志，不做真实跳转；
  `bossDefeated` 会真的调 `SJ.Story.mercyChoice` 方便单独测这条链路。

`<script src>` 都带了 `?v=N` 查询参数（当前 4）——本机 `python -m http.server` 不发
`Cache-Control`，编辑完文件后同一个 URL 重新 `navigate` 有时会读到浏览器缓存的旧版本，
每次改完这几个文件想验证效果，把这个数字加一即可强制拿新的。

功能：任选一个剧本 key 播放（下拉框，逐个 key 都能单独触发，不用真的走关卡）、六个
Boss 的 mercy 复选框 + known 数滑杆（实时改 `SJ.Save.data`，能立刻看 cond 分支切换）、
四个结局的一键预设按钮、mercyChoice 单独触发、HUD 各项滑杆（血/墨/学习进度/四槽内容）、
标题/暂停/换招/死亡菜单的直接入口，右侧有一个可折叠日志栏记录所有回调触发（`onDone`、
`mercyChoice` 的 `cb(killed)` 参数、`Level.load` 的假调用等），用来确认时序对不对，
不用靠肉眼猜。

页面右侧有个可折叠控制面板（会挡住画面右侧 340px，正好是 narration/talk 面板所在的
区域），另加了一个纯截图用的「缩小画布」开关（`body.qa` + `transform:scale(0.42)`，
只在 dev 页面生效，不影响 `SJ.Game` 的内部坐标）。

---

## 7. 截图迭代记录 + 诚实的自我评价

**逻辑层面，我有把握**：cond 链式跳过、mercy 单一写入时序（写入→演出→pop→cb）、
narration 的「speaker 不影响渲染」规则，这三条硬约束我都是直接读代码/读数据核对过的，
不是「应该没问题」的猜测——`c4_mid`/`c5_t_page` 全部 `narration`，chapterCard/
mercyChoice/ending 的 pop-before-callback 顺序在这份文件里能直接读到，跑
`node --check` 全部通过。

**视觉层面**：中途遇到过一段 Chrome 扩展的截图通道（`screenshot`/`zoom`/
`javascript_tool`）持续报「找不到目标页」的时间（换标签页/标签组/端口都没用），
一度以为这次交不出真实截图，在汇报里如实说了这个缺口。后来工具恢复，
**把这一步真正补上了**，而且过程中揪出了两个不看图绝对发现不了的真 bug：

1. **narration/talk 侧栏面板在纸色世界背景上几乎隐形。** 我最初用同色系的
   `SJ.C.paper` 做面板底色，心算时没意识到——DESIGN §1 定死「世界 90% 也是纸色」，
   同色纸上叠同色纸，肉眼几乎看不出多了一层。截 `c4_mid` 的图时背景一片空白，
   一开始以为是渲染没跑（用 hook 确认 `SJ.Ink.wash`/`brushReveal` 确实被调用了，
   排除了逻辑 bug），最后才意识到是「颜色选错了，不是没画」。
   **改法**：面板底色换成 `paperDark`，接缝处加一道极淡的焦墨阴影 + 一道细线，
   让面板不再只靠色相差异这一条腿站住，纸色世界和暗色场景（雪山/藏经阁）上都能
   看出「这是叠在世界上方的一层」。改完截图复核，`c4_mid`（关卡内画外音，决议 003
   的核心场景）和 `p_chake`（talk，带朱砂名牌）都验证过，能读出正确的面板层次与
   正确的竖排右起阅读顺序。
2. **单行 card 的落款印章会溢出画布底边。** `f_end_all_e`（集大成结局最后一屏，
   带 `seal` 字段）原来的锚点是手算的 `y=372`，没考虑印章尺寸后底边落在 546px，
   而画布逻辑高度只有 540——印章被裁掉 6px。改成按「印章底边必须留在画布内」反推
   锚点（`SJ.H - 印章尺寸 - 间距 - 文字高度 - 留白`），截图复核确认现在印章完整、
   下方还留了舒服的余白。

**已用真实模块截图核对过的场景**（`dev/ui.html` 现已接入 F 交付的真实
`src/render/figure.js`，不再是我的占位剪影）：

| 场景 | 结果 |
|---|---|
| `mode:'tea'`（`p_intro`，含真实 `SJ.Figure.draw('sit')`） | 黑底纸色字 + 窗/雨丝 + 灯 + 案 + 说书人剪影，构图协调，文字竖排右起顺序正确 |
| `mode:'narration'`（`c4_mid`，决议 003 最关键的两屏之一） | 侧栏面板正确浮现，不切茶馆，`speaker` 不影响渲染 |
| `mode:'talk'`（`p_chake`，带「茶博士」朱砂名牌） | 名牌 + 正文层次清楚，与 narration 视觉上可区分 |
| `mode:'card'` 两行版式（`c1_card`「第一回·竹林听雨」） | 双线手绘边框 + 大字标题 + 小字副标题，构图舒服 |
| `mode:'card'` 单行+印（`f_end_all_e`「不说了。」+ 无名印） | 空白宣纸为主，落款+印在右下角，印章完整不溢出（已修） |
| `mercyChoice`（无字生杀抉择） | 朱砂「剑落」与淡墨「脚印」两个意象清楚可辨，无任何文字/按钮 |
| 标题（含「始」二次确认的心跳态） | 「说剑」大字 + 始/继/音三项，armed 状态有可辨识但克制的视觉变化 |
| 暂停 / 换招 / 结算（集大成 12 招画廊） | 四词菜单、四槽换招、按学会顺序列「谁的影子」+ 时长，均按预期渲染 |

**仍未逐帧调过的细节**（老实说，不是没做，是没到「来回微调到满意」那一步）：
文字列间距（`cw`）、`c5_book` 九屏连播的真实观感（我只验证了机制——首按补完/
再按前进/绝不自动前进——没有真的连播 9 屏看疲劳度）、mercyChoice 意象在真实
Boss 倒地场景（而非我这个空场景）上与角色残影会不会打架。这些数字都是命名
常量摆在函数顶部，改起来是分钟级的，欢迎 Lead 或其他人在真实关卡里过一遍后
继续调。
