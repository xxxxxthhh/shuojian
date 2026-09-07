# 接口契约（不可擅自改动）

所有代码是 **classic script**，无 module。每个文件形如：

```js
(function (SJ) {
  'use strict';
  SJ.Xxx = { ... };
})(window.SJ = window.SJ || {});
```

**任何 agent 都不得修改不属于自己的文件。** 需要别人改接口 → 报告给 Lead。
若依赖的模块还没写好，**按本文件签名假设它存在**，不要写 fallback，不要 try/catch 兜底。

`g` 一律指 CanvasRenderingContext2D。世界坐标 y 向下为正，地面在下。

---

## src/core/const.js  【A】
```js
SJ.W = 960; SJ.H = 540;
SJ.GRAVITY = 2400; SJ.MAXFALL = 1100;
SJ.C = { paper:'#efe7d8', paperDark:'#e2d7c1', ink:'#1b1a17', ink2:'#35322c',
         inkLight:'#6f6a60', feibai:'rgba(27,26,23,0.12)',
         cinnabar:'#b03a2b', stone:'#4a6f7c', gamboge:'#c8a55b' };
SJ.FONT = '"Songti SC","STSong","Kaiti SC",serif';
SJ.rand(a,b) / SJ.randi(a,b) / SJ.clamp(v,a,b) / SJ.lerp(a,b,t)
SJ.ease = { out:t=>1-(1-t)**3, in:t=>t*t*t, io:t=>..., back:t=>..., elastic:t=>... }
SJ.noise(x)            // 1D value noise, 确定性, 返回 -1..1
SJ.hash(i)             // 确定性 0..1
SJ.aabb(a,b) -> bool   // {x,y,w,h}
```

## src/core/input.js  【A】
```js
SJ.Input.init(canvas)
SJ.Input.update()                       // 每帧最后调用，翻转 edge 状态
SJ.Input.down(a) / pressed(a) / released(a) -> bool
SJ.Input.buffered(a, ms=120) -> bool    // 最近 ms 内按下过（用于跳跃/攻击缓冲）
SJ.Input.consume(a)                     // 清掉缓冲，避免重复触发
SJ.Input.axis() -> -1|0|1               // 水平
SJ.Input.any() -> bool
```
action 名：`left right up down jump attack guard dash t1 t2 t3 t4 pause confirm`
按键映射见 DESIGN.md §2。鼠标左=attack，右=guard（须 `preventDefault` 掉右键菜单）。

## src/core/game.js  【A】
```js
SJ.Game.init(canvas)                    // 建立 loop，固定步长 1/60，accumulator，最多补 5 帧
SJ.Game.setScene(scene, data)           // scene = {enter(data), update(dt), draw(g), exit()}
SJ.Game.scene ; SJ.Game.time ; SJ.Game.frame
SJ.Game.slowmo(scale, sec)              // 叠加取最小值；hitstop 用 slowmo(0, 0.045)
SJ.Game.shake(mag, sec)
SJ.Game.flash(color, sec, alpha)
SJ.Game.fade(toBlackOrPaper, sec, cb)   // 'out'|'in'
SJ.Game.push(scene,data) / SJ.Game.pop() // 用于暂停菜单与对话叠加
```
绘制顺序：scene.draw → `SJ.FX.drawScreen(g)` → flash/fade 覆盖层。
`dt` 传给 update 的是**已乘过 slowmo 的秒数**；`SJ.Game.rawDt` 是原始值。

## src/core/camera.js  【A】
```js
SJ.Camera.x, .y                         // 左上角世界坐标
SJ.Camera.setBounds(x0,x1,y0,y1)
SJ.Camera.follow(target, dt, opts)      // 死区 120×80，lookahead 随 facing±60，平滑 8/s
SJ.Camera.snap(x,y)
SJ.Camera.apply(g) / restore(g)
SJ.Camera.shakeOffset -> {x,y}
```

## src/core/world.js  【A】
```js
SJ.World.load(level)                    // level.solids = [[x,y,w,h,flags]]  flags:0 实心 1 单向 2 会消失
SJ.World.solids                         // 运行时数组，元素 {x,y,w,h,oneway,gone}
SJ.World.moveX(body, dx) -> collided    // body 需有 x,y,w,h,vx,vy
SJ.World.moveY(body, dy) -> collided    // 落地时置 body.onGround=true
SJ.World.groundAt(x, yFrom) -> y|null
SJ.World.lineBlocked(x1,y1,x2,y2) -> bool
SJ.World.addSolid(s) / removeSolid(s)
```
碰撞用 AABB + 逐轴推出；单向平台仅当 `vy>0 且上一帧脚底在平台上方` 才阻挡；`body.dropThrough` 为 true 时忽略单向平台 0.2s。

## src/core/ent.js  【A】
```js
SJ.Ent.list                             // 所有实体
SJ.Ent.add(e) -> e ; SJ.Ent.remove(e)
SJ.Ent.each(fn) ; SJ.Ent.by(tag) -> []  ; SJ.Ent.clear()
SJ.Ent.updateAll(dt)                    // 调 e.update(dt)，之后清理 e.dead
SJ.Ent.drawAll(g)                       // 按 e.z（默认 0）升序调 e.draw(g)
```
实体最小字段：`{x,y,w,h,vx,vy,facing:1|-1,hp,maxHp,team:'player'|'foe',tag,z,dead,update,draw,hurt(dmg,src,opt)}`
`x,y` 是**左上角**；`e.cx()`/`e.cy()` 由各自实现返回中心。

## src/core/save.js  【A】
```js
SJ.Save.data                            // 见 DESIGN §8
SJ.Save.load() / save() / reset() / exists()
```

