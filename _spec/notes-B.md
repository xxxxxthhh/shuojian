# notes-B —— 水墨渲染层（ink / figure / fx）

给 E（player）、F（enemies/bosses）、G（level）看。只写你们会撞到的东西。

---

## 1. pose 坐标系约定（F 写 boss 姿势前必读）

### 1.1 角度

CONTRACTS 写的是「0=向下，正=顺时针」。**实际实现是「0=向下，正=向前（朝 facing 方向）」。**

原因：canvas y 向下时数学正旋转在屏幕上确实是顺时针，但对一个 `facing=+1`（朝右）的人来说，
正角度会把肢体甩到**身后**，写 pose 时满屏负号。改成「正=向前」之后，
`facing=-1` 时正好等于屏幕顺时针，与契约字面一致；`facing=+1` 时相反。

已报备 Lead。所有角度只经过 `figure.js` 里的 `dv()` / `uv()` 两个函数，
要翻回字面版只需改这两个函数的符号，不必动任何 pose。

```
dv(a) = (sin a,  cos a)   // 0=向下，正=向前 —— 四肢用
uv(a) = (sin a, -cos a)   // 0=向上，正=向前 —— 脊柱、脖子用
```

### 1.2 关节角是**相对父节点**的

`legF:[hip, knee]` 里 `knee` 是**在大腿方向上再加的偏转**，不是绝对角。

- **屈膝 = 负**（小腿往身后折）。跑步摆动相峰值约 `-1.7`。
- **屈肘 = 正**（前臂往身前折）。
- `wristF` 同理，叠在 `armF[0]+armF[1]` 上。**手腕独立于肘**，剑尖轨迹靠它。

### 1.3 长度与原点

- `o.x, o.y` = **脚底中心**的世界坐标。
- 局部单位：`scale = 1` 时身高约 64px。骨骼长度写死在 figure.js 顶部
  （`THIGH 16 / SHIN 16 / SPINE 21 / NECK 5.5 / HEADR 4.6 / UARM 12 / FARM 11.5`）。
- `pose.hipY` = 胯离地高度（单位）。站立默认 32 = THIGH+SHIN，即腿完全伸直。
  **想让脚踩在地上，`hipY` 必须约等于两段腿在竖直方向的投影和**，见 §3。

---

## 2. `Figure.tip(o)` 怎么算的

```
wristA = pose.armF[0] + pose.armF[1] + pose.wristF
tipLocal = 前手位置 + dv(wristA) * WLEN[weapon] * pose.weaponLen
tip = { x: o.x + tipLocal.x * facing * scale,
        y: o.y + tipLocal.y * scale }
```

- `WLEN = {jian:26, dao:24, qiang:52, gong:17, di:13, gan:56}`（局部单位）。
- `weaponLen` 是**倍率**，1 = 正常。想要「剑气延长」传 1.6 之类。
- `weapon: null` 或未知武器 → **返回持械手的位置**，不报错。
- `draw` 和 `tip` 共用同一个 `rig()`，所以**画出来的剑尖和 tip 返回的坐标一定一致**。
  `dev/figure.html` 的战斗片段里那个朱砂小圆圈就是画 `tip()` 的返回值，用来盯这件事。

另有 `Figure.joints(o)` 返回全部关节的世界坐标
（`hip mid neck sh headBase headTop elF haF elB haB knF ftF knB ftB tip`），
抓握点、命中判定、挂特效用得上。

---

## 3. 给下游自定义 pose 的建议

### 3.1 别硬凑角度，先解「脚要落在哪」

FK 没有 IK 兜底，角度乱填脚就会陷进地里或者悬空。竖直方向：

```
足底相对胯的下落量 = THIGH*cos(hip) + SHIN*cos(hip+knee)
```

要脚落地就让它 ≈ `hipY`。举例（`crouch` 就是这么解出来的）：
`hipY=21.5, legF=[1.05,-1.70]` → `16*cos(1.05)+16*cos(-0.65) = 8.0+12.7 = 20.7` ≈ 21.5。✓

后脚允许踮起（比地面高几个单位），看着反而自然。

### 3.2 用 `blend` 而不是从零写

```js
var p = SJ.Figure.blend(SJ.Figure.pose('guard',0,t), myPose, 0.6);
SJ.Figure.draw(g, {..., pose: p});
```
`pose` 传**对象**时会直接用，不再查表。`blend` 逐字段线性插值，数组按下标插。
Boss 的怪姿势建议从最接近的现成 pose 起手，只改 2–3 个字段。

### 3.3 前摇只有 4 帧，`*_wind` 在 p=0 就要「已经拉满」

DESIGN §7：前摇 0.06s ≈ 4 帧。**不要在 wind 里从站姿慢慢拉起来，玩家看不见。**
`p=0` 直接是蓄满的样子，`p` 只用来再多压一点点。

**跟随（follow-through）全部放在 `*_rec`**：`p=0` 是过冲（剑已经甩过头），
`p≈0.6` 收住，之后保持。这是打击感的来源，别省。

### 3.4 已提供但只是粗做的 pose

`upslash` = `atk2_hit` 的别名，`downslash` = `atk3_hit` 的别名。
`castWind/castHit` 是通用的「起手/放招」，招式各异的话建议自己 blend。
其余 pose 名全部实到。**查不到的名字会 fallback 到 `idle` 而不是崩**，
但别依赖这个 —— 拼错了你会得到一个站着不动的 Boss。

