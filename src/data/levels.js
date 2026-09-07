/* src/data/levels.js  【G · 关卡】
 * 《说剑》八关的纯数据。无副作用，不引用任何运行时状态。
 * 权威依据：_spec/DESIGN.md §3/§4/§7/§9、_spec/CONTRACTS.md 决议 002/003/004/005、
 *           _spec/STORY.md §4.0 入口 key 全表 / §4.1 第六回节拍 / §4.2 第五回摆位 / §5 教学对照。
 *
 * ── 坐标约定 ───────────────────────────────────────────────────────
 *   世界坐标 y 向下为正。solids 的 [x,y,w,h] 里 y 是**顶面**。
 *   checkpoints 的 [x,y] 里 y 是**玩家脚底所在的地面顶面 y**。
 *   deco / spawns 的 y 一律是**物件（或敌人）脚底所站的地面顶面 y**，不是包围盒左上角。
 *
 * ── solids ─────────────────────────────────────────────────────────
 *   [x, y, w, h, flag, burnAt?]
 *   flag 0=实心 1=单向 2=会消失。
 *   burnAt 只对 flag=2 有意义：火势开始（本关 fireStart 事件）之后第几秒消失。
 *   ★ 铁律：任何 flag=2 的平台底下必须还有一层实心地面，烧掉不会把玩家关死或摔出图。
 *
 * ── hazards ────────────────────────────────────────────────────────
 *   {kind, x,y,w,h, ...}
 *   kind:'water'   落水 → 扣 1 心并回到最近检查点（respawn:true）
 *   kind:'fire'    dps 持续伤害，type 'fire'；startAt = 火势开始后第几秒点着
 *   kind:'updraft' vy 向上的持续风力（第四回风口，配合 c4_t_tiyun）
 *   ★ 铁律：地面有洞的地方必须被 hazard 铺满，玩家永远不会掉出地图。level-check.js 强制。
 *
 * ── deco / pickups ─────────────────────────────────────────────────
 *   带 ink:N 的 = 可击碎回墨物件（DESIGN §9.3.3，回墨 10–15）→ SJ.Level.pickups
 *   带 refill:true 的 = 石砚（接触回满墨，一次性，重生复位，DESIGN §9.3.4）
 *   kind:'raft' = 移动浮筏，{ax,bx,period} 在 ax↔bx 之间往复，周期 period 秒
 *   其余为纯装饰（stele 题壁碑 / table / shelf / flag / pine …）
 *
 * ── triggers ───────────────────────────────────────────────────────
 *   {x,y,w,h, event, once, interact?, when?}
 *   event 是**声明式数据**（不是字符串、不是函数），便于 dev/level-check.js 静态校验：
 *       { play:'scriptKey', gain:['moveId',100], flag:['k',v], fireStart:true, music:'boss' }
 *   四个字段都可选、可组合。play 的 key 必须来自 STORY.md §4.0 的 93 个入口。
 *   interact:true  → 需要玩家按互动键（DESIGN §9.4），否则走进区域即触发
 *   when（可选，字符串枚举，非位置性布防条件）：
 *       'wave:N'      仅在第 N 波进行中（已刷出、未清完）时可触发
 *       'afterWave:N' 仅在第 N 波清完之后可触发
 *       'firstInk'    第一次积到残墨时（无位置）
 *       'firstHurt'   第一次被打中时（无位置）
 *       'burn'        第一次被火烧到时（无位置）
 *   带 when 且为 firstInk/firstHurt/burn 的 trigger 没有 x/y/w/h。
 *
 * ── waves / spawns ─────────────────────────────────────────────────
 *   spawns[i].wave = 0 表示开场就在场（游荡兵、远处的弓手）；>0 归属对应波次。
 *   waves[i] = {id, x, w, gate:[x0,x1]|null, sec, note}
 *       x/w   触发这一波的区域
 *       gate  清完之前把玩家夹在这个 x 区间内（null = 不锁）
 *       sec   预算里给这一波的秒数
 *
 * ── boss ───────────────────────────────────────────────────────────
 *   boss: null | bossId。契约的 boss 字段太薄，装不下 pre/mid/down/p2/p3 五个剧本 key，
 *   若把它们写死在 level.js 里 dev/level-check.js 就查不到——故加同级字段 bossScript（纯追加）。
 *   bossArena:[x0,x1] 战斗区间；bossMusic 'boss'|'final'。
 *   ★ 决议 002 §2 / 决议 003：Boss 倒地 → play(bossScript.down) → SJ.Story.mercyChoice(id,cb)
 *     → 回调里演出 → SJ.Level.complete() → 播 outro → 存档。G 绝不自己写 save.mercy。
 *
 * ── 时长预算（DESIGN §9.6，硬性）────────────────────────────────────
 *   每关必填 expectedSec 与 encounters，budget 字段写清依据。
 *   走路按 240px/s 计（DESIGN §7 走速）；剧情按 **3.4 秒/屏** 计
 *   （屏数由 dev/level-check.js 直接遍历 script.js 的链算出，不是拍脑袋）。
 *   全部 expectedSec 之和 ≥ 1800。见 _spec/notes-G.md 的总表与两端敏感性分析。
 */