## src/render/ink.js  【B】 —— 全部是纯绘制函数，不持有游戏状态
```js
SJ.Ink.paper(g, camX, camY)                      // 铺纸底 + 噪点 + 四角晕染（噪点必须缓存到离屏 canvas，不能每帧逐像素）
SJ.Ink.stroke(g, pts, o)                         // o={w0,w1,color,alpha,taper:true,wobble}. 核心毛笔线：沿路径做变宽多边形填充 + 末端飞白
SJ.Ink.line(g, x1,y1,x2,y2, w, o)
SJ.Ink.arcStroke(g, cx,cy,r, a0,a1, w, o)        // 挥砍弧线用
SJ.Ink.blob(g, x,y, r, seed, o)                  // 不规则墨团（山石、树冠）
SJ.Ink.splat(g, x,y, r, seed, o)                 // 飞溅墨点 + 细丝
SJ.Ink.wash(g, x,y,w,h, o)                       // 淡墨渲染（渐变矩形）
SJ.Ink.mountains(g, camX, depth, o)              // depth 0..2，越大越淡越远，内部用 SJ.noise 生成确定性山脊
SJ.Ink.bamboo(g, camX, depth, o)
SJ.Ink.pine(g, x, y, scale, seed)
SJ.Ink.water(g, x,y,w,h, t, o)                   // 横向波纹线
SJ.Ink.rain(g, camX, t, intensity, wind)
SJ.Ink.snow(g, camX, t, intensity, wind)
SJ.Ink.lantern(g, x,y, r, t)                     // 藤黄灯火 + 呼吸光晕
SJ.Ink.seal(g, x,y, size, text)                  // 朱砂印章（方框 + 竖排字）
SJ.Ink.vtext(g, text, x,y, size, o)              // 竖排毛笔字（右起）
SJ.Ink.htext(g, text, x,y, size, o)
SJ.Ink.brushReveal(g, text, x,y, size, p, o)     // 逐笔写出，p=0..1
```
`o` 通用可选项：`{color, alpha, w, seed, jitter}`。所有随机必须用 `SJ.hash(seed+i)`，**同一帧同一 seed 必须画出同样的东西**（不能抖）。

## src/render/figure.js  【B】 —— 人物笔画骨架，全游戏共用
```js
SJ.Figure.draw(g, o)
// o = {x,y,            // 脚底中心的世界坐标
//      facing, scale,  // scale 1 ≈ 身高 64px
//      pose,           // 见下
//      color, alpha, lineScale,
//      weapon:'jian'|'dao'|'qiang'|'gong'|'di'|'gan'|null,
//      cloth:0..1,     // 衣摆飘动强度
//      t}              // 时间，用于衣摆/发带的次级运动
SJ.Figure.pose(name, p, t) -> pose       // name 见下，p=0..1 动作进度
SJ.Figure.blend(a, b, k) -> pose
SJ.Figure.tip(o) -> {x,y}                // 当前姿势下武器尖端世界坐标（给特效/判定用）
```
pose 字段（全部是角度，弧度，0=向下，正=顺时针；躯干在原点）：
```js
{ hipY, lean, headAng, neck, spine,
  armF:[shoulder, elbow], armB:[shoulder, elbow],
  legF:[hip, knee],       legB:[hip, knee],
  wristF, weaponLen }     // weaponLen 1=正常
```
必须提供的 pose 名：
`idle run jump rise fall land crouch dashF guard observe hurt down dead
 atk1_wind atk1_hit atk1_rec atk2_wind atk2_hit atk2_rec atk3_wind atk3_hit atk3_rec
 castWind castHit thrust upslash downslash sit walk bow`
（Boss 用的额外姿势由 F 通过 blend 与自定义 pose 对象组合，不要求 B 提供。）

**这是全游戏最重要的视觉文件。** 要求：动作有预备与跟随，重心有起伏，衣摆与发带有 1–2 帧延迟的次级运动，剑与手腕分离。宁可少几个 pose，也要让 idle 与 run 看着像人。

## src/render/fx.js  【B】
```js
SJ.FX.burst(x,y,o)        // o={n,color,speed,spread,angle,life,size,gravity,drag}
SJ.FX.splash(x,y,dir,o)   // 命中墨溅：飞出去 + 落地晕开成墨点（留在地上 2s 后淡出）
SJ.FX.slash(x,y,a0,a1,r,o)// 挥毫弧线，0.12s 内由粗到细消散
SJ.FX.ring(x,y,o)         // 冲击波圆环
SJ.FX.trail(ent,o)        // 残影（存 6 帧姿势快照）
SJ.FX.word(x,y,str,o)     // 浮字（伤害/招名/「悟」）
SJ.FX.dust(x,y,dir)       // 落地/起步尘土
SJ.FX.leaf(x,y,n,kind)    // 竹叶/雪片/纸屑
SJ.FX.update(dt) ; SJ.FX.draw(g) ; SJ.FX.drawScreen(g) ; SJ.FX.clear()
```
粒子上限 600，超出丢最老的。

## src/audio/audio.js  【C】
```js
SJ.Audio.init()                          // 必须在首次用户手势里调，重复调用安全
SJ.Audio.ready -> bool
SJ.Audio.sfx(name, o)                    // o={vol,rate,pan}
SJ.Audio.music(name, o)                  // name|null，o={fade:1.2}
SJ.Audio.intensity(v)                    // 0..1，战斗紧张度，影响鼓点密度与音量
SJ.Audio.duck(sec)                       // 短暂压低音乐（悟/过场用）
SJ.Audio.setMute(b) ; SJ.Audio.muted
```
sfx 名：`swing1 swing2 swing3 hit hitHeavy parry block guard dash jump land
step hurt death enemyDeath draw sheathe learn qi arrow bell woodclap page
door fire water wind ui uiConfirm uiBack coin heart`
music 名：`tea bamboo inn river snow library wall boss final ending silence`

## src/combat/combat.js  【E】
```js
SJ.Combat.hit(o) -> hitbox
// o = {x,y,w,h, dmg, team, owner, ttl:0.08, knock:[kx,ky], stun:0.2,
//      type:'slash'|'thrust'|'blunt'|'qi'|'fire', pierce:false, moveId:null,
//      onHit(target, hb), hitstop:0.045}
SJ.Combat.telegraph(o) -> tg
// o = {owner, moveId, dur, path:[[x,y],...] 相对 owner 的预示轨迹, danger:true}
//   起手式登记；玩家观势时会画出完整轨迹；tg.window = 判定命中的那一帧
SJ.Combat.tgList                        // 当前所有起手式，供渲染
SJ.Combat.update(dt)                    // 解算 hitbox × 实体；处理观势格挡；派发学习进度
SJ.Combat.draw(g)                       // 画起手式虚线（观势时更清晰）
SJ.Combat.clear()
```
命中判定顺序：先看目标是否处于「完美观势」窗口 → 格挡成功（走 `SJ.Player.onParry`）；否则 `target.hurt(...)`。