### 3.5 朱砂发带

`o.ribbon` **默认 false**。DESIGN §1 规定朱砂只给主角的束发带，
所以只有 E 在画 player 时传 `ribbon: true`，杂兵和 Boss 一律不要传。

---

## 4. 次级运动（衣摆 / 发带）

主驱动是 **`o.vx` / `o.vy`**（世界速度，实体本来就有）—— 完全无状态，传了就有。

```js
SJ.Figure.draw(g, { ..., vx: e.vx, vy: e.vy, cloth: 0.55, key: e });
```

- `o.cloth` 0..1 控制衣摆幅度，默认 0.5。
- **`o.key` 是可选增强**：传了（任何稳定的键，实体引用即可）会额外做一个指数追随，
  衣摆/发带会晚 1–2 帧跟上，动起来更有惯性。不传就只有速度直驱 + 呼吸摆动，也能看。
- 实体销毁多的话可以调 `SJ.Figure.clearMotionCache()` 清缓存（换关卡时调一次就够）。

---

## 5. FX 的两个约定

### 5.1 `FX.trail(ent, o)` 从 ent 上读什么

优先读 **`ent.figOpts`**（你每帧传给 `Figure.draw` 的那个对象），没有就退回读 `ent` 上的同名字段：

```
{ x, y, facing, scale, pose, p, t, weapon, cloth }
```

所以只要你把每帧构造的 figure 参数挂成 `e.figOpts`，残影就白拿。
存的是**快照**不是引用，之后改 ent 不影响已生成的残影。

### 5.2 `draw` 是世界坐标，`drawScreen` 是屏幕坐标

`Game` 的绘制顺序是 `scene.draw → FX.drawScreen → flash/fade`。所以：

- `FX.draw(g)` 要由**场景在 camera 变换里**调 —— 世界坐标的粒子（墨溅、残影、竹叶、伤害数字）。
- `FX.drawScreen(g)` 由 Game 在 camera 外调 —— 屏幕坐标的粒子。

粒子的 `screen` 标志决定它进哪一层。**默认 false（世界）**；
「悟」、招名这种要钉在屏幕上的，传 `{screen:true}`。

### 5.3 `FX.splash` 想让墨点留在地上，**必须传 `groundY`**

契约签名是 `FX.splash(x,y,dir,o)`，但 DESIGN 要的是「落地后晕开成墨点留在地上 2s」。
fx.js 只依赖 const.js，问不到 `SJ.World`，所以**地面高度得你告诉它**：

```js
SJ.FX.splash(hx, hy, dir, { groundY: target.y + target.h });   // ← 这样才会落地晕开
SJ.FX.splash(hx, hy, dir);                                     // 不传 = 溅在半空原地晕开
```

半空命中（跳斩、空连）想让墨溅留在空中就别传，是合理的；
地面战斗请一律传 `groundY`，否则 DESIGN §1 要求的「落地晕开」看不到。

### 5.4 颜色默认焦墨

`slash` / `splash` / `ring` 的 `color` **默认 `SJ.C.ink`**。
朱砂要显式传 `{color: SJ.C.cinnabar}`。
一屏最多一处彩色 —— 主角的发带已经占了一处，普通命中特效**不要**再用朱砂。

---

## 6. 给 G 的几条

- **`Ink.mountains` / `Ink.bamboo` 内部有离屏层缓存**（按 `depth+seed+baseY+...` 做 key），
  滚动超过 132px 才重画一层。所以逐帧调它们是安全的，别自己再包一层缓存。
  换关卡时调 `SJ.Ink.clearLayerCache()`。
- **远山不会填到屏幕底部**：只在山脊往下 150–245px 内渐隐。底下那片纸白是构图的一半，
  别再往上堆东西。一屏纸色空白要占 50% 以上。
- `Ink.paper(g, camX, camY)` 的噪点是预渲染到 128px tile 再平铺的，视差极小且量化到整数像素
  （否则纸纹会「爬」）。**tile 里绝不能加任何有方向的纹理**，128px 会平铺成整屏横格线。
- `Ink.bamboo` 的 `depth 0` 是 alpha 0.72 的焦墨近景，很重，**一屏只铺一小丛**（调大 `gap`），
  铺满整屏会把画面压死。
- `Ink.stroke` 的 `o.seed` 决定全部随机量，**同一 seed 每帧画出完全一样的结果**。
  背景元素务必传固定 seed，否则会逐帧抖。

---

## 7. 已知不足（诚实记录）

- `Ink.splat` 的细丝偏对称，像蜘蛛腿；定向飞溅建议用 `FX.splash` 而不是直接调 `splat`。
- `FX.leaf` 的竹叶形状偏简单，小尺寸下就是一小笔，凑合。
- `castWind/castHit` 只是通用起手式，12 个招式如果都用它会显得雷同。
- `Ink.water` 只有横向波纹，没有倒影和岸线，第三回长河渡可能需要 G 再补。
- 雪在米色纸上对比天生弱，`Ink.snow` 已经在雪点下垫了一圈极淡石青，
  但第四回还是建议 G 在天空压一层淡墨 wash，雪才跳得出来。
- **角度符号未获 Lead 确认**：目前按「正=向前」实现（§1.1）。若 Lead 要字面版，
  改 `figure.js` 的 `dv()` / `uv()` 两个函数符号即可，pose 表不用动。
  **F 在确认前不要大批量写角度。**
