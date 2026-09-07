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
按依赖顺序加载：const → input → camera → world → ent → save → ink → figure → fx → audio
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