## src/combat/tech.js  【E】
```js
SJ.Tech.defs                             // 见 DESIGN §6，每条 {id,name,from,cost,cd,desc,exec(p,st,dt)->done}
SJ.Tech.can(p,id) -> bool
SJ.Tech.use(p,id) -> bool
SJ.Tech.update(dt)
SJ.Tech.progress                         // {moveId: 0..100} 残墨进度
SJ.Tech.gain(moveId, amount)             // 满 100 触发 SJ.Tech.learn
SJ.Tech.learn(moveId)                    // 演出（定格 + 藤黄闪 + 竖排招名）+ 写入 SJ.Save
```

## src/entity/player.js  【E】
```js
SJ.Player.create(x,y) -> p               // 同时设置 SJ.player
p.ink, p.maxInk(100), p.hp, p.maxHp, p.hearts
p.state                                  // 'idle run jump fall dash atk1 atk2 atk3 observe hurt dead cast land crouch'
p.known -> [moveId]  ; p.slots -> [4 个 moveId|null]
p.observing -> bool ; p.parryWindow -> bool
p.onParry(src)
p.addInk(n) ; p.spendInk(n)->bool
p.respawn(x,y)
SJ.Player.inkTint() -> 0..1              // 世界褪色系数，由 UI/关卡渲染时读取
```

## src/entity/enemies.js  【F】
```js
SJ.Enemies.defs                          // {id:{hp,speed,w,h,weapon,moves:[],ai}}
SJ.Enemies.spawn(id, x, y, opts) -> e
```
必须实现的杂兵：`daoke`(刀客) `gongshou`(弓手) `qiangbing`(枪兵) `lishi`(力士)
`sengren`(僧人·只格挡) `cike`(刺客·瞬移) `denglong`(提灯人·雪山，会照亮)
每种至少 1 个带 telegraph 的招牌招式（对应 DESIGN §6 的来源）。

## src/entity/bosses.js  【F】
```js
SJ.Bosses.spawn(id, x, y) -> e           // id: yuzhongdao dizi laoweng baiyi shouge shixiong
e.phase ; e.onDefeat = cb                // 倒地未死 → 关卡层弹生杀选择
```
每个 Boss：2–3 阶段，每阶段 3–5 个可读招式，至少 1 个必须观势才能过的招。**不做纯背板**，要有反应空间。

## src/level/level.js  【G】
```js
SJ.Level.load(idx, checkpoint)           // 建 scene 并 SJ.Game.setScene
SJ.Level.current ; SJ.Level.def
SJ.Level.checkpoint(x,y)
SJ.Level.complete()                      // 播 outro → 存档 → 下一章
SJ.Level.spawnWave(waveDef)
SJ.Level.bossDefeated(id)                // 触发生杀选择 UI
```

## src/data/levels.js  【G】
```js
SJ.Levels = [ {id,title,chapter,music,weather:'rain'|'snow'|'none'|'wind',
               bg:'bamboo'|'inn'|'river'|'snow'|'library'|'wall'|'tea',
               w, h, solids:[[x,y,w,h,flag]], hazards:[], deco:[],
               spawns:[{type,x,y,wave}], waves:[], checkpoints:[[x,y]],
               triggers:[{x,y,w,h,event,once}], boss:null|id,
               intro:'scriptKey', outro:'scriptKey', exitX} ]
```
关卡宽度 3500–6000px。每章 2–4 个检查点。

## src/data/script.js  【D】
```js
SJ.Script = {
  key: { speaker:'说书人'|'无名'|'…', mode:'tea'|'talk'|'card'|'narration',
         lines:['…','…'], choices:null|[{text,flag,goto}], next:'key'|null,
         cond:(save)=>bool }
}
```
说书人段落用 `mode:'tea'`（茶馆插画 + 竖排字 + 醒木）。

## src/story/story.js  【H】
```js
SJ.Story.play(key, onDone)               // push 一个叠加 scene，接管输入
SJ.Story.flag(k,v) / SJ.Story.get(k)
SJ.Story.chapterCard(title, subtitle, cb)
SJ.Story.ending()                        // 按 mercy/known 选分支
```

## src/ui/hud.js  【H】
```js
SJ.HUD.draw(g, p)                        // 血（朱砂圆点/心）+ 墨滴 + 招式槽 + 残墨进度环
SJ.HUD.notice(str)                       // 顶部淡入淡出的小字
```

## src/ui/menus.js  【H】
```js
SJ.Menu.title() ; SJ.Menu.pause() ; SJ.Menu.slots() ; SJ.Menu.gameover() ; SJ.Menu.ending(kind)
```

## index.html  【Lead】
按依赖顺序加载：const → input → camera → world → ent → save → **game** → ink → figure → fx → audio
→ combat → tech → player → enemies → bosses → data/script → data/levels → story → hud → menus → level → main.js

## src/main.js  【Lead】
引导：建 canvas → `SJ.Game.init` → `SJ.Menu.title()`。

---

## 修订（优先级最高）

### 新增 action
`interact`（W/↑/F）。`SJ.Input.down('interact')` / `pressed('interact')`。

### E 补充
```js
SJ.Player.inkTint() -> 0..1      // 1=墨满，0=枯墨。G 在 Level.draw 末尾据此覆盖纸色
```
墨规则见 DESIGN §9.3：身法/观势在墨≤20 时不再扣墨；枯墨掉血最低掉到 1 HP。
`SJ.Combat` 需支持 `telegraph({danger:false})`（守势型起手式，观势可读但不会打人）。

### F 补充
`shouge`（守阁人）不主动攻击，每次架防登记 `telegraph({moduleId:'wufeng', dur:1.2, danger:false})`。

### G 补充
```js
SJ.Level.pickups                 // 可击碎物件与石砚，由 levels.js 的 deco 生成
```
`SJ.Levels[i].expectedSec` 与 `.encounters` 为必填。总和 ≥1800。
`Level.draw` 末尾应用褪色（DESIGN §9.5）。
关卡 trigger 事件里可以直接调 `SJ.Tech.gain(id, 100)`。

### H 补充
```js
SJ.Story.mercyChoice(bossId, cb)  // 无字的生杀抉择演出；3 秒不动 = 留手；cb(true=杀, false=留)
SJ.Menu.ending(kind)              // 结算显示 SJ.Save.data.playtimeSec
```
**菜单里不得出现任何按键说明 / 教程 / 玩法介绍页。** 标题画面只有：始 / 继 / 音 三项。