(function (SJ) {
  'use strict';

  SJ.Levels = [

  /* ══════════════════════════════════════════════════════════════════
   * 0 · 楔子「醒木」 —— 无战斗。教走 / 跳 / 互动。
   *   结构：雨夜长街（0–1300，两处水洼要跳）→ 推门（p_door，第一次用互动键）
   *        → 茶馆内（1300–3600）四个可互动的人 → 靠窗空座坐下 → 醒木一响翻页。
   *   教学：跳（街上两块垫脚石）、互动（门 / 茶博士 / 老客 / 孩子 / 座位）。
   *   时长预算：走 3600px÷240 = 15s + 剧情 13 屏×3.4 = 44s
   *            + 找人/推门/回头/坐下这类无速度的操作 ≈ 35s + 翻页演出 10s ≈ 104s → 105s
   * ══════════════════════════════════════════════════════════════════ */
  {
    id: 'p', title: '醒木', chapter: 0,
    music: 'tea', weather: 'rain', bg: 'tea',
    w: 3600, h: 540,
    env: {},

    solids: [
      [0, 470, 3600, 70, 0],        // 街与茶馆共用的地面
      [600, 410, 130, 60, 0],       // 水洼里的垫脚石（第一次跳）
      [900, 410, 140, 60, 0],       // 第二块（连跳）
      [1286, 440, 26, 30, 0],       // 门槛：小台阶，进门时自然抬一下脚
      [3380, 380, 220, 90, 0]       // 说书人的台
    ],

    hazards: [],

    deco: [
      { kind: 'lantern', x: 1180, y: 470 },
      { kind: 'lantern', x: 1420, y: 470 },
      { kind: 'lantern', x: 2600, y: 470 },
      { kind: 'lantern', x: 3320, y: 470 },
      { kind: 'table', x: 1700, y: 470 },
      { kind: 'table', x: 2150, y: 470 },
      { kind: 'table', x: 2760, y: 470 },
      { kind: 'table', x: 3180, y: 470 },   // 靠窗那张——终回还会再见
      { kind: 'seat', x: 3230, y: 470 }
    ],

    spawns: [],
    waves: [],

    checkpoints: [[100, 470], [1400, 470]],

    triggers: [
      { x: 1240, y: 380, w: 110, h: 90, interact: true, once: true, event: { play: 'p_door' } },
      { x: 1690, y: 390, w: 110, h: 80, interact: true, once: true, event: { play: 'p_chake' } },
      { x: 2100, y: 390, w: 150, h: 80, once: true, event: { play: 'p_kelao' } },      // 走过听见
      { x: 2300, y: 390, w: 100, h: 80, interact: true, once: true, event: { play: 'p_kelao_b' } }, // 停下来听
      { x: 2750, y: 390, w: 110, h: 80, interact: true, once: true, event: { play: 'p_child' } },
      { x: 3130, y: 390, w: 130, h: 80, once: true, event: { play: 'p_sit' } }
    ],

    boss: null, bossScript: null, bossArena: null, bossMusic: null,
    intro: 'p_intro', outro: 'p_outro', exitX: 3320,

    expectedSec: 105, encounters: 0,
    budget: { walk: 15, waves: 0, boss: 0, story: 44, other: 46,
              note: '13 屏；无战斗，时间全在走动、四次互动与翻页演出上' }
  },

  /* ══════════════════════════════════════════════════════════════════
   * 1 · 第一回「竹林听雨」 —— 教普攻、跳、身法、观势。
   *   教学摆位（STORY §5）：
   *     c1_t_watch(700) 讲「停的那一下，招已经画在空里了」→ 紧接第一个刀客（760 起手式）
   *     wall_c1_a(790)「未出鞘 先见招」双保险
   *     c1_t_ink(1380)  第一波打完、墨已经掉下去了才说「要添墨只有一个法子——往前」
   *     c1_t_dash(2300) 紧贴第三波：那一波有力士的直线冲撞，只能穿过去
   *     wall_c1_b(2200)「挨打亦是学」+ learn_hurt（第一次挨打时）
   *   敌人配置教什么：
   *     w1 单个刀客 —— 看清一次起手式
   *     w2 两个刀客 —— 两条起手式重叠，逼你选一个观
   *     w3 刀客×2 + 力士 —— 力士直线冲撞，观势格不划算，要身法穿过去
   *     w4 刀客×3 —— 密度，墨会真的枯，逼你进攻回墨
   *   时长预算：走 4200÷240 = 18s + 4 场遭遇(14+22+26+32 = 94s)
   *            + Boss 雨中刀 70s + 剧情 18 屏×3.4 = 61s ≈ 243s → 245s
   * ══════════════════════════════════════════════════════════════════ */
  {
    id: 'c1', title: '竹林听雨', chapter: 1,
    music: 'bamboo', weather: 'rain', bg: 'bamboo',
    w: 4200, h: 600,
    env: {},

    solids: [
      [0, 470, 4200, 130, 0],       // 连续地面：第一回不设坑，玩家死于人手不死于地形
      [820, 410, 140, 60, 0],       // 土坡
      [1180, 380, 120, 90, 0],      // 岩
      [1500, 360, 150, 14, 1],      // 倒竹（单向）
      [1740, 300, 150, 14, 1],
      [2400, 410, 180, 60, 0],
      [3050, 360, 160, 14, 1],
      [3300, 300, 150, 14, 1]
    ],

    hazards: [],

    deco: [
      { kind: 'stele', x: 790, y: 470 },       // wall_c1_a 的碑
      { kind: 'stele', x: 2200, y: 470 },      // wall_c1_b 的碑
      { kind: 'bamboo', x: 500, y: 470, ink: 12 },
      { kind: 'bamboo', x: 1050, y: 470, ink: 12 },
      { kind: 'bamboo', x: 1600, y: 470, ink: 12 },
      { kind: 'bamboo', x: 2050, y: 470, ink: 12 },
      { kind: 'bamboo', x: 2620, y: 470, ink: 12 },
      { kind: 'bamboo', x: 3150, y: 470, ink: 12 },
      { kind: 'bamboo', x: 3700, y: 470, ink: 12 },
      { kind: 'pine', x: 300, y: 470 },
      { kind: 'pine', x: 2900, y: 470 }
    ],

    spawns: [
      { type: 'daoke', x: 1150, y: 470, wave: 1 },

      { type: 'daoke', x: 1800, y: 470, wave: 2 },
      { type: 'daoke', x: 1940, y: 470, wave: 2 },

      { type: 'daoke', x: 2490, y: 410, wave: 3 },   // 站在岩上，居高临下
      { type: 'daoke', x: 2720, y: 470, wave: 3 },
      { type: 'lishi', x: 2640, y: 470, wave: 3 },   // 直线冲撞 → 教身法

      { type: 'daoke', x: 3260, y: 470, wave: 4 },
      { type: 'daoke', x: 3400, y: 470, wave: 4 },
      { type: 'daoke', x: 3160, y: 360, wave: 4 }    // 从倒竹上跳下来
    ],

    waves: [
      { id: 1, x: 860, w: 60, gate: [780, 1320], sec: 14, note: '一个刀客，一条起手式，看清就行' },
      { id: 2, x: 1560, w: 60, gate: [1450, 2000], sec: 22, note: '两条起手式重叠，逼你挑一个观' },
      { id: 3, x: 2350, w: 60, gate: [2250, 2820], sec: 26, note: '力士直线冲撞，观势格不划算 → 身法穿过' },
      { id: 4, x: 3040, w: 60, gate: [2950, 3540], sec: 32, note: '三人，密度足以把墨打枯一次' }
    ],

    checkpoints: [[100, 470], [1420, 470], [2880, 470], [3620, 470]],

    triggers: [
      { x: 680, y: 380, w: 90, h: 90, once: true, event: { play: 'c1_t_watch' } },
      { x: 780, y: 380, w: 90, h: 90, interact: true, once: true, event: { play: 'wall_c1_a' } },
      { x: 1360, y: 380, w: 120, h: 90, once: true, event: { play: 'c1_t_ink' } },
      { x: 2190, y: 380, w: 90, h: 90, interact: true, once: true, event: { play: 'wall_c1_b' } },
      { x: 2290, y: 380, w: 90, h: 90, once: true, event: { play: 'c1_t_dash' } },
      { x: 2880, y: 380, w: 110, h: 90, once: true, event: { play: 'c1_t_rain' } },
      { x: 3600, y: 380, w: 80, h: 90, once: true, event: { play: 'c1_boss_pre', music: 'boss' } },
      { when: 'firstInk', once: true, event: { play: 'learn_ink' } },
      { when: 'firstHurt', once: true, event: { play: 'learn_hurt' } }
    ],

    boss: 'yuzhongdao',
    bossScript: { pre: 'c1_boss_pre', mid: null, down: 'c1_boss_down', p2: null, p3: null },
    bossArena: [3620, 4200], bossY: 470, bossMusic: 'boss',
    intro: 'c1_intro', outro: 'c1_outro', exitX: 4150,

    expectedSec: 245, encounters: 5,
    budget: { walk: 18, waves: 94, boss: 70, story: 61, other: 2,
              note: '18 屏（含 learn_ink/learn_hurt）；遭遇 14+22+26+32；Boss 两阶段 70s' }
  },

  /* ══════════════════════════════════════════════════════════════════
   * 2 · 第二回「断桥客栈」 —— 垂直空间、单向平台、隘口、可击碎灯笼、远程压制。
   *   动线是一条螺旋（这是本关最重要的结构决定）：
   *       断桥 → 一层向右走到底(820→3300) → 楼梯上二层 → 二层向左折返(3630→1290)
   *       → 楼梯上三层 → 三层向右走到底(1400→3800) → 阁楼 · 铁笛先生
   *   为什么是螺旋：客栈只有 4000px 宽，直着走 17 秒就没了。折回来两趟把实际步行拉到
   *   7100px（≈30s），而且每一层都能看见另外两层在打什么——垂直空间才有意义。
   *   ★ 螺旋还顺手解决了「gate + 单向平台 = 软锁」这个陷阱：
   *     每一波的 gate 都把该层的楼梯**包在里面**，玩家从单向平台掉下去永远爬得回来。
   *     dev/level-check.js 的可达性检查会替我盯死这条。
   *   教学摆位：
   *     c2_t_up(1900)     第一块单向平台（2350 的挑台）之前 ——「踩上去是路，踩不住就是下一层」
   *     c2_t_lantern(1100)/wall_c2_a(1240) 紧贴一层第一串灯笼 ——「碎一盏 得一滴」
   *     c2_t_multi(3200)/wall_c2_b(3160)   紧贴上二层的楼梯口 ——「站对地方，人就得排着来」
   *   敌人配置教什么：
   *     w2 弓手站 2350 的挑台上往下射 → 第一次「退无可退」；挑台够得着（120px），
   *        所以答案是爬上去，不是硬吃——远程不是无解，是要换位置
   *     w3 楼梯口：力士+两个刀客只能排着下来，站在梯下就是赚的
   *     w4 二层长廊两端交叉火力 + 两个立柜掩体 → 掩体的价值
   *     w5 三层四人杂烩，Boss 前最后一次回墨
   *   时长预算：实际步行 7140÷240 = 30s + 三次爬升 8s
   *            + 5 场遭遇(20+26+30+28+34 = 138s) + Boss 铁笛先生 80s
   *            + 剧情 16 屏×3.4 = 54s ≈ 310s → 300s（取保守值）
   * ══════════════════════════════════════════════════════════════════ */
  {
    id: 'c2', title: '断桥客栈', chapter: 2,
    music: 'inn', weather: 'rain', bg: 'inn',
    w: 4000, h: 900,
    env: {},

    solids: [
      [0, 760, 340, 140, 0],           // 东岸
      [470, 700, 110, 14, 1],          // 断桥残板（单向）
      [700, 760, 120, 140, 0],         // 桥头
      [820, 820, 3180, 80, 0],         // 一层地面：一直铺到 4000，绝不留洞
      [3690, 600, 30, 220, 0],         // 一层尽头的墙：过不去，只能上楼

      [2350, 700, 200, 16, 1],         // 挑台：弓手站这儿；离一层 120px，跳得上去
      // 一层 → 二层（在一层最右端，走到底才上得去）
      [3300, 760, 90, 14, 1],
      [3420, 706, 90, 14, 1],
      [3540, 652, 90, 14, 1],
      [900, 600, 2740, 18, 1],         // 二层长廊（900–3640），向左折返
      [1800, 540, 40, 60, 0],          // 立柜掩体
      [2600, 540, 40, 60, 0],
      // 二层 → 三层（在二层最左端）
      [960, 540, 90, 14, 1],
      [1080, 486, 90, 14, 1],
      [1200, 434, 90, 14, 1],
      [1400, 380, 2600, 40, 0]         // 三层（实心，1400–4000）；最右端是铁笛先生的阁楼
    ],

    hazards: [
      { kind: 'water', x: 340, y: 830, w: 360, h: 70, respawn: true } // 桥下的河，落下即回检查点
    ],

    deco: [
      { kind: 'stele', x: 1240, y: 820 },
      { kind: 'stele', x: 3160, y: 820 },
      { kind: 'lantern', x: 950, y: 820, ink: 12 },
      { kind: 'lantern', x: 1150, y: 820, ink: 12 },
      { kind: 'lantern', x: 1600, y: 820, ink: 12 },
      { kind: 'lantern', x: 2050, y: 820, ink: 12 },
      { kind: 'lantern', x: 2500, y: 820, ink: 12 },
      { kind: 'lantern', x: 2950, y: 820, ink: 12 },
      { kind: 'lantern', x: 3400, y: 820, ink: 12 },
      { kind: 'jar', x: 2450, y: 700, ink: 14 },
      { kind: 'jar', x: 1300, y: 600, ink: 14 },
      { kind: 'jar', x: 2200, y: 600, ink: 14 },
      { kind: 'jar', x: 3100, y: 600, ink: 14 },
      { kind: 'lantern', x: 1500, y: 380, ink: 12 },
      { kind: 'lantern', x: 2500, y: 380, ink: 12 },
      { kind: 'lantern', x: 3500, y: 380, ink: 12 },
      { kind: 'table', x: 1700, y: 820 },
      { kind: 'table', x: 2800, y: 820 }
    ],

    spawns: [
      { type: 'daoke', x: 1150, y: 820, wave: 1 },
      { type: 'daoke', x: 1320, y: 820, wave: 1 },

      { type: 'daoke', x: 2150, y: 820, wave: 2 },
      { type: 'daoke', x: 2320, y: 820, wave: 2 },
      { type: 'gongshou', x: 2450, y: 700, wave: 2 },   // 挑台上往下射：退无可退，但爬得上去

      { type: 'lishi', x: 3400, y: 820, wave: 3 },      // 楼梯口，只能排着下来
      { type: 'daoke', x: 3550, y: 820, wave: 3 },
      { type: 'daoke', x: 3200, y: 820, wave: 3 },

      { type: 'gongshou', x: 1400, y: 600, wave: 4 },   // 二层长廊两端交叉火力
      { type: 'gongshou', x: 3100, y: 600, wave: 4 },
      { type: 'daoke', x: 2100, y: 600, wave: 4 },

      { type: 'daoke', x: 1600, y: 380, wave: 5 },
      { type: 'daoke', x: 1800, y: 380, wave: 5 },
      { type: 'lishi', x: 2000, y: 380, wave: 5 },
      { type: 'gongshou', x: 2200, y: 380, wave: 5 }
    ],

    waves: [
      { id: 1, x: 880, w: 60, gate: [820, 1500], sec: 20, note: '一层两个刀客，先把手感和灯笼串起来' },
      { id: 2, x: 2000, w: 60, gate: [820, 2600], sec: 26, note: '弓手在挑台上：第一次退无可退，答案是爬上去' },
      { id: 3, x: 3180, w: 60, gate: [820, 3690], sec: 30, note: '楼梯口隘口，三人只能排着下来' },
      { id: 4, x: 3020, w: 60, gate: [900, 3640], sec: 28, note: '二层长廊两端交叉火力，逼你贴立柜（gate 含两处楼梯，掉下去爬得回来）' },
      { id: 5, x: 1500, w: 60, gate: [1400, 3400], sec: 34, note: '三层四人杂烩，Boss 前最后一次回墨' }
    ],

    checkpoints: [[100, 760], [2100, 820], [1500, 600], [1450, 380]],

    triggers: [
      { x: 1080, y: 730, w: 110, h: 90, once: true, event: { play: 'c2_t_lantern' } },
      { x: 1230, y: 730, w: 90, h: 90, interact: true, once: true, event: { play: 'wall_c2_a' } },
      { x: 1880, y: 730, w: 110, h: 90, once: true, event: { play: 'c2_t_up' } },
      { x: 3150, y: 730, w: 90, h: 90, interact: true, once: true, event: { play: 'wall_c2_b' } },
      { x: 3190, y: 730, w: 110, h: 90, once: true, event: { play: 'c2_t_multi' } },
      { x: 3420, y: 290, w: 90, h: 90, once: true, event: { play: 'c2_boss_pre', music: 'boss' } }
    ],

    boss: 'dizi',
    bossScript: { pre: 'c2_boss_pre', mid: 'c2_boss_mid', down: 'c2_boss_down', p2: null, p3: null },
    bossArena: [3400, 4000], bossY: 380, bossMusic: 'boss',
    intro: 'c2_intro', outro: 'c2_outro', exitX: 3950,

    expectedSec: 300, encounters: 6,
    budget: { walk: 38, waves: 138, boss: 80, story: 54, other: -10,
              note: '16 屏；螺旋动线实际步行 7140px=30s + 爬升 8s；遭遇 20+26+30+28+34；Boss 三阶段远程 80s' }
  },

  /* ══════════════════════════════════════════════════════════════════
   * 3 · 第三回「长河渡」 —— 平台跳跃为主、弓手压制、浮筏移动平台。
   *   ★ DESIGN §9.3 墨的保底重点关：战斗稀疏，必须沿路每 ≤600px 一个可击碎回墨物件，
   *     另放 3 个石砚（1900 中洲一 / 3300 中洲二 / 4080 西岸），否则玩家会枯墨卡在筏上。
   *   结构：东岸（0–720）→ 桥桩链 → 浮筏一（1430–1780）→ 中洲一（1780–2200，弓手战 + 石砚）
   *        → 桥桩链 → 浮筏二（2850–3200）→ 中洲二（3200–3600，混战 + 石砚）
   *        → 桥桩 → 西岸（4010–4600）渡口老翁。
   *   教学摆位：
   *     wall_c3_b(700)  「水急 勿立」—— 站在筏上不动会漂走
   *     c3_t_wind(660)   上筏之前的场景铺垫
   *     c3_t_raft(1400)  紧贴第一张浮筏
   *     c3_t_gong(1750)  紧贴中洲一的弓手波：「一阵与一阵之间，有个空」
   *     c3_t_yan(2100)   afterWave:2 —— 先把墨打枯，再让你看见石砚，才教得会
   *     wall_c3_a(2160) 「洗 笔」双保险
   *   两个游荡弓手（wave 0）站在 2760 / 3680 的桩上：过浮筏时一直有压力，
   *   但没有 gate，玩家可以选择先冲过去还是先跳上去把他做掉 —— 这是本关唯一的战术自由度。
   *   时长预算：走 4600÷240 = 19s + 跳桩/等筏（筏周期 4s，两处至少各等半程）≈ 45s
   *            + 4 场遭遇(24+28+30+26 = 108s) + 游荡弓手贡献 28s + Boss 老翁 75s
   *            + 剧情 17 屏×3.4 = 58s ≈ 333s → 330s
   * ══════════════════════════════════════════════════════════════════ */
  {
    id: 'c3', title: '长河渡', chapter: 3,
    music: 'river', weather: 'wind', bg: 'river',
    w: 4600, h: 760,
    env: {},

    solids: [
      [0, 600, 720, 160, 0],           // 东岸
      // 桥桩链一（桩宽 110，间距 130，满跳水平 144px 富余）
      [840, 560, 110, 200, 0],
      [1080, 520, 110, 240, 0],
      [1320, 580, 110, 180, 0],
      // —— 浮筏一：1430 ↔ 1780 的断口，只能靠筏过 ——
      [1780, 560, 420, 200, 0],        // 中洲一
      // 桥桩链二
      [2260, 540, 110, 220, 0],
      [2500, 580, 110, 180, 0],
      [2740, 500, 110, 260, 0],
      // —— 浮筏二：2850 ↔ 3200 ——
      [3200, 540, 400, 220, 0],        // 中洲二
      // 桥桩链三
      [3660, 580, 110, 180, 0],
      [3900, 540, 110, 220, 0],
      [4010, 580, 590, 180, 0]         // 西岸 · 渡口
    ],

    hazards: [
      { kind: 'water', x: 720, y: 690, w: 3290, h: 70, respawn: true }  // 整条河底，铺满，永不掉出图
    ],

    deco: [
      { kind: 'raft', x: 1450, y: 620, w: 150, h: 18, ax: 1450, bx: 1640, period: 4.0 },
      { kind: 'raft', x: 2870, y: 600, w: 150, h: 18, ax: 2870, bx: 3060, period: 4.4 },
      { kind: 'yan', x: 2110, y: 560, refill: true },   // 石砚一（中洲一，w2 打完就在脚边）
      { kind: 'yan', x: 3300, y: 540, refill: true },   // 石砚二（中洲二）
      { kind: 'yan', x: 4080, y: 580, refill: true },   // 石砚三（Boss 前）
      { kind: 'stele', x: 700, y: 600 },
      { kind: 'stele', x: 2160, y: 560 },
      // 回墨物件：沿 x 铺满，最大间距 360px（DESIGN §9.3.3 要求 ≤600）
      { kind: 'jar', x: 250, y: 600, ink: 12 },
      { kind: 'jar', x: 520, y: 600, ink: 12 },
      { kind: 'basket', x: 880, y: 560, ink: 12 },
      { kind: 'basket', x: 1140, y: 520, ink: 12 },
      { kind: 'basket', x: 1360, y: 580, ink: 12 },
      { kind: 'buoy', x: 1560, y: 470, ink: 15 },       // 挂在竿上的浮标，跳起来打
      { kind: 'jar', x: 1850, y: 560, ink: 12 },
      { kind: 'jar', x: 2040, y: 560, ink: 12 },
      { kind: 'basket', x: 2300, y: 540, ink: 12 },
      { kind: 'basket', x: 2540, y: 580, ink: 12 },
      { kind: 'basket', x: 2790, y: 500, ink: 12 },
      { kind: 'buoy', x: 2980, y: 450, ink: 15 },
      { kind: 'jar', x: 3260, y: 540, ink: 12 },
      { kind: 'jar', x: 3470, y: 540, ink: 12 },
      { kind: 'basket', x: 3700, y: 580, ink: 12 },
      { kind: 'basket', x: 3940, y: 540, ink: 12 },
      { kind: 'jar', x: 4160, y: 580, ink: 12 },
      { kind: 'jar', x: 4400, y: 580, ink: 12 }
    ],

    spawns: [
      { type: 'gongshou', x: 2790, y: 500, wave: 0 },   // 游荡弓手：过筏全程有压力
      { type: 'gongshou', x: 3710, y: 580, wave: 0 },

      { type: 'daoke', x: 420, y: 600, wave: 1 },
      { type: 'daoke', x: 580, y: 600, wave: 1 },

      { type: 'gongshou', x: 1880, y: 560, wave: 2 },
      { type: 'gongshou', x: 2140, y: 560, wave: 2 },
      { type: 'daoke', x: 2010, y: 560, wave: 2 },

      { type: 'qiangbing', x: 3280, y: 540, wave: 3 },
      { type: 'gongshou', x: 3540, y: 540, wave: 3 },
      { type: 'daoke', x: 3400, y: 540, wave: 3 },

      { type: 'daoke', x: 4120, y: 580, wave: 4 },
      { type: 'daoke', x: 4260, y: 580, wave: 4 },
      { type: 'lishi', x: 4190, y: 580, wave: 4 }
    ],

    waves: [
      { id: 1, x: 340, w: 60, gate: [0, 720], sec: 24, note: '东岸热身，把跳跃与普攻串起来' },
      { id: 2, x: 1800, w: 60, gate: [1780, 2200], sec: 28, note: '中洲一：两个弓手齐射，读齐射的空' },
      { id: 3, x: 3210, w: 60, gate: [3200, 3600], sec: 30, note: '中洲二：枪兵+弓手+刀客，三种起手式同场' },
      { id: 4, x: 4020, w: 60, gate: [4010, 4320], sec: 26, note: '西岸前哨，Boss 前最后一次回墨' }
    ],

    checkpoints: [[100, 600], [2100, 560], [3300, 540], [4060, 580]],

    triggers: [
      { x: 560, y: 510, w: 90, h: 90, once: true, event: { play: 'c3_t_wind' } },
      { x: 660, y: 510, w: 60, h: 90, interact: true, once: true, event: { play: 'wall_c3_b' } },
      { x: 1370, y: 490, w: 70, h: 100, once: true, event: { play: 'c3_t_raft' } },
      { x: 1740, y: 470, w: 90, h: 100, once: true, event: { play: 'c3_t_gong' } },
      { x: 2080, y: 470, w: 110, h: 100, once: true, when: 'afterWave:2', event: { play: 'c3_t_yan' } },
      { x: 2150, y: 470, w: 90, h: 100, interact: true, once: true, event: { play: 'wall_c3_a' } },
      { x: 4290, y: 490, w: 80, h: 100, once: true, event: { play: 'c3_boss_pre', music: 'boss' } }
    ],

    boss: 'laoweng',
    bossScript: { pre: 'c3_boss_pre', mid: 'c3_boss_mid', down: 'c3_boss_down', p2: null, p3: null },
    bossArena: [4010, 4600], bossY: 580, bossMusic: 'boss',
    intro: 'c3_intro', outro: 'c3_outro', exitX: 4550,

    expectedSec: 330, encounters: 6,
    budget: { walk: 64, waves: 136, boss: 75, story: 58, other: -3,
              note: '17 屏；走 19s + 跳桩等筏 45s；遭遇 24+28+30+26 + 游荡弓手 28；Boss 老翁 75s' }
  },

  /* ══════════════════════════════════════════════════════════════════
   * 4 · 第四回「雪照山门」 —— 风雪推人 + 墨在雪中消耗加快 + 视野受限。
   *   ★ DESIGN §9.2 非战斗学招：2800–2960 是断崖，唯一的过法是站进风口被吹上去，
   *     风口 trigger 调 SJ.Tech.gain('tiyun',100)。不给任何文字说明，只有藤黄一闪 + 竖排招名。
   *     断崖底部另铺了一层实心地面 [2800,1240,...]：就算玩家往下掉也只是被风重新托起，
   *     绝不会掉出地图，也绝不会卡死在坑里（updraft 常开）。
   *   ★ c4_mid（说反第一回）挂在 afterWave:2、x=2050 —— 半山腰，画外音，不打断成过场（决议 003 §3）。
   *   ★ 决议 008 §5 视野受限：提灯人 e.light 是雪山唯一的光源，两个都是 wave 0 游荡兵。
   *     绝不能把他们放进带 gate 的波 —— 「清完才能走」＝「必须杀」，那这层选择就废了。
   *     #1 摆在断崖/风口前（光值钱的地方），#2 摆在最后一段爬升；两处不带光也过得去。
   *   教学摆位：
   *     c4_t_ink(300)   开场就说「走得越慢，掉得越多」，此时风已经在推
   *     wall_c4_b(480)  「慢者 冻」
   *     c4_t_lost(1380) 紧贴 w2 的刺客（看不见的东西还在那里）
   *     c4_t_deng(2580) 第一次撞见游荡的提灯人（不在任何一波里，见 spawns 注释）
   *     wall_c4_a(2760) 「风起处 可借一步」—— 就刻在风口前那块石头上
   *     c4_t_tiyun      风口区域内，gain('tiyun',100)
   *     c4_t_men(3880)  山门
   *   时长预算：走 4400÷240 = 18s + 逆风爬升（风把走速削掉约三分之一）+ 风口 ≈ 40s
   *            + 4 场遭遇(22+28+32+30 = 112s) + Boss 白衣（分身）85s
   *            + 剧情 21 屏×3.4 = 71s ≈ 326s → 325s
   * ══════════════════════════════════════════════════════════════════ */
  {
    id: 'c4', title: '雪照山门', chapter: 4,
    music: 'snow', weather: 'snow', bg: 'snow',
    w: 4400, h: 1300,
    env: { windAx: -150, inkDrainMul: 1.6 },   // 风向左推；雪中墨耗 ×1.6（DESIGN §4 第四回）

    solids: [
      [0, 1180, 600, 120, 0],
      [600, 1120, 420, 180, 0],
      [1020, 1060, 380, 240, 0],
      [1400, 1000, 400, 300, 0],
      [1800, 940, 360, 360, 0],
      [2160, 860, 340, 440, 0],
      [2500, 780, 300, 520, 0],
      // —— 断崖 2800–2960：靠风口上去 ——
      [2800, 1240, 160, 60, 0],        // 崖底兜底：掉下去也不出图，风会把你重新托起
      [2960, 620, 340, 680, 0],
      [3300, 540, 320, 760, 0],
      [3620, 440, 300, 860, 0],
      [3920, 340, 480, 960, 0],        // 山门平台 · 白衣的场子
      // 半山几段单向石阶，给刺客与玩家一点立体空间
      [1560, 880, 140, 14, 1],
      [2280, 760, 140, 14, 1],
      [3060, 500, 140, 14, 1],
      [3720, 320, 140, 14, 1]
    ],

    hazards: [
      { kind: 'updraft', x: 2800, y: 640, w: 160, h: 600, vy: -1300 }  // 风口：常开
    ],

    deco: [
      { kind: 'stele', x: 480, y: 1180 },
      { kind: 'stele', x: 2760, y: 780 },      // wall_c4_a 就刻在风口前这块石头上
      { kind: 'pine', x: 320, y: 1180 },
      { kind: 'pine', x: 1250, y: 1060 },
      { kind: 'pine', x: 2320, y: 860 },
      { kind: 'pine', x: 3450, y: 540 },
      { kind: 'snowpile', x: 200, y: 1180, ink: 12 },
      { kind: 'snowpile', x: 700, y: 1120, ink: 12 },
      { kind: 'snowpile', x: 1160, y: 1060, ink: 12 },
      { kind: 'snowpile', x: 1620, y: 1000, ink: 12 },
      { kind: 'snowpile', x: 2020, y: 940, ink: 12 },
      { kind: 'snowpile', x: 2400, y: 860, ink: 12 },
      { kind: 'snowpile', x: 2700, y: 780, ink: 12 },
      { kind: 'snowpile', x: 3060, y: 620, ink: 12 },
      { kind: 'snowpile', x: 3400, y: 540, ink: 12 },
      { kind: 'snowpile', x: 3760, y: 440, ink: 12 },
      { kind: 'snowpile', x: 4080, y: 340, ink: 12 },
      { kind: 'snowpile', x: 4320, y: 340, ink: 12 }
    ],

    spawns: [
      // ★ 提灯人是游荡的（wave 0），不属于任何一波 —— 决议 008 §5。
      //   放进带 gate 的波里，「清完才能走」就等于「必须杀」，那这一关最好的那层选择就没了：
      //   雪山唯一的光源是他，你杀了他视野就没了，留着他他就一直跟着你打。
      //   两个的摆位都挑在「光值钱」的地方，但两处都有不带光也过得去的走法，不做强制解。
      { type: 'denglong', x: 2700, y: 780, wave: 0 },  // 就在断崖/风口前那块台上：他活着，那一跳看得见
      { type: 'denglong', x: 3450, y: 540, wave: 0 },  // 最后一段爬升

      { type: 'daoke', x: 780, y: 1120, wave: 1 },
      { type: 'daoke', x: 930, y: 1120, wave: 1 },

      { type: 'cike', x: 1620, y: 1000, wave: 2 },     // 瞬移刺客 + 视野受限
      { type: 'daoke', x: 1740, y: 1000, wave: 2 },

      { type: 'daoke', x: 2260, y: 860, wave: 3 },
      { type: 'daoke', x: 2440, y: 860, wave: 3 },
      { type: 'gongshou', x: 2320, y: 760, wave: 3 },

      { type: 'cike', x: 3400, y: 540, wave: 4 },
      { type: 'cike', x: 3560, y: 540, wave: 4 },
      { type: 'lishi', x: 3700, y: 440, wave: 4 },
      { type: 'daoke', x: 3840, y: 440, wave: 4 }
    ],

    waves: [
      { id: 1, x: 560, w: 60, gate: [400, 1020], sec: 22, note: '逆风打两个刀客：先体会风把节奏拖慢' },
      { id: 2, x: 1420, w: 60, gate: [1400, 1800], sec: 28, note: '刺客瞬移 + 雪幕：看不见的还在那里' },
      { id: 3, x: 2180, w: 60, gate: [2160, 2500], sec: 28, note: '雪幕里的三人组；此时第一个提灯人就在前面 200px，光要不要留是玩家自己的事' },
      { id: 4, x: 3320, w: 60, gate: [3300, 3920], sec: 30, note: '山门下最后一波，两个刺客夹一个力士' }
    ],

    checkpoints: [[80, 1180], [1450, 1000], [2560, 780], [3960, 340]],

    triggers: [
      { x: 260, y: 1090, w: 110, h: 90, once: true, event: { play: 'c4_t_ink' } },
      { x: 470, y: 1090, w: 90, h: 90, interact: true, once: true, event: { play: 'wall_c4_b' } },
      { x: 1410, y: 910, w: 110, h: 90, once: true, event: { play: 'c4_t_lost' } },
      // ★ 关卡内矛盾：半山腰，第二波打完之后，画外音说反第一回（STORY §2 / 决议 003 §3）
      { x: 2020, y: 850, w: 120, h: 90, once: true, when: 'afterWave:2', event: { play: 'c4_mid' } },
      { x: 2580, y: 690, w: 110, h: 90, once: true, event: { play: 'c4_t_deng' } },  // 第一次撞见提灯人
      { x: 2740, y: 690, w: 90, h: 90, interact: true, once: true, event: { play: 'wall_c4_a' } },
      // ★ 非战斗学招：站进风口 → 踏云（DESIGN §9.2）
      { x: 2800, y: 700, w: 160, h: 540, once: true, event: { play: 'c4_t_tiyun', gain: ['tiyun', 100] } },
      { x: 3930, y: 250, w: 90, h: 90, once: true, event: { play: 'c4_t_men' } },
      { x: 4040, y: 250, w: 80, h: 90, once: true, event: { play: 'c4_boss_pre', music: 'boss' } }
    ],

    boss: 'baiyi',
    bossScript: { pre: 'c4_boss_pre', mid: 'c4_boss_mid', down: 'c4_boss_down', p2: null, p3: null },
    bossArena: [3920, 4400], bossY: 340, bossMusic: 'boss',
    intro: 'c4_intro', outro: 'c4_outro', exitX: 4350,

    expectedSec: 325, encounters: 6,
    budget: { walk: 58, waves: 118, boss: 85, story: 71, other: -7,
              note: '21 屏（含 c4_mid 3 屏）；逆风走速约 ×0.66，18s 的路走成 40s+；遭遇 22+28+28+30 + 游荡提灯人 10；Boss 白衣分身 85s' }
  },

  /* ══════════════════════════════════════════════════════════════════
   * 5 · 第五回「藏经阁」 —— 战斗少、压迫多；火会烧纸，地形随时间消失。
   *
   *   ★ 顺序按 STORY.md §4.2（D 裁定，驳回我原来的「先物证后题眼」）：
   *       c5_t_shelf(560, 一层)  满楼是同一本书的抄本 —— 后两条的前提
   *       → w1 → 火起 → 上二层 →
   *       c5_book(1990, 二层主路径, 9 屏)  题眼：这是教人怎么讲好故事的书
   *       → 上三层 → w2 + c5_t_burn 火势推进 → 上顶层 →
   *       c5_t_page(3530, 顶层最深处, 4 屏)  物证：书里写着第四回，且写错
   *       → w3 → c5_boss_pre → 守阁人
   *     D 的三条理由我接受：① 反过来会把 c5_book_d「这本书写的是我」从揭示降级成复述；
   *     ② 物证「纸是旧的，至少有二十年了」与终回「讲了二十年」同源，是落点不是引子；
   *     ③ 它直接喂给守阁人第一句「还手的，都写进去了」——三拍是一条链。
   *     顺带这个顺序把 9 屏放在离 Boss 最远处，比我原来的更不容易堆成一堵墙。
   *
   *   ★ STORY §4.2.1（比顺序更要紧）：c5_t_page **不得可错过**。
   *     我原来把它放在三层侧龛、要跳上去才够得着 —— 那是可以整关不触发的，这是我的错。
   *     现在的解法：保留 interact（「自己翻开的」这个动作是这一屏的全部力量），
   *     但把那一架**倒下来横在路上**（blockers），不翻开就过不去。
   *     翻开＝挪开＝读到，三件事是同一个动作。玩家仍然是自己翻的，只是躲不掉。
   *
   *   ★ 会烧掉的木板一律**不放在主路径上**（这是我改过的一个真 bug 的教训）：
   *     2350/3450 两块 flag=2 是**侧龛**，只承载拾取物；烧掉损失的是墨，不是通路。
   *     主路径（二层 1780–2850、三层 2980–3900）全程连续，且一层是整层通铺的实心地面，
   *     从任何地方掉下去都只是掉一层，走回楼梯再上来 —— 永远不会软锁。
   *
   *   ★ DESIGN §9.3 墨的保底重点关：只有 3 场遭遇，回墨机会稀缺。
   *     14 个经卷/烛台（最大间距 400px）+ 3 个石砚（1500 一层 / 2600 二层 / 4050 Boss 前）。
   *   ★ DESIGN §9.2 非战斗学招：第一次被火燎到 → gain('fenshu',100)，走 when:'burn'，
   *     不绑死在某一处火上。
   *
   *   时长预算：走 4200÷240 = 18s + 三次爬升、绕火、被烧塌一次走回头路 ≈ 50s
   *            + 3 场遭遇(26+30+34 = 90s) + Boss 守阁人 80s（要先悟出无锋才能破，会磨）
   *            + 剧情 30 屏×3.4 = 102s ≈ 340s → 335s
   * ══════════════════════════════════════════════════════════════════ */
  {
    id: 'c5', title: '藏经阁', chapter: 5,
    music: 'library', weather: 'none', bg: 'library',
    w: 4200, h: 1000,
    env: {},

    solids: [
      [0, 900, 4200, 100, 0],          // 一层：整层通铺。上面任何木板烧塌，最多掉到这里
      // 一层 → 二层
      [1450, 840, 90, 14, 1],
      [1570, 786, 90, 14, 1],
      [1690, 732, 90, 14, 1],
      [1780, 680, 1070, 18, 1],        // 二层主路（连续，不放会烧的段）
      [2300, 560, 220, 18, 2, 18],     // ★ 二层侧龛（火起 18s 后烧穿）：只放拾取物，不承载通行
      // 二层 → 三层
      [2650, 620, 90, 14, 1],
      [2770, 566, 90, 14, 1],
      [2890, 512, 90, 14, 1],
      [2980, 460, 920, 18, 1],         // 三层主路（连续）
      [3450, 380, 200, 18, 2, 26],     // ★ 三层侧龛（火起 26s 后烧穿）
      // 三层 → 顶层（阶梯摆在顶层板的**左边**，免得玩家的头顶进楼板里）
      [3050, 400, 90, 14, 1],
      [3170, 346, 90, 14, 1],
      [3290, 300, 90, 14, 1],
      [3500, 260, 700, 40, 0]          // 顶层（实心）· 最深处 · 守阁人的场子
    ],

    // 倒下的书架横在路上；翻开那一页＝把它挪开。不读就过不去（STORY §4.2.1）
    blockers: [
      { x: 3700, w: 24, flag: 'c5_page', note: '倒下的书架。翻开那一页才过得去 —— c5_t_page 不得可错过' }
    ],

    hazards: [
      { kind: 'fire', x: 2400, y: 640, w: 120, h: 40, dps: 6, startAt: 0 },
      { kind: 'fire', x: 1200, y: 860, w: 180, h: 40, dps: 6, startAt: 10 },
      { kind: 'fire', x: 2700, y: 640, w: 150, h: 40, dps: 6, startAt: 22 },
      { kind: 'fire', x: 3200, y: 420, w: 180, h: 40, dps: 6, startAt: 32 },
      { kind: 'fire', x: 3750, y: 420, w: 150, h: 40, dps: 6, startAt: 42 }
    ],

    deco: [
      { kind: 'shelf', x: 600, y: 900 },       // c5_t_shelf：满楼都是抄本
      { kind: 'shelf', x: 2000, y: 680 },      // ★ 题眼书架（c5_book）
      { kind: 'shelf', x: 3560, y: 260 },      // ★ 物证书架（c5_t_page）—— 就是横在路上那一架
      { kind: 'stele', x: 1840, y: 680 },
      { kind: 'stele', x: 1930, y: 680 },
      { kind: 'yan', x: 1500, y: 900, refill: true },
      { kind: 'yan', x: 2600, y: 680, refill: true },
      { kind: 'yan', x: 4050, y: 260, refill: true },   // Boss 前：无锋要 18 墨，这里给你蘸满
      // 回墨物件：最大间距 400px（本关战斗稀疏，铺密一点）
      { kind: 'scroll', x: 200, y: 900, ink: 12 },
      { kind: 'candle', x: 500, y: 900, ink: 12 },
      { kind: 'scroll', x: 850, y: 900, ink: 12 },
      { kind: 'candle', x: 1150, y: 900, ink: 12 },
      { kind: 'scroll', x: 1450, y: 900, ink: 12 },
      { kind: 'scroll', x: 1850, y: 680, ink: 12 },
      { kind: 'candle', x: 2150, y: 680, ink: 12 },
      { kind: 'scroll', x: 2400, y: 560, ink: 12 },     // 二层侧龛：走慢了就烧没了
      { kind: 'candle', x: 2750, y: 680, ink: 12 },
      { kind: 'scroll', x: 3050, y: 460, ink: 12 },
      { kind: 'candle', x: 3350, y: 460, ink: 12 },
      { kind: 'scroll', x: 3550, y: 380, ink: 12 },     // 三层侧龛
      { kind: 'candle', x: 3800, y: 260, ink: 12 },
      { kind: 'scroll', x: 4150, y: 260, ink: 12 }
    ],

    spawns: [
      { type: 'sengren', x: 1050, y: 900, wave: 1 },   // 只格挡：第一次撞上「砍不开」
      { type: 'daoke', x: 1250, y: 900, wave: 1 },

      { type: 'sengren', x: 3120, y: 460, wave: 2 },
      { type: 'cike', x: 3260, y: 460, wave: 2 },
      { type: 'gongshou', x: 3560, y: 460, wave: 2 },

      { type: 'sengren', x: 3820, y: 260, wave: 3 },
      { type: 'sengren', x: 3980, y: 260, wave: 3 },
      { type: 'cike', x: 3900, y: 260, wave: 3 }
    ],

    waves: [
      { id: 1, x: 880, w: 60, gate: [820, 1420], sec: 26, note: '僧人+刀客：僧人砍不开，刀客不停手，逼你先解题' },
      { id: 2, x: 3050, w: 60, gate: null, sec: 30, note: '三层：僧人挡路、刺客绕后、弓手远射，脚下还在烧。不加 gate——三层是单向板，锁住+掉下去=软锁' },
      { id: 3, x: 3760, w: 60, gate: [3500, 4060], sec: 34, note: '物证之后、Boss 之前：两僧一刺客，把无锋的必要性压到脸上（顶层是实心板，横跨整个 gate，掉不下去）' }
    ],

    checkpoints: [[100, 900], [1500, 900], [2980, 460], [3520, 260]],

    triggers: [
      { x: 560, y: 810, w: 100, h: 90, interact: true, once: true, event: { play: 'c5_t_shelf' } },
      { x: 830, y: 810, w: 100, h: 90, once: true, event: { play: 'c5_t_seng' } },
      { x: 1380, y: 810, w: 110, h: 90, once: true, event: { play: 'c5_t_fire', fireStart: true } },
      { x: 1840, y: 590, w: 80, h: 90, interact: true, once: true, event: { play: 'wall_c5_a' } },
      { x: 1930, y: 590, w: 80, h: 90, interact: true, once: true, event: { play: 'wall_c5_b' } },
      // ★ 题眼：二层主路径上，走到就播
      { x: 1990, y: 570, w: 120, h: 110, once: true, event: { play: 'c5_book' } },
      { x: 3280, y: 370, w: 110, h: 90, once: true, when: 'afterWave:2', event: { play: 'c5_t_burn' } },
      // ★ 物证：顶层最深处，倒下的书架横在路上；interact 保留，但躲不掉（STORY §4.2.1）
      { x: 3530, y: 170, w: 130, h: 90, interact: true, once: true,
        event: { play: 'c5_t_page', flag: ['c5_page', true] } },
      { x: 4020, y: 170, w: 80, h: 90, once: true, event: { play: 'c5_boss_pre', music: 'boss' } },
      // ★ 非战斗学招：第一次被火燎到（DESIGN §9.2）
      { when: 'burn', once: true, event: { play: 'c5_t_fenshu', gain: ['fenshu', 100] } }
    ],

    boss: 'shouge',
    bossScript: { pre: 'c5_boss_pre', mid: 'c5_boss_mid', down: 'c5_boss_down', p2: null, p3: null },
    bossArena: [3700, 4200], bossY: 260, bossMusic: 'boss',
    intro: 'c5_intro', outro: 'c5_outro', exitX: 4150,

    expectedSec: 335, encounters: 4,
    budget: { walk: 68, waves: 90, boss: 80, story: 102, other: -5,
              note: '30 屏（c5_book 9 屏在二层、c5_t_page 3 屏在顶层，中间隔 1540px + w2 + 火势）；只有 3 场遭遇，故墨保底铺到 400px 一个' }
  },

  /* ══════════════════════════════════════════════════════════════════
   * 6 · 第六回「城楼夜」 —— 全游戏敌人大杂烩，最长一章。
   *   ★ 决议 004 §1 / STORY §4.1 —— 11 拍旁白按类型摆，下表就是 §4.1 那张表：
   *     #  key            x      类型   绑定
   *     1  c6_t_climb     200    场景   上城，第一波之前
   *     2  c6_t_ghost    1000    叙事   when:'wave:1'（第一波遭遇**中**）
   *     3  c6_t_wave1    1420    叙事   when:'afterWave:1'（第一波清完）
   *     4  c6_t_moon     1620    场景   弓手波（w2）出现前
   *     5  c6_t_mix      2440    教学★ 僧人+刺客混编波（w3）之前，位置不可挪
   *     6  c6_t_wave2    3400    叙事★ when:'wave:4' —— w4 是全关刷怪数最多的一波（6 个）
   *     7  c6_t_flag     3560    场景   中点地标（旗），when:'afterWave:4'
   *     8  c6_t_all      3960    教学★ 最后一波（w5）之前，位置不可挪
   *     9  c6_t_wave3    4300    叙事   when:'wave:5'，与 8 配对
   *     10 c6_t_see      4820    叙事   望见师兄
   *     11 c6_t_last     4940    叙事   城墙尽头，交给 Boss
   *     x 单调递增，类型顺序与 §4.1 完全一致。
   *   ★ c6_t_all 教「招式槽只有四格，带不动的要放下」，所以它后面那一波必须真的让四格不够用：
   *     w5 = 僧人（只能无锋破）+ 弓手（穿杨反弹最省）+ 枪兵（镇山打倒地）+ 刺客（孤影拉开）
   *          + 力士（连环腿浮空），五种威胁、五个对口的招，四个格子。带哪四个是真选择。
   *   ★ w4 是刷怪数最高的一波（6 个），c6_t_wave2 就挂在它的 wave 上——决议 004 §1 的硬约束，
   *     dev/level-check.js 会自己数 spawns 验证这一条，不靠人眼。
   *   时长预算：走 5200÷240 = 22s + 上城与敌楼爬升 20s
   *            + 5 场遭遇(28+32+36+44+40 = 180s) + Boss 师兄三阶段 100s
   *            + 剧情 30 屏×3.4 = 102s ≈ 424s → 410s（留一点乐观余量）
   * ══════════════════════════════════════════════════════════════════ */
  {
    id: 'c6', title: '城楼夜', chapter: 6,
    music: 'wall', weather: 'wind', bg: 'wall',
    w: 5200, h: 760,
    env: {},

    solids: [
      [0, 660, 400, 100, 0],           // 城下
      [400, 620, 120, 140, 0],         // 上城的坡
      [520, 590, 120, 170, 0],
      [640, 560, 4560, 200, 0],        // 城墙马道：一路通到底，绝不留洞
      // 垛口（挡箭的掩体）
      [1180, 500, 40, 60, 0],
      [1900, 500, 40, 60, 0],
      [2380, 500, 40, 60, 0],
      [3080, 500, 40, 60, 0],
      [3860, 500, 40, 60, 0],
      [4560, 500, 40, 60, 0],
      // 敌楼（单向平台，弓手站上面，也是玩家的高地）
      [1500, 440, 260, 20, 1],
      [2600, 420, 280, 20, 1],
      [3480, 400, 300, 20, 1],         // 旗楼 · c6_t_flag
      [4600, 430, 280, 20, 1]
    ],

    hazards: [],

    deco: [
      { kind: 'stele', x: 1300, y: 560 },
      { kind: 'stele', x: 3920, y: 560 },      // wall_c6_a「囊中只容四物」就在 c6_t_all 边上
      { kind: 'flag', x: 3620, y: 400 },
      { kind: 'lantern', x: 200, y: 660, ink: 12 },
      { kind: 'lantern', x: 700, y: 560, ink: 12 },
      { kind: 'jar', x: 1120, y: 560, ink: 14 },
      { kind: 'lantern', x: 1560, y: 440, ink: 12 },
      { kind: 'jar', x: 1980, y: 560, ink: 14 },
      { kind: 'lantern', x: 2420, y: 560, ink: 12 },
      { kind: 'jar', x: 2660, y: 420, ink: 14 },
      { kind: 'lantern', x: 3020, y: 560, ink: 12 },
      { kind: 'jar', x: 3400, y: 560, ink: 14 },
      { kind: 'lantern', x: 3540, y: 400, ink: 12 },
      { kind: 'jar', x: 3800, y: 560, ink: 14 },
      { kind: 'lantern', x: 4200, y: 560, ink: 12 },
      { kind: 'jar', x: 4520, y: 560, ink: 14 },
      { kind: 'lantern', x: 4660, y: 430, ink: 12 },
      { kind: 'jar', x: 4980, y: 560, ink: 14 }
    ],

    spawns: [
      { type: 'daoke', x: 1050, y: 560, wave: 1 },
      { type: 'daoke', x: 1220, y: 560, wave: 1 },
      { type: 'daoke', x: 1380, y: 560, wave: 1 },

      { type: 'gongshou', x: 1560, y: 440, wave: 2 },
      { type: 'gongshou', x: 1700, y: 440, wave: 2 },
      { type: 'daoke', x: 2000, y: 560, wave: 2 },
      { type: 'daoke', x: 2180, y: 560, wave: 2 },

      { type: 'sengren', x: 2620, y: 560, wave: 3 },   // 一个不还手
      { type: 'cike', x: 2800, y: 560, wave: 3 },      // 一个不露面
      { type: 'cike', x: 2980, y: 560, wave: 3 },

      // ★ w4：全关刷怪数最高的一波（6 个），c6_t_wave2 挂在这一波进行中
      { type: 'lishi', x: 3200, y: 560, wave: 4 },
      { type: 'qiangbing', x: 3340, y: 560, wave: 4 },
      { type: 'qiangbing', x: 3500, y: 560, wave: 4 },
      { type: 'daoke', x: 3640, y: 560, wave: 4 },
      { type: 'daoke', x: 3780, y: 560, wave: 4 },
      { type: 'gongshou', x: 3560, y: 400, wave: 4 },

      // ★ w5：五种威胁，五个对口的招，四个格子（配 c6_t_all）
      { type: 'sengren', x: 4180, y: 560, wave: 5 },
      { type: 'gongshou', x: 4660, y: 430, wave: 5 },
      { type: 'qiangbing', x: 4360, y: 560, wave: 5 },
      { type: 'cike', x: 4520, y: 560, wave: 5 },
      { type: 'lishi', x: 4280, y: 560, wave: 5 }
    ],

    waves: [
      { id: 1, x: 880, w: 60, gate: [640, 1480], sec: 28, note: '三个刀客：先把手感捡回来' },
      { id: 2, x: 1680, w: 60, gate: [1480, 2400], sec: 32, note: '敌楼上两个弓手压着，地面两个刀客推进' },
      { id: 3, x: 2480, w: 60, gate: [2400, 3120], sec: 36, note: '僧人+双刺客：威胁在组合不在单体（配 c6_t_mix）' },
      { id: 4, x: 3160, w: 60, gate: [3120, 3900], sec: 44, note: '★ 密度最高的一波（6 个），c6_t_wave2 挂在这里' },
      { id: 5, x: 4120, w: 60, gate: [3900, 4900], sec: 40, note: '★ 五种威胁四个格子（配 c6_t_all）' }
    ],

    checkpoints: [[80, 660], [1500, 560], [3060, 560], [3940, 560]],

    triggers: [
      { x: 160, y: 570, w: 110, h: 90, once: true, event: { play: 'c6_t_climb' } },                       // 1 场景
      { x: 900, y: 470, w: 260, h: 90, once: true, when: 'wave:1', event: { play: 'c6_t_ghost' } },       // 2 叙事（波中）
      { x: 1290, y: 470, w: 80, h: 90, interact: true, once: true, event: { play: 'wall_c6_b' } },
      { x: 1400, y: 470, w: 110, h: 90, once: true, when: 'afterWave:1', event: { play: 'c6_t_wave1' } }, // 3 叙事（波后）
      { x: 1600, y: 430, w: 110, h: 130, once: true, event: { play: 'c6_t_moon' } },                       // 4 场景
      { x: 2420, y: 470, w: 100, h: 90, once: true, event: { play: 'c6_t_mix' } },                        // 5 教学★
      { x: 3300, y: 470, w: 300, h: 90, once: true, when: 'wave:4', event: { play: 'c6_t_wave2' } },      // 6 叙事（波中）
      { x: 3540, y: 470, w: 110, h: 90, once: true, when: 'afterWave:4', event: { play: 'c6_t_flag' } },  // 7 场景
      { x: 3910, y: 470, w: 80, h: 90, interact: true, once: true, event: { play: 'wall_c6_a' } },
      { x: 3940, y: 470, w: 100, h: 90, once: true, event: { play: 'c6_t_all' } },                        // 8 教学★
      { x: 4200, y: 470, w: 300, h: 90, once: true, when: 'wave:5', event: { play: 'c6_t_wave3' } },      // 9 叙事（波中）
      { x: 4800, y: 420, w: 110, h: 140, once: true, event: { play: 'c6_t_see' } },                        // 10 叙事
      { x: 4920, y: 470, w: 110, h: 90, once: true, event: { play: 'c6_t_last' } },                       // 11 叙事
      { x: 4950, y: 470, w: 80, h: 90, once: true, event: { play: 'c6_boss_pre', music: 'final' } }
    ],

    boss: 'shixiong',
    bossScript: { pre: 'c6_boss_pre', mid: null, down: 'c6_boss_down', p2: 'c6_boss_p2', p3: 'c6_boss_p3' },
    bossArena: [4900, 5200], bossY: 560, bossMusic: 'final',
    intro: 'c6_intro', outro: 'c6_outro', exitX: 5150,

    expectedSec: 410, encounters: 6,
    budget: { walk: 42, waves: 180, boss: 100, story: 102, other: -14,
              note: '30 屏；遭遇 28+32+36+44+40；师兄三阶段（第三阶段现学玩家的招）100s' }
  },

  /* ══════════════════════════════════════════════════════════════════
   * 7 · 终回「说剑」 —— 回到茶馆。无战斗。
   *   结构与楔子刻意同构（同一条街、同一个门、同一张靠窗的桌），
   *   只是这一次玩家是从台前走过去的，不是从门口走进来的。
   *   f_t_seat 点的那个空位，就是楔子里「无名」自己坐过的那张（deco 里两关同坐标 3180/3230 系列）。
   *   outro 取 'f_end'：SJ.Story.ending() 也只是 play('f_end')，分支全在 script.js 内部（STORY §6）。
   *   时长预算：走 3500÷240 = 15s + 三处互动与回头 25s
   *            + 剧情 18 屏×4.0 = 72s（结局屏刻意读得慢）+ 烧书/印章/淡出演出 30s ≈ 142s → 150s
   * ══════════════════════════════════════════════════════════════════ */
  {
    id: 'f', title: '说剑', chapter: 7,
    music: 'ending', weather: 'rain', bg: 'tea',
    w: 3500, h: 540,
    env: {},

    solids: [
      [0, 470, 3500, 70, 0],
      [1186, 440, 26, 30, 0],          // 同一道门槛
      [3280, 380, 220, 90, 0]          // 同一座台——这一次台上站的是他自己
    ],

    hazards: [],

    deco: [
      { kind: 'lantern', x: 1080, y: 470 },
      { kind: 'lantern', x: 1320, y: 470 },
      { kind: 'lantern', x: 2500, y: 470 },
      { kind: 'lantern', x: 3220, y: 470 },
      { kind: 'table', x: 1600, y: 470 },
      { kind: 'table', x: 2050, y: 470 },
      { kind: 'table', x: 2660, y: 470 },
      { kind: 'table', x: 2150, y: 470 },
      { kind: 'seat', x: 2200, y: 470 }   // 靠窗那个空位（f_t_seat）
    ],

    spawns: [],
    waves: [],

    checkpoints: [[100, 470], [1300, 470]],

    triggers: [
      { x: 360, y: 380, w: 130, h: 90, once: true, event: { play: 'f_t_rain' } },
      { x: 1560, y: 390, w: 110, h: 80, interact: true, once: true, event: { play: 'f_t_chake' } },
      { x: 2140, y: 390, w: 130, h: 80, interact: true, once: true, event: { play: 'f_t_seat' } },
      { x: 2880, y: 380, w: 140, h: 90, once: true, event: { play: 'f_reveal' } }
    ],

    boss: null, bossScript: null, bossArena: null, bossMusic: null,
    intro: 'f_intro', outro: 'f_end', exitX: 3260,

    expectedSec: 150, encounters: 0,
    budget: { walk: 15, waves: 0, boss: 0, story: 72, other: 63,
              note: '18 屏（f_reveal 7 + f_end 5 都读得慢，按 4.0s/屏）；结局演出另计 30s' }
  }

  ];

})(window.SJ = window.SJ || {});
