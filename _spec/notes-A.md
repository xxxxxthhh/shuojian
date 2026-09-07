# notes-A —— 地基（core / index / 启动器）

对应文件：`index.html` `src/main.js` `src/core/*.js` `dev/check.html` `dev/sandbox.html` `开始游戏.command`

---

## 1. 与契约的出入

**共两处，都已报 Lead：**

**(1) 契约本身的疏漏 —— index.html 加载顺序漏了 `src/core/game.js`**

> CONTRACTS.md 末尾给的顺序是 `const → input → camera → world → ent → save → ink → …`，
> 没有 game.js。照抄会得到一个没有主循环的游戏。
> 我把它补在 `save.js` 之后（它只在**调用时**才用到 `SJ.Input/Camera/FX`，加载期无依赖）。
> **请 Lead 修正 CONTRACTS.md，免得有人照着它重新生成 index.html。**

**(2) 我在 `Game.render` 里对 `SJ.FX` 写了一处存在性判断**

> ```js
> if (SJ.FX && SJ.FX.drawScreen) SJ.FX.drawScreen(g);
> ```
> 契约说「不要写 fallback」。这里破例的理由：`dev/sandbox.html` 是**手感验收台，
> 要求不依赖别人的文件**，而 `Game` 是它必须加载的模块。没有这个判断，
> 沙盒与 `index.html` 在 fx.js 落地之前都会每帧抛异常。
> **这是全部 core 里唯一一处跨模块兜底**，其余一律按契约「假设它存在」直接调。
> fx.js 落地后这行判断即成为常真，不影响正式行为。

**(3) 契约之外我加的东西（都是附加，不改任何既有签名）**

`Game.stack` / `Game.timeScale()` / `Game._step()` / `Game._render()`（自检与工具用）、
`Game.scale`、`Game.canvas`、`Game.g`、`Input.actions`、`Camera.look`、`Camera.bx0/bx1/by0/by1`。
契约里点名的签名 100% 按原样实现，没有增删参数、没有改名。

---

## 2. 契约里有歧义、由我定死的语义

| 位置 | 决定 |
|---|---|
| `Game.fade(kind, sec, cb)` | `'out'`=罩上黑幕；`'in'`=从当前幕色淡出到透明；其他字符串当颜色用（`'paper'` 映射到纸色）。幕布 alpha 是**持久**的，`fade('out')` 结束后画面保持全黑直到你 `fade('in')`。 |
| `Camera.snap(x,y)` | 把**世界点 (x,y) 放到画面中心**（不是设左上角），随后夹紧 bounds。关卡开场用 `snap(player.cx(), player.cy())`。 |
| `Input.buffered(a, ms)` | 用**墙钟毫秒**（`Date.now`），不是模拟时间。hitstop 期间缓冲照常流逝——这符合玩家手感。 |
| `randi(a,b)` | **闭区间** `[a,b]`。 |
| `Save.data` | 严格只有 DESIGN §8 的九个字段。`hp` 单位是**点**（每颗心 20 点），初始 `hp=maxHp=60`（3 颗心）。心数 = `maxHp/20`，不另存字段。 |
| `Game.time` | 是**乘过 slowmo 的**时间，hitstop 期间**冻结**。要不受 slowmo 影响的计时器，请自己累加 `Game.rawDt`（恒为 `1/60`）。 |

---

## 3. 坑（**请务必读完这一节**）

### 输入
1. **`Input.update()` 由 `Game` 在每个固定步末尾自动调用，你不要自己调。**
   `pressed()/released()` 在一个固定步内只 true 一次。
2. **一个物理键映射到多个 action 是有意的**：W/↑ 同时是 `up`/`jump`/`interact`，
   Space 同时是 `jump`/`confirm`，J 同时是 `attack`/`confirm`。
   Input 内部按**来源计数**而不是布尔，所以「按住 W → 按空格 → 松开 W」不会被误判成松开 jump。
3. 用掉一次缓冲后**必须** `Input.consume('jump')`，否则 120ms 内会重复触发。
4. 窗口失焦 / 切标签页会清空所有按键（并补发 released 边沿）。

### 物理
5. **`moveY` 自己管 `onGround`**：`dy!==0` 时进入先置 `false`，向下撞到才置 `true`。
   **调用方不要自己清 `onGround`**。`dy===0`（hitstop）时直接 return，**不动** `onGround`。
6. **`moveX`/`moveY` 撞上会把 `vx`/`vy` 归零。** 想拿落地冲击力度做尘土/音效，
   请**在调用 `moveY` 之前**记下 `vy`。
7. **`dropThrough`**：设 `body.dropThrough = true` 就行。World 会自动换算成 0.2s 的忽略窗口
   （写进 `body.dropThroughUntil`，并把 `dropThrough` 置回 false）。**不要自己维护计时。**
8. **单向平台**只在「向下移动 **且** 上一细分步脚底 ≤ 平台顶 +0.5px」时阻挡；
   上升穿过；`lineBlocked` 也不把单向平台算作遮挡。
9. **高速位移是安全的**：`moveX/moveY` 内部按 8px 细分。实测单次 400px 砸地面、
   单次 300px 砸 14px 厚的薄平台都不穿。你可以放心传大 `dx`。