### A 补充
```
dev/check.html   —— 契约自检页：按 index.html 的顺序加载全部脚本，
                    对照一份符号清单逐个检查 SJ.* 是否存在且类型正确，
                    控制台与页面上打印缺失项。每一波结束后由 Lead 运行。
```

### B 补充
```
dev/figure.html  —— 姿势画廊：网格展示全部 pose 名，idle/run/atk 循环播放，
                    可切换 scale/weapon/facing。这是 wave 1 的视觉验收门。
dev/ink.html     —— 笔触画廊：展示 Ink.* 每个函数的效果。
```

---

## 决议 001 — 姿势与残影约定（Lead 裁定，优先级最高）

由 B 提案，Lead 批准。所有写 pose 的人（B/E/F）必须遵守。

1. **角度符号**：`0 = 向下`，**正 = 向 facing 方向（向前）摆**。
   局部坐标里 `dir(a) = (sin a, cos a)`，绘制时用 `g.scale(facing,1)` 做镜像。
   （契约原文「正=顺时针」作废；新约定在 facing=-1 时与原文等价。）
2. **关节角相对父节点**：`legF:[hip,knee]` 的 `knee` 是在大腿方向上的再偏转。
   **屈膝 = 负，屈肘 = 正。**
3. `weaponLen` 是倍率，1 = 正常。`SJ.Figure.tip(o)` 在 `weapon:null` 时返回**手腕**坐标，不报错。
4. **实体必须每帧维护 `ent.figOpts`**：即那个传给 `SJ.Figure.draw` 的对象
   （至少含 `{x,y,facing,scale,pose,weapon}`）。
   `SJ.FX.trail(ent,o)` 优先读 `ent.figOpts`，缺失时退回读 ent 上的同名字段。
   身法残影、刺客瞬移、白衣分身全部依赖这条 —— **E 与 F 必须实现**。
5. **特效坐标空间**：`SJ.FX.draw(g)` 世界坐标（在 camera 变换内调用），
   `SJ.FX.drawScreen(g)` 屏幕坐标（在 camera 变换外调用）。
   粒子用 `screen` 标志区分：「悟」与招名默认 `screen:true`，伤害数字默认 `false`。

---

## 决议 002 — 剧本条件与生杀记录（Lead 裁定，优先级最高）

由 D 提案，Lead 批准并加强。涉及 D / G / H 三方。

### 1. `cond` 语义：链式跳过（H 必须照此实现）
`SJ.Story.play(key)` 在进入时与每次 advance 时，对当前 node 求值 `cond(SJ.Save.data)`：
- 返回 false → **不显示该屏，直接跳到它的 `next`**；`next:null` 即结束。
- 无 `cond` 字段视为 true。

D 保证：外部（levels.js / level.js）会 `play()` 的**入口 key 一律不带 cond**；cond 只出现在内部变体节点上，每组变体互斥且穷尽，链必然终止。
H 仍须加一个 200 步的跳转上限保护，超限则直接结束并 `console.warn`，不许死循环。

### 2. `mercy` 的方向 —— 单一写入者
**`SJ.Save.data.mercy[bossId] === true` 表示「留手（没杀）」。**
（与 DESIGN §5「留手结局 mercy≥4」一致。）

为杜绝方向写反导致不可靠叙述者静默失效：

> **`SJ.Story.mercyChoice(bossId, cb)` 是 `mercy` 的唯一写入者。**
> 它内部执行 `SJ.Save.data.mercy[bossId] = !killed; SJ.Save.save();`，然后调用 `cb(killed)`。
> **G 绝不允许自己写 `save.mercy`**，只能调用 `mercyChoice` 并在回调里处理演出与流程。

`cb` 的参数含义保持 `true = 杀`。读取方一律用「`mercy[id]` 为真 = 留手」。
D 在 script.js 顶部的 `spared(save,id)` helper 是唯一读取入口，其他人不要自己写判断。

**wave 3 集成测试必须覆盖**：留手一个 Boss 后 `mercy[id] === true`，且第四回旁白确实出现与行为矛盾的版本。

### 3. 剧本入口 key 清单（G 写 levels.js 时直接引用）

> **权威清单是 `_spec/STORY.md` §4（86 个入口，已做机器校验）。**
> 下表只是形状说明，**不要照抄示意名**。

```
楔子     p_intro  p_outro  p_door  p_sit  p_chake  p_kelao  p_kelao_b  p_child
第一至六回  cN_intro / cN_outro                     (N=1..6)
Boss     cN_boss_pre / cN_boss_mid / cN_boss_down  (第六回另有 c6_boss_p2 / c6_boss_p3)
关卡内   cN_t_*   语义命名，如 c1_t_ink / c1_t_watch / c3_t_yan / c5_t_page
         另有成链的 c4_mid（第四回关卡内矛盾）、c5_book（题眼，9 屏）
墙上题字 wall_cN_a / wall_cN_b                      (mode:'narration'，单屏)
通用     learn_ink / learn_hurt
终回     f_intro / f_end / f_t_rain / f_t_seat / f_t_chake
```
**trigger 一律语义命名，不用 `cN_t1` 这种序号名**——G 要按「哪句台词教哪个玩法」来摆位置，
`c1_t_ink`（教墨会枯）比 `c1_t1` 可用得多；STORY.md §5 的教学对照表整张按语义名索引。

`SJ.Story.ending()` 直接 `play('f_end')` 即可，**分支全在 script.js 内部用 cond 解决**，H 不要自己判结局分支。

---

## 决议 003 — 剧本接入（Lead 裁定，D 交付后确认）

### G 必须遵守的时序（否则说书人从「故意说反」退化成「随机说错」）
`SJ.Level.complete()` 的顺序是「播 outro → 存档」，**outro 先于存档**。
因此生杀结果必须在 outro 播放前就已经在内存里：

```
Boss 倒地 → SJ.Story.mercyChoice(id, cb) → cb 里已经能读到最新的 SJ.Save.data.mercy
        → 演出结束 → SJ.Level.complete() → 播 outro（读到的是本回的值）→ 存档
```
- `mercyChoice` 内部**当场**写 `SJ.Save.data.mercy[id] = !killed` 并 `SJ.Save.save()`（决议 002）。
- **不许把 mercy 攒到章末统一 flush。** G 不许自己写 `save.mercy`。

### H 必须遵守的呈现约定
1. **`cond`**：进入时与每次 advance 时都求值；false → 不显示该屏、直接跳 `next`（**不是中止整段**）。200 步跳转上限保护。
2. **`mode:'card'`**：`lines[0]` = 主标题，`lines[1]` = 副标题。
   **单行 card = 空白宣纸 + 一枚朱砂印**，印文读 node 的 `seal` 字段（全剧仅 `f_end_all_e` 有，印文「无名」）。
3. **`mode:'narration'` + `speaker:'说书人'` = 关卡内画外音，不切茶馆插画**；
   只有 `mode:'tea'` 才是整屏茶馆。第四回 `c4_mid` 的矛盾必须发生在雪山上，不能打断成过场。
4. `speaker:'无名'` 的节点允许**单行**；`speaker:''` = 无署名旁白与题壁。
5. `SJ.Story.ending()` 直接 `play('f_end')`，**不要自己判 mercy/known 分支**。

### 已验收（Lead 独立复验）
`node dev/script-check.js` 退出码 0；181 key / 452 屏行 / 最长行 16 汉字（≤18 ✓）；
mode 分布 tea 54 / narration 73 / talk 45 / card 9；玩法术语黑名单 grep 干净；
71552 次链式遍历无断链、无环、必终止。

---

## 决议 004 — 关卡摆位约束（G 必须遵守，D 提出，Lead 批准）

### 1. 第六回节拍不可打乱分类
第六回 11 拍旁白按用途分三类（完整表见 `_spec/STORY.md` §4.1）：
- **教学拍**：`c6_t_mix`（威胁在组合不在单体）、`c6_t_all`（招式槽只有四格，带不动的放下）
  → **位置不可挪、不可省**，必须紧贴它们要教的那波遭遇。
- **叙事拍**：`c6_t_wave1`、`c6_t_wave2`、`c6_t_see` → 顺序不可换。
  `c6_t_wave2` 必须在**遭遇密度最高的那一波进行中**播，不是波前波后。
- **场景拍**：`c6_t_climb`、`c6_t_moon`、`c6_t_flag` → 位置可随关卡实际长度微调。

### 2. `c5_t_page` 必须与 `c5_book` 空间隔离（第五回题眼的成立条件）
- **不许**把 `c5_t_page` 挂在 `c5_book` 链尾一起播 —— 那会让物证降格成题眼的注脚。
- 两者之间必须隔着**实际的走动与至少一场战斗**，`c5_t_page` 挂在一个玩家要自己走到的书架 trigger 上。
- 玩家必须是**自己翻到那一页**的。这一屏是全剧唯一的物证，它的力量来自「我自己找到的」。

### 3. 同理约束 H
`c5_t_page` / `c4_mid` 都是 `mode:'narration'` + `speaker:'说书人'`，
**渲染成关卡内画外音，绝不能切茶馆插画**（决议 003 §3）。
切成过场 = 说书人在解说；保持画外音 = 无名在读。差别是整段戏的成败。

---

## 决议 005 — 战斗接口与每帧调用顺序（E 提案，Lead 裁定并扩写）

### 1. 完美观势的敌人硬直：复用 `hurt`，不新增 API
```js
src.hurt(0, player, { parried:true, stun:0.9, moveId });
```
F 的敌人本来就要处理 `opt.stun`，零新增约定。**不要发明 `e.stun` / `e.onStun`。**

### 2. `telegraph.path` 的坐标原点（E 与 F 必须一致）
**相对 owner 的中心点，x 按 `owner.facing` 镜像，y 向下为正：**
```js
绝对点 = [ owner.cx() + px * owner.facing , owner.cy() + py ]
```
不一致的后果是所有敌人的起手式轨迹画反或画歪 —— 而轨迹是「观势」唯一的视觉教学手段。

### 3. 每帧调用顺序（G 必须在 `Level.update/draw` 里照此实现）
**漏掉任何一行都不会报错，只会让某个系统静默消失。**

`SJ.Level.update(dt)`：
```
1. SJ.Ent.updateAll(dt)     // 玩家与敌人；产生 hitbox 与 telegraph
2. SJ.Tech.update(dt)       // 招式执行；也产生 hitbox —— 必须在 Combat 之前
3. SJ.Combat.update(dt)     // 统一结算所有 hitbox 与观势格挡
4. SJ.FX.update(dt)
5. SJ.Camera.follow(SJ.player, dt)
6. 关卡自身：trigger 判定 / 波次推进 / pickup 拾取 / 检查点
```

`SJ.Level.draw(g)`：
```
1. 背景（SJ.Ink.*，视差，camera 外或按 depth 自行处理）
2. SJ.Camera.apply(g)
3.   地形 solids / deco / pickups
4.   SJ.Ent.drawAll(g)
5.   SJ.Combat.draw(g)      // 起手式轨迹，世界坐标 —— 必须在 camera 变换内
6.   SJ.FX.draw(g)          // 世界坐标粒子
7. SJ.Camera.restore(g)
8. 墨褪色覆盖层（读 SJ.Player.inkTint()，见决议 003）
9. SJ.HUD.draw(g, SJ.player)   // 在褪色之后 —— HUD 不受褪色影响
```
`SJ.FX.drawScreen(g)` 与 flash/fade 由 `SJ.Game` 在 scene.draw 之后调，G 不用管。

### 4. 归属澄清（避免重复实现）
- `fenshu` 的**点燃 DoT** 与 `SJ.Combat.stun` 辅助函数在 `combat.js`（E）。
  **F 不要重复实现**，敌人要点燃只需给 hitbox 传 `type:'fire'`。
- 「悟」的全屏定格用 `SJ.Game.push(overlay)`（Game 只更新栈顶、仍绘制全栈），计时走 `rawDt`。

---

## 决议 006 — playtimeSec 的归属（A 提出，Lead 裁定）

`SJ.Save.data.playtimeSec` **由 `SJ.Game` 单独累加，是唯一写入者**：

```js
// Game 主循环内，每帧：
if (SJ.Game.scene && SJ.Game.scene.countsPlaytime !== false) {
  SJ.Save.data.playtimeSec += SJ.Game.rawDt;
}
```

三条理由：
1. **必须用 `rawDt`**。`dt` 被 slowmo 与 hitstop 缩放过，用它会把「玩了 30 分钟」记成 20 分钟——
   而这个数字正是 DESIGN §9.6 用来验收时长的，失真就没有意义了。