### dt = 0
10. **hitstop 用 `slowmo(0, 0.045)`，你的 `update(dt)` 会收到 `dt === 0`。**
    任何拿 `dt` 做分母、或「每帧至少推进一点」的逻辑都会出问题。
    缓动请写成 `v += (target - v) * (1 - Math.exp(-k * dt))` 这种 dt=0 时自然退化为「不动」的形式。

### 实体表
11. `Ent.updateAll` **先快照**：本帧新增的实体**下一帧**才开始 update；本帧删除的立刻不再 update。
12. `Ent.remove(e)` 会**立刻**从 `list` 摘掉并置 `e.dead = true`。在 `Ent.each` 回调里删除是安全的。
13. `Ent.drawAll` 排的是**副本**（按 `z` 升序，同 `z` 保持加入顺序），不会打乱 update 顺序。

### 摄像机
13b. **`Camera.snap(x,y)` 不重置 `look`（lookahead 偏移）。**
    关卡开场若主角 facing=1，画面会在头 0.5s 内**缓慢右移约 60px** 把 lookahead 补上。
    这是缓动的自然结果、不是 bug。要开场就完全静止，`snap` 之后手动
    `SJ.Camera.look = player.facing * 60; SJ.Camera.snap(...)` 再来一次即可。

### 场景与绘制
14. **`push` 后只有栈顶 `update`，但全栈都 `draw`（bottom→top）。**
    暂停菜单/对话能看到后面的游戏画面就是靠这个。`setScene` 会自顶向下 `exit()` 掉整个旧栈。
15. `Game.render` 每帧先 `setTransform(scale,0,0,scale,0,0)`，所以你的 `draw(g)` 拿到的
    就是 **960×540 逻辑坐标系**（DPR 与窗口缩放我已经处理好）。
    我在每个 `scene.draw` 外面包了 `save/restore`，并在覆盖层前重置变换与 alpha ——
    但**请你自己配平 `Camera.apply/restore`**，别指望我兜底 clip。
16. 绘制顺序：`全栈 scene.draw → SJ.FX.drawScreen(g) → flash → fade`。
    `FX.drawScreen` 我在 **camera 变换之外**调（与决议 001.5 一致）；
    `FX.draw(g)`（世界坐标）由**关卡自己**在 `Camera.apply` 里面调。

### 存档
17. **`SJ.Save` 不会自动 load。** `SJ.Save.data` 一上来是默认值，要读档请显式 `SJ.Save.load()`。
18. localStorage 不可用（`file://` / Safari / 隐私模式 / 配额满）时**自动降级到内存**，不抛错。
    `load()` 会把旧档合并到默认值上，所以以后加字段不会打挂老存档。

---

## 4. 手感基线数字（E 写 Player 时请对齐）

在 `dev/sandbox.html` 里用 DESIGN §7 的数值实测（半隐式欧拉，dt=1/60）：

| 量 | 值 |
|---|---|
| 长按跳顶点 | **114px**（连续解是 108，离散积分多出半帧，属正常） |
| 点按跳顶点（按 1 帧即松，截断到 -420） | **52.3px** |
| 走速收敛 | 60 帧内到 240 |
| 土狼时间 | 0.10s = 离地 6 帧内仍可跳 |
| 跳跃缓冲 | 120ms，落地那一帧起跳 |
| 满跳滞空 | 0.6s，水平约 144px（够跨 120px 的坑） |

沙盒里按 **U** 跑 18 项物理自检，全部对着上面这些数字硬断言。
**E 实现 `SJ.Player` 之后，手感应当与沙盒一致；不一致就是 Player 那边的问题，不是 core。**

顺序也要一致：`重力 → 土狼/缓冲 → 起跳 → 可变跳高截断 → moveX → moveY`。
把重力放在起跳之后会让顶点变成 108，二段跳手感也会变。

---

## 5. 工具

| 文件 | 用途 |
|---|---|
| `开始游戏.command` | 双击：在本目录起 http 服务（8765 起，占用就往上找到 8820）+ 开默认浏览器。**关掉终端窗口即停服务。** |
| `dev/check.html` | **契约自检闸门**。按 index.html 顺序加载全部脚本（缺的会 404，页面不崩），逐个查 `SJ.*` 存在性与 typeof，分模块绿/红/灰列出，控制台打印缺失清单。另有「深检」：Levels 时长预算 ≥1800、7 种杂兵、12 招、Figure 必备姿势、Script 入口 key。每波结束跑。 |
| `dev/sandbox.html` | 手感沙盒。A/D 移动，空格/W 跳（可变高·二段），S+空格 下穿，J 命中停顿+震屏+闪白，**U 跑自检**，I 复位。`?test=1` 自动跑。 |

`file://` 直接打开 `index.html` 也能跑（没有 fetch/XHR，存档自动降级到内存）。

---

## 6. 待 Lead 裁定

1. **`SJ.Save.data.playtimeSec` 目前没有任何人在累加。** DESIGN §9.6 要求通关结算显示它，
   但契约没写归属。建议给 G（`Level.update` 里 `+= dt`）或由我在 `Game` 里累加 `rawDt`。
   我没有擅自实现，因为这会写进别人的模块语义。