2. **必须覆盖剧情段落**。全剧 188 个剧本节点占的时间不小；
   若放在 `Level.update` 里累加，对话叠加层在栈顶时 `Level.update` 不跑，这段时间会凭空消失。
3. **单一写入者**。放 Game 里只有一处 `+=`，不会出现两个模块各加一次。

**H 必须给标题画面与暂停菜单的 scene 设 `countsPlaytime = false`**（挂机不算游玩时间）。
其余 scene 默认计入，不用管。

---

## 决议 007 — 菜单与流程接口（H 提出，Lead 裁定）

### 1. 招式槽的写回：`SJ.Player.setSlot` 是唯一写入者（E 实现，H 调用）
```js
SJ.Player.setSlot(i, moveId)   // i=0..3, moveId 可为 null
// 内部：同时更新 p.slots[i] 与 SJ.Save.data.slots[i]，然后 SJ.Save.save()
```
**不采用「`p.slots` 与 `SJ.Save.data.slots` 是同一个数组引用」的方案。**
理由：`SJ.Save.load()` 会替换整个 `data` 对象，别名会在读档后**静默断开**——
之后换招只改内存不进存档，重开游戏槽位复原，而且不报错。
H 读可用招式用 `SJ.player.known`。

### 2. 死亡重生：`SJ.Level.restartFromCheckpoint()`（G 实现，H 调用）
```js
SJ.Level.restartFromCheckpoint()   // 回到本关最近检查点，不回退章节，不清存档
```
H 不需要知道检查点是怎么编码的。`SJ.Menu.gameover()` 确认后只调这一个函数。

### 3. 标题画面「始 / 继 / 音」
- **始**：`SJ.Save.reset()` → `SJ.Level.load(0)`。
  **但若已存在存档，必须二次确认**：「始」字变朱砂色，再按一次才执行。
  无字、无弹窗、不破坏三项结构 —— 只是让抹掉 30 分钟进度这件事需要按两次。
- **继**：`SJ.Level.load(SJ.Save.data.chapter)`，从章节开头进（不带检查点）。
  **无存档时变暗且不可选，但必须仍然显示**（三项结构是硬性要求）。
- **音**：静音开关，走 `SJ.Audio.setMute`。
- 标题与暂停菜单的 scene 必须设 `countsPlaytime = false`（决议 006）。

---

## 决议 008 — 敌人系统裁定（F 提出，Lead 裁定）

### 1. `SJ.Combat.lastPlayerMove` 由 combat.js 记录（E 补，F 只读）
F 发现 `lastFoeMove` 记的是「敌招打到玩家」（给玩家的「说剑」复制用），
而师兄 P3 要的是**玩家用过的招**，方向相反，目前无人记录。

**不采用 F 在 ai.js 里自己扫 `hitList` 的方案。** 改由 E 在 combat.js 补一个对称字段：
```js
// SJ.Combat.hit(o) 内部，创建 hitbox 时即记录（因此挥空也算「他见过这一招」）：
if (o.team === 'player' && o.moveId) SJ.Combat.lastPlayerMove = o.moveId;
```
理由：combat.js 是所有 hitbox 的唯一汇聚点，在这里记录只有一处定义；
让 F 在另一个模块里重建一套「什么算玩家用了一招」，两处语义迟早漂移。
**在创建时记录而非命中时记录**是有意的 —— 师兄要学的是「他见过你使这一招」，挥空也该算。

### 2. 守阁人的破防判据
- **僧人** 认 `guardBreak`（普攻第三段可破）—— 他是**提示**：告诉玩家「有人会格挡」。
- **守阁人** 无视 `guardBreak`，**只认 `opt.moveId === 'wufeng'`** —— 他是**墙**。
- 因此 **E 的 tech.js 必须给 `wufeng` 的 hitbox 传 `moveId:'wufeng'`**。

### 3. 守阁人没有失败态 —— 用倒退代替死亡，并强制可发现性
- 保持 **0 伤害**。P3 起，玩家 6 秒未伤到他则「合十」回 8 点血：**僵持会倒退，但不会死**。
- **但必须避免「玩家永远想不到该观势」的无限僵局**：
  僵持超过约 40 秒后，他的守势 telegraph 要**逐步变得更显眼**（朱砂更亮、驻留更久）。
  **用「线索变清楚」代替「伤害变高」** —— 这是本作不做教程的前提下唯一正当的引导手段。
- 无软锁保证：观势在墨 ≤20 时不再扣墨（DESIGN §9.3），所以玩家永远有能力读他的守势。

### 4. 僵直预算（战斗耐打度的总闸）
- **杂兵**：连吃 2 次硬直后进入 1.0s 霸体。
- **Boss**：**完全无视普通命中的 stun**，只吃完美观势的 0.9s 与阶段转换。
- 推论且必须保持：**完美观势是全游戏收益最高的动作**。普攻锁不住 Boss，观势能 —— 
  这条不只是平衡，它是「让玩家自己发现观势」的核心激励，不许被稀释。

### 5. 提灯人的照明
敌人实体暴露 `e.light = {r, warm}`，自己在 draw 里画 `SJ.Ink.lantern`。
**G 负责**：雪山的雾/视野受限，读 `SJ.Ent.by('foe')` 上的 `light` 字段自行处理。

---

## 决议 009 — 环境力与时长预算（G 提出，Lead 裁定）

### 1. 环境对玩家的作用：E 提供接口，G 不得直接改玩家状态
第四回的风与雪中墨耗跨了模块边界。**不许 G 直接加 `p.vx` 或直接扣墨。**

**E 补两个接口：**
```js
SJ.Player.envForce(ax, ay)   // 本帧外部加速度，累加；physics 消费后自动清零
p.inkDrainMul                // 普通字段，默认 1；G 每帧可设，E 用它乘被动墨耗
```
理由与决议 007 §1 同源：玩家状态只能有一个写入者。
G 直接改 `vx`，会和玩家自己的加速度/摩擦逻辑抢同一个字段，表现是「风时有时无」且无法复现。

### 2. 时长预算：现在不加波，等实测回填
Σ expectedSec = 2200s（36.7 分）达标；悲观端 1795s。
**不采纳「现在堆密度保底」** —— 在 F 的 AI 未实测前加波，是拿「不好玩」换「够长」。
G 已识别两个可直接拧的旋钮，wave 3 实测后按需回填：
- `c3` w4：26 → 36
- `c6` w5：40 → 50
**最脆的一根柱子**：490s 的 Boss 时间全部是对 F 的假设，一秒未实测。wave 3 必须实测校正。

### 3. playtimeSec 已归属 Game（决议 006），G 不要再加
A 已实现，`Game.step()` 里唯一一处 `+=`，用 `rawDt`，6 项测试全过。

### 4. 阶段二两条已知坑（G 自报，记录备查）
- 第四回整座山是实心块：`Level.draw` 必须用飞白/淡墨渲染山体内部，
  填死会违反 DESIGN §1「一屏纸色空白 ≥50%」。
- 第三回浮筏：`World.moveX` 不管载具，`level.js` 必须自己把筏的 dx 加给站在上面的玩家，
  否则玩家会一直往后滑。

---

## 决议 010 — 第五回摆位终裁（D 裁定文本，Lead 裁定执行）

### 1. 顺序：维持 D 的原顺序 —— `c5_book`（题眼）在前，`c5_t_page`（物证）在后
D 给出三条**文本内部**的理由，G 的数据侧看不到：
1. 反过来会烧掉 `c5_book_d`（题眼链内部的「这本书写的是我」时刻），使其从揭示降级成复述。
2. `c5_t_page_end` 的「二十年」与终回说书人的「二十年」是同一个数字，必须收在最深处。
3. 它直接喂给守阁人第一句「还手的，都写进去了」——
   物证 →「都写进去了」→「我要过去」是一条三拍链，顺序一换就断。

G 的两条顾虑由 **D 改文本解决，G 零成本**：
- 「最里一层」意象已从 `c5_book` 解绑，转给 `c5_t_page`（它现在占最深处）。
- 9 屏放在**离 Boss 最远**处，反而优于反排。

**G 只需把两个 x 坐标对调。**

### 2. ⚠️ `c5_t_page` 不允许可错过（比顺序严重一个量级）
原措辞「挂在玩家要自己走到的书架上」被合理地理解成了「玩家要自己去找」，
导致它被放进三层侧龛、需跳上去 `interact` —— **可以整关不触发**。

> **`c5_t_page` 是全剧唯一一处「说书人在撒谎」的硬证据，必须在关键路径上。**
> 保留 `interact`（「自己翻开」这个动作要留着），但**不允许可错过**。

错过它的玩家会完整通关、拿到结局，**并且永远不知道自己少了什么** ——
不可靠叙述者会静默退化成一个隐藏内容。
**G 的 `level-check.js` 必须新增一条断言：`c5_t_page` 在主路径上、不依赖任何可选跳跃或绕路。**

### 3. 第五回 9 屏的节奏（D 提供，给 H）
- `c5_book` ~ `_d`（前 4 屏）：铺陈，**快翻无损**
- `_e` ~ `_h`（题眼四屏）：需要落地
- `_i`（「像是刚写上去的」）：sting，**单独一屏**
- **翻页快、逐屏可跳，但不自动前进** —— 这段节奏必须由玩家掌握。
- 若实测仍是墙，D 可把 `_d` 并进 `_c` 压到 8 屏；**但不许预先砍**，先看真实手感。

### 4. 提灯人不得成为强制解（G 已自查修复，记录备查）
原数据把唯一的 `denglong` 放在带 gate 的波里 —— gate 要求清波才能前进，
**结构上就是必杀**，「杀了他就摸黑」这层设计当场作废。
已改为 `wave 0` 游荡兵，两处摆位，且都有不带光也过得去的走法。

---

## 决议 011 — 第五回拦路的因果（D 改文本，Lead 确认，G 执行表现层）

倒下的书架采用，但**因果方向必须是「搬」不是「读」**。

原表述「翻开那一页才过得去」因果不成立 —— 翻一页纸为什么能挪开一个书架？
玩家会把它读成 ludic gate（「游戏要我读完才放行」），
一旦读出这层，那四屏就从**「我撞见的」**变成**「系统塞给我的」**。
**这才是真正伤语气的地方，比「有没有阻力」严重。**

**已落的文本**：
```
书架倒了，横在路上。
他要过去，就得搬。
搬开的那一本，翻在第四回。
上面写着雪，写着白衣。
```

**玩家的动作是「搬」，读是搬完之后躲不掉的结果。** 保住三件事：
1. 动作是他自己做的 —— `interact` 有了实义（搬），不是过场塞给他；
2. 发现是**非自愿**的 —— 书自己摊开在那一页。无名不是个会查证的人；
3. 语气仍然轻 —— 一个人搬开挡路的东西，没有戏剧性。四屏的重量全在最后那句。

**G 的执行要求**：
- `blockers` 的 note 与 `level.js` 的表现层都要按「搬开书架」来做，**不是「读完解锁」**。
- 交互提示（若有）必须表达**搬**这个动作，绝不能出现「阅读」「查看」之类的措辞。
- 规则 15 的断言逻辑不受影响（割点 + 同层拦路照旧）。

**三句锁死，任何人不得再动**：
「他要过去，就得搬」→「还手的，都写进去了」→「我要过去」。
同一个动词隔着一场 Boss 战前对白，是链的一部分。

---

## 决议 012 — 核心机制的可发现性（全项目最高优先级设计约束）

**用户的原始要求是「不要告诉我玩法，让我逐渐探索」。**
E 提出全项目最大的风险：**没有任何一个像素在说「长按 K」**，
而 12 招里有 10 招要靠观势学 —— 相当一部分玩家可能整周目不会按那个键。

**裁定：可发现性不靠单点提示，靠三条互相独立的路径。任何一条失效，其余两条仍能兜住。**

### 路径一：挨打也会学（**不需要任何按键，这是保底**）
`combat.js:276` 已实现：被带 `moveId` 的招打中 → `Tech.gain(moveId, 12)`。
- 完美观势 34%，挨打 12% ⇒ 约 9 次挨打必然触发一次「悟」。
- **第一回的第一个刀客必须能可靠地打中玩家足够多次**（玩家 3 颗心足以承受）。
- **HUD 的残墨细环必须在第一次被打中后立刻可见** —— 玩家会看到一个环在长。
- ⇒ 即使玩家从不按 K，也一定会撞见一次「悟」。

### 路径二：「悟」的演出必须显示这一招**从谁身上来**（E 执行）
全屏定格时除招名外，必须让玩家看见来源（敌人名或其剪影）。
**这是把「挨打 → 学会」这条因果关系变得可见的唯一时刻。**
它不解释任何操作，只陈述事实 —— 不违反「不做教程」。
玩家一旦意识到「这一招是从他身上来的」，就会开始注意敌人出招，观势才有被发现的可能。

### 路径三：关卡与旁白（G + D 已有素材）
- 第一回第一个刀客：**telegraph 放长到 0.7s，并重复出招**（F 执行）。
- `c1_t_watch` 这类 trigger 摆在他旁边（G 执行）。
- 说书人的隐喻旁白与墙上题字照 STORY.md §5 教学对照表摆位。

### 视觉语言（E 已实现，记录备查，不得简化）
- 不观势：朱砂虚线断续、发抖，临出手时落点透红。
- 观势中：轨迹完整清晰，一颗光珠沿轨迹走到头，收束环闭合即命中。
- 守势型（`danger:false`）：石青色 —— 颜色本身说明「这条不打人」。

### 附：E 的两处实现层调整（Lead 批准）
1. **第三段 hitstop 90ms**（DESIGN §7 写 45ms）。110ms 会把连段切碎，退回 90ms，
   正好落在 §7 已有的「招式 90ms」档，未新增档位。批准。
2. **`envForce` 用独立的 `p.envVx` 积分，不并进 `p.vx`**。
   理由：走路摩擦 3200 会把小风当帧抹平、大风直接失控 —— 那不是旋钮，是悬崖。
   分开积分后实测稳态漂移 ≈ ax/5（ax=900 → 140px/s，逆风仍能走）。
   签名与语义完全符合决议 009，G 无感知。批准。第四回的风从 600–900 起调。

---

## 决议 013 — `SJ.FX.splash` 的签名澄清（E 发现，Lead 补入契约）

**`splash(x, y, dir, o)` 的第三参 `dir` 是弧度角，不是 `±1`。**
实现里 `base = dir; a = base + jitter; vx = cos(a)*sp` ——
传 `±1` 的后果是 `cos(1)` 与 `cos(-1)` **同号**：往左打和往右打，墨点甩向同一侧。
**全游戏的墨溅方向一直是错的，且不报错。**

**正确用法**（y 向下为正，朝斜上方甩开）：
```js
dir > 0 ? -0.6 : -(Math.PI - 0.6)
SJ.FX.splash(hx, hy, angleInRadians, { groundY: <落地高度> });
```

**`groundY` 也补进签名**（契约原文漏了）：取命中点正下方的 `SJ.World.groundAt`，
取不到才退回目标脚底 —— 目标悬空时脚底本身就在半空，墨应当继续落到真正的地面。
不传不报错，但 DESIGN §1 要的「落地晕开成墨点留 2s」会静默消失。

**这两个都属于「传错不报错、效果静默消失」的形状**，与决议 005 §3 的 `Combat.draw` 同类。
`dev/player-check.js` §7d 已钉死一条断言：**左右两侧的甩出角必须异号**。

---

# 增强波次（2026-09-07 晚）—— Lead 预先定下的跨组接口

> 参与者：T1 可靠性 / T2 战斗与人物 / T3 敌人与 Boss / T4 呈现。所有权见 `_spec/REVIEW.md` §3。
> 下面四条是 Lead 直接裁定的接口，**不必再申请**；其它跨文件签名改动照旧先发决议。

## 决议 014 — 预警分层 `telegraph.tier`（T3 打标签，T2 画）

`SJ.Combat.telegraph(o)` 新增可选字段 **`o.tier`**，取值 `'light' | 'heavy' | 'grab'`，缺省 `'light'`（完全向后兼容）。
- `light`：可格挡的普通招 —— 现状画法（墨线）。
- `heavy`：superArmor / 不可格挡的大招 —— **朱砂**线，线宽 ×1.4。
- `grab`：突进 / 抓取 —— **双线**（墨线 + 外圈淡线）。
T3 在 enemies/bosses 的招式表里给每招标 tier；T2 在 combat.js 的 telegraph 绘制里按 tier 分画。
两边都不得改 `path / dur / danger` 的语义。玩家能否格挡的**规则**不变，只是画法。

## 决议 015 — `SJ.Scenery.draw(bg, g, camX, camY, t, def)`（T4 实现，T1 接线）

新文件 `src/render/scenery.js`，加载顺序在 `fx.js` 之后、`audio.js` 之前（Lead 负责挂进 index.html / check.html 符号表）。
```js
SJ.Scenery = {
  draw: function (bg, g, camX, camY, t, def) { ... }   // bg = levels.js 的 def.bg 字符串
};
```
- 由 `level.js` 的 `drawBackground` 在 `SJ.Ink.paper(...)` **之后**调用一次，替换现有 `switch (def.bg)` 里的远景绘制；
  近景 deco / solids 仍由 level.js 画。若 `SJ.Scenery` 不存在或 `draw` 抛错，level.js 必须退回旧 switch（try/catch），游戏不许因为呈现层挂掉。
- 必须遵守 DESIGN §1：任何一屏纸色留白 ≥ 50%。T4 自证方式：`dev/drawcount.js` 风格的批量像素统计。
- `def.env / def.weather` 只读。

## 决议 016 — 存档新增 `techProgress`（T2）

`SJ.Save.defaults()` 加字段 **`techProgress: {}`**（moveId → 0–100）。`load()` 时缺省 `{}`（旧档兼容，玩家现有存档必须能直接读）。
`SJ.Tech.progress` 的**唯一真源仍在 Tech**：Tech 在进度变化时写回 `SJ.Save.data.techProgress` 并调用现有保存路径；关卡载入时从 Save 读回。
`resetProgress()` 同时清 Save 字段。决议 010（始 → Save.reset + Tech.resetProgress）不变。

## 决议 017 — `SJ.Audio.setVolume(v) / getVolume()`（T4）

`v ∈ [0,1]`，作用于 `master.gain`（当前写死 0.9 → 缺省仍 0.9）。存 `localStorage['sj_volume']`，**不进 Save 结构**。
`muted` 开关保留，语义不变。菜单里的「静音」项替换为音量条（← → 调、J 确认）。

## 三条硬规则（每个 teammate 都受约束）
1. **不改玩法、不改数值规则、不改存档结构**（决议 016 除外）。用户正在探索期。
2. **新建文件 → 告诉 Lead → Lead 挂进 index.html 和 check.html**。
3. **任何跨文件签名改动 → 先发决议**；四份 checker 交付前必须全绿。
