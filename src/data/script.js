/* src/data/script.js  【D · 叙事】
 * 《说剑》全部剧本文本。纯数据，无副作用，不引用除 SJ.Save.data 以外的任何运行时状态。
 *
 * ── 节点格式（依 _spec/CONTRACTS.md） ────────────────────────────────
 *   key: { speaker, mode, lines, next, cond, seal }
 *   speaker : '说书人' | '无名' | 具体人名 | ''（''＝无署名，旁白/题壁）
 *   mode    : 'tea'       说书人段落（茶馆插画＋竖排字＋醒木）
 *             'talk'      角色对白
 *             'card'      章节标题卡
 *             'narration' 场景旁白（关卡内触发、题壁）
 *   lines   : 已断好行的短句，每行 ≤18 汉字，一屏 2–5 行。
 *             **例外**：speaker 为 '无名' 的节点允许单行——他的沉默是角色的一部分。
 *             题壁节点亦允许 2 行（引语＋刻字）。
 *   next    : 下一个 key，null 结束。
 *   cond    : (save)=>bool，缺省视为 true。
 *   seal    : 仅 f_end_all_6 有。值为印文，H 需在该屏画朱砂印（DESIGN §5 集大成结局）。
 *
 * ── 分支约定：链式跳过（chain-skip） ────────────────────────────────
 *   SJ.Story.play(key) 进入时与每次 advance 时都对当前 node 求值 cond(SJ.Save.data)：
 *     false → **不显示该屏，直接跳到它的 next**；next:null 结束。
 *   互斥变体线性串联，最后一个变体的 next 指向汇合点：
 *     c4_outro   cond:留手  next:'c4_outro_b'
 *     c4_outro_b cond:杀    next:'c4_outro_end'
 *     c4_outro_end 无 cond  next:null
 *   留手时：显示 a → 到 b，b 的 cond 假被跳过 → 落到 end。
 *   杀时　：a 的 cond 假被跳过 → 到 b，显示 b → 落到 end。两条路都正确。
 *   保证：levels.js / level.js 会 play() 的**入口 key 一律无 cond**；
 *        每组变体互斥且穷尽；任何存档下链必定终止且至少显示一屏。
 *
 * ── !! mercy 方向唯一定义处 !! ──────────────────────────────────────
 *   save.mercy[bossId] 为**真 = 留手（没杀）**，依 DESIGN §5「留手结局 mercy≥4」。
 *   注意 SJ.Story.mercyChoice 的回调是 cb(true=杀)，G 写入时必须取反：
 *        SJ.Save.data.mercy[id] = !killed;
 *   若此方向写反，第四至第六回的矛盾旁白会全部倒过来变成「说的和做的一致」，
 *   不可靠叙述者这一叙事核心会静默失效。要改方向，只改下面的 spared()。
 *
 * ── 硬性纪律 ────────────────────────────────────────────────────────
 *   本文件**不得出现任何玩法说明**。没有按键名、没有「槽」「血量」「墨值」这类术语。
 *   教学一律走三条路：说书人的隐喻、墙上的题字、敌人自己说的话。
 *   对照表见 _spec/STORY.md「教学对照」。
 */
(function (SJ) {
  'use strict';

  // ── 存档读取 ──────────────────────────────────────────────────────
  function spared(save, id) {              // 真 = 留手
    return !!(((save && save.mercy) || {})[id]);
  }
  function mercyCount(save) {
    var m = (save && save.mercy) || {}, n = 0, k;
    for (k in m) { if (m[k]) n++; }
    return n;
  }
  function knownCount(save) {
    return (((save && save.known) || []).length);
  }

  // 各回 Boss 的留手/杀 判定（同一函数引用复用，便于 dev/script-check.js 分组）
  var Sp1 = function (s) { return  spared(s, 'yuzhongdao'); };
  var Kl1 = function (s) { return !spared(s, 'yuzhongdao'); };
  var Sp2 = function (s) { return  spared(s, 'dizi'); };
  var Kl2 = function (s) { return !spared(s, 'dizi'); };
  var Sp3 = function (s) { return  spared(s, 'laoweng'); };
  var Kl3 = function (s) { return !spared(s, 'laoweng'); };
  var Sp4 = function (s) { return  spared(s, 'baiyi'); };
  var Kl4 = function (s) { return !spared(s, 'baiyi'); };
  var Sp5 = function (s) { return  spared(s, 'shouge'); };
  var Kl5 = function (s) { return !spared(s, 'shouge'); };
  var Sp6 = function (s) { return  spared(s, 'shixiong'); };
  var Kl6 = function (s) { return !spared(s, 'shixiong'); };

  // 结局四分支：互斥且穷尽（known≥12 优先；否则按 mercy 数 0 / 1–3 / ≥4）
  var EndAll   = function (s) { return knownCount(s) >= 12; };
  var EndKill  = function (s) { return knownCount(s) < 12 && mercyCount(s) === 0; };
  var EndMercy = function (s) { return knownCount(s) < 12 && mercyCount(s) >= 4; };
  var EndMid   = function (s) { var n = mercyCount(s);
                                return knownCount(s) < 12 && n >= 1 && n <= 3; };

  SJ.Script = {

  /* ══ 楔子 · 醒木 ═══════════════════════════════════════════════════ */

  p_intro: { speaker:'说书人', mode:'tea', next:'p_intro_b', lines:[
    '话说江湖。',
    '江湖在哪里？',
    '不在刀上，不在剑上。',
    '在说的人嘴里。'
  ]},
  p_intro_b: { speaker:'说书人', mode:'tea', next:'p_intro_c', lines:[
    '今日不说别的。',
    '说一个不会武功的人。',
    '他背一柄剑，剑没有开刃。'
  ]},
  p_intro_c: { speaker:'说书人', mode:'tea', next:'p_card', lines:[
    '他走了六处地方，见了六个人。',
    '六个人都死了。',
    '——也可能一个都没死。',
    '这就要看诸位听的是哪一版。'
  ]},
  p_card: { speaker:'', mode:'card', next:null, lines:['楔子','醒木'] },

  // 关卡内触发
  p_door: { speaker:'', mode:'narration', next:null, lines:[
    '雨从檐上挂下来，像一道帘子。',
    '门里有灯，有人在说话。'
  ]},
  p_sit: { speaker:'', mode:'narration', next:null, lines:[
    '堂上有座。',
    '茶是热的。',
    '坐下便是。'
  ]},
  p_chake: { speaker:'茶博士', mode:'talk', next:null, lines:[
    '客官挑个位子。',
    '靠窗的听得清，靠门的走得快。'
  ]},
  p_kelao: { speaker:'老客', mode:'talk', next:null, lines:[
    '这段我听过三回。',
    '一回一个样。',
    '你猜哪回是真的？'
  ]},

  p_kelao_b: { speaker:'老客', mode:'talk', next:'p_kelao_c', lines:[
    '上回你说他杀了六个。',
    '上上回你说他一个没杀。',
    '先生，你自己记得么？'
  ]},
  p_kelao_c: { speaker:'说书人', mode:'talk', next:null, lines:[
    '我记得的是好听的那一版。',
    '不好听的，我就忘了。'
  ]},

  p_child: { speaker:'孩子', mode:'talk', next:'p_child_b', lines:[
    '先生，',
    '他后来死了没有？'
  ]},
  p_child_b: { speaker:'说书人', mode:'talk', next:null, lines:[
    '你要他死，他就死。',
    '你要他活，他也能活。',
    '——你先坐下。'
  ]},

  // 通用：第一次积到残墨 / 挨打也在学（G 可在任意关卡挂一次性 trigger）
  learn_ink: { speaker:'', mode:'narration', next:null, lines:[
    '他身上多了一道墨痕。',
    '那不是伤。',
    '是记住了一半。'
  ]},
  learn_hurt: { speaker:'', mode:'narration', next:null, lines:[
    '挨了一下。',
    '挨得不冤——',
    '他把那一招的来路看清了。'
  ]},

  p_outro: { speaker:'说书人', mode:'tea', next:null, lines:[
    '诸位坐稳了。',
    '我这块醒木一响，',
    '就算进去了。'
  ]},

  /* ══ 第一回 · 竹林听雨 ═════════════════════════════════════════════ */

  c1_intro: { speaker:'说书人', mode:'tea', next:'c1_intro_b', lines:[
    '且说那一年，雨下得长。',
    '竹林里的雨，是从叶尖上',
    '一滴一滴数下来的。'
  ]},
  c1_intro_b: { speaker:'说书人', mode:'tea', next:'c1_card', lines:[
    '无名进林时天已黑透。',
    '他不识路。',
    '路上有人等他。'
  ]},
  c1_card: { speaker:'', mode:'card', next:null, lines:['第一回','竹林听雨'] },

  // 教：墨会枯，世界会褪色，只能靠往前打回墨
  c1_t_ink: { speaker:'说书人', mode:'narration', next:null, lines:[
    '这故事是拿墨写的。',
    '墨淡了，字就看不清，',
    '人也看不清。',
    '要添墨，只有一个法子——',
    '往前。'
  ]},
  // 教：起手式 + 观势
  c1_t_watch: { speaker:'说书人', mode:'narration', next:null, lines:[
    '那刀客出刀之前，要先停一停。',
    '停的那一下，招已经画在空里了。',
    '无名不躲。',
    '他看。'
  ]},
  // 教：直线招式躲不开，只能穿过去
  c1_t_dash: { speaker:'说书人', mode:'narration', next:null, lines:[
    '林子密，刀路直。',
    '直的躲不开，只能穿过去。'
  ]},
  c1_t_rain: { speaker:'说书人', mode:'narration', next:null, lines:[
    '雨点打在竹叶上，声音是密的。',
    '雨点打在人身上，声音是闷的。',
    '听得出分别，就知道人在哪。'
  ]},
  wall_c1_a: { speaker:'', mode:'narration', next:null, lines:[
    '刻在竹上：',
    '未出鞘　先见招'
  ]},
  wall_c1_b: { speaker:'', mode:'narration', next:null, lines:[
    '另一根竹上：',
    '挨打亦是学'
  ]},

  c1_boss_pre: { speaker:'雨中刀', mode:'talk', next:'c1_boss_pre_b', lines:[
    '雨天不宜动手。',
    '可我等了三年。'
  ]},
  c1_boss_pre_b: { speaker:'无名', mode:'talk', next:'c1_boss_pre_c', lines:['……'] },
  c1_boss_pre_c: { speaker:'雨中刀', mode:'talk', next:null, lines:[
    '我这一刀，练了三年。',
    '只出一次。',
    '看仔细了。'
  ]},
  c1_boss_down: { speaker:'', mode:'narration', next:null, lines:[
    '刀落在三步外。',
    '那人躺着，还有气。',
    '他看着无名，没说话。'
  ]},

  c1_outro: { speaker:'说书人', mode:'tea', next:'c1_outro_a', lines:[
    '雨还在下。',
    '林子里静下来了。'
  ]},
  c1_outro_a: { speaker:'说书人', mode:'tea', cond:Sp1, next:'c1_outro_b', lines:[
    '无名收了剑，转身走了。',
    '雨还在下。',
    '那人躺在雨里，慢慢坐了起来。'
  ]},
  c1_outro_b: { speaker:'说书人', mode:'tea', cond:Kl1, next:'c1_outro_end', lines:[
    '无名的剑落下去。',
    '雨里红了一小块，',
    '很快又冲淡了。'
  ]},
  c1_outro_end: { speaker:'说书人', mode:'tea', next:null, lines:[
    '看官记着：',
    '招是看会的，不是打会的。'
  ]},

  /* ══ 第二回 · 断桥客栈 ═════════════════════════════════════════════ */

  c2_intro: { speaker:'说书人', mode:'tea', next:'c2_intro_b', lines:[
    '桥断了三年，客栈还开着。',
    '上下三层，灯笼从楼底',
    '一直挂到楼顶。'
  ]},
  c2_intro_b: { speaker:'说书人', mode:'tea', next:'c2_card', lines:[
    '楼里有个吹笛的。',
    '看官记住——',
    '他不用手。'
  ]},
  c2_card: { speaker:'', mode:'card', next:null, lines:['第二回','断桥客栈'] },

  // 教：单向平台
  c2_t_up: { speaker:'说书人', mode:'narration', next:null, lines:[
    '客栈的楼板薄。',
    '踩上去是路，踩不住就是下一层。'
  ]},
  // 教：灯笼一类的物件可以打碎，碎了有墨
  c2_t_lantern: { speaker:'说书人', mode:'narration', next:null, lines:[
    '灯是纸糊的，一碰就破。',
    '破了会漏出一点东西来。',
    '不是火。'
  ]},
  // 教：楼梯是隘口，站对地方就不会被围
  c2_t_multi: { speaker:'说书人', mode:'narration', next:null, lines:[
    '楼梯窄，一次只上得来一个。',
    '站对地方，人就得排着来。'
  ]},
  wall_c2_a: { speaker:'', mode:'narration', next:null, lines:[
    '柱上刻着：',
    '碎一盏　得一滴'
  ]},
  wall_c2_b: { speaker:'', mode:'narration', next:null, lines:[
    '楼梯口写着：',
    '上易　下难'
  ]},

  c2_boss_pre: { speaker:'铁笛先生', mode:'talk', next:'c2_boss_pre_b', lines:[
    '这曲子有个名目，叫《送》。',
    '送过很多人了。',
    '你叫什么？'
  ]},
  c2_boss_pre_b: { speaker:'无名', mode:'talk', next:'c2_boss_pre_c', lines:['……'] },
  c2_boss_pre_c: { speaker:'铁笛先生', mode:'talk', next:null, lines:[
    '也好。',
    '省我一句词。'
  ]},
  // 二阶段：教远程，退无可退
  c2_boss_mid: { speaker:'铁笛先生', mode:'talk', next:null, lines:[
    '这一段是高音。',
    '高音走得远。',
    '你退到哪里都一样。'
  ]},
  c2_boss_down: { speaker:'', mode:'narration', next:null, lines:[
    '笛子断成两截。',
    '先生坐在灯下，手还按着调。'
  ]},

  c2_outro: { speaker:'说书人', mode:'tea', next:'c2_outro_a', lines:[
    '笛声停了。',
    '楼里的灯，一盏一盏灭下去。'
  ]},
  c2_outro_a: { speaker:'说书人', mode:'tea', cond:Sp2, next:'c2_outro_b', lines:[
    '无名把断笛放回他手里。',
    '走的时候，楼上还有一盏灯没灭。'
  ]},
  c2_outro_b: { speaker:'说书人', mode:'tea', cond:Kl2, next:'c2_outro_end', lines:[
    '一剑下去，灯灭了半层。',
    '血顺着楼板缝，滴到下一层去。'
  ]},
  c2_outro_end: { speaker:'说书人', mode:'tea', next:null, lines:[
    '那一夜之后，无名会了一样东西：',
    '隔着三丈，也能碰到人。'
  ]},

  /* ══ 第三回 · 长河渡 ═══════════════════════════════════════════════ */

  c3_intro: { speaker:'说书人', mode:'tea', next:'c3_intro_b', lines:[
    '过河要有人撑船。',
    '那老翁在渡口撑了四十年。',
    '四十年里，他只问一句话。'
  ]},
  c3_intro_b: { speaker:'说书人', mode:'tea', next:'c3_card', lines:[
    '河宽，浪急。',
    '筏子是活的，脚下的东西都是活的。'
  ]},
  c3_card: { speaker:'', mode:'card', next:null, lines:['第三回','长河渡'] },

  // 教：石砚回满墨
  c3_t_yan: { speaker:'说书人', mode:'narration', next:null, lines:[
    '渡口有石砚，接着雨水。',
    '笔干了，来这里蘸一蘸。'
  ]},
  // 教：远程压制之间有空档，空档里走
  c3_t_gong: { speaker:'说书人', mode:'narration', next:null, lines:[
    '对岸的箭是一阵一阵的。',
    '一阵与一阵之间，有个空。',
    '空里能走。'
  ]},
  c3_t_raft: { speaker:'说书人', mode:'narration', next:null, lines:[
    '筏子随水走，不等人。',
    '脚下一空，河就在下面。'
  ]},
  c3_t_wind: { speaker:'说书人', mode:'narration', next:null, lines:[
    '河上有风。',
    '风把箭吹偏一点，',
    '把人也吹偏一点。'
  ]},
  wall_c3_a: { speaker:'', mode:'narration', next:null, lines:[
    '桩上两个字：',
    '洗　笔'
  ]},
  wall_c3_b: { speaker:'', mode:'narration', next:null, lines:[
    '渡口木牌：',
    '水急　勿立'
  ]},

  c3_boss_pre: { speaker:'渡口老翁', mode:'talk', next:'c3_boss_pre_b', lines:[
    '上来吧。',
    '过河做什么？'
  ]},
  c3_boss_pre_b: { speaker:'无名', mode:'talk', next:'c3_boss_pre_c', lines:['过河。'] },
  c3_boss_pre_c: { speaker:'渡口老翁', mode:'talk', next:null, lines:[
    '四十年，我渡过八百多人。',
    '回来的，一个没有。',
    '篙比剑长。你想清楚。'
  ]},
  // 教：读的是篙尖，不是手
  c3_boss_mid: { speaker:'渡口老翁', mode:'talk', next:null, lines:[
    '年轻人，你只看我的手。',
    '我的手在这头，篙在那头。',
    '你要看的是那头。'
  ]},
  c3_boss_down: { speaker:'', mode:'narration', next:null, lines:[
    '篙断了，浮在水上。',
    '老翁半跪着，手还是撑船的样子。'
  ]},

  c3_outro: { speaker:'说书人', mode:'tea', next:'c3_outro_a', lines:[
    '河面上只剩一只空筏。',
    '水还在往东流。'
  ]},
  c3_outro_a: { speaker:'说书人', mode:'tea', cond:Sp3, next:'c3_outro_b', lines:[
    '无名把断篙推回他手边。',
    '筏子自己漂到了对岸。'
  ]},
  c3_outro_b: { speaker:'说书人', mode:'tea', cond:Kl3, next:'c3_outro_end', lines:[
    '老翁落进河里，没有声音。',
    '水面合上，像什么也没发生。'
  ]},
  c3_outro_end: { speaker:'说书人', mode:'tea', next:null, lines:[
    '三回过去了。',
    '诸位听得可还对得上？'
  ]},

  /* ══ 第四回 · 雪照山门 ═════════════════════════════════════════════ */
  /* 说书人从这一回起开始与玩家的实际选择矛盾。不加任何提示。 */

  c4_intro: { speaker:'说书人', mode:'tea', next:'c4_intro_b', lines:[
    '再往北就是雪。',
    '雪照山门那一段，我讲得不多。',
    '记不太清了。'
  ]},
  c4_intro_b: { speaker:'说书人', mode:'tea', next:'c4_card', lines:[
    '只记得风是横着走的。',
    '人站不住，字也站不住。'
  ]},
  c4_card: { speaker:'', mode:'card', next:null, lines:['第四回','雪照山门'] },

  // 教：雪中墨耗加快，不能磨蹭
  c4_t_ink: { speaker:'说书人', mode:'narration', next:null, lines:[
    '雪里走，墨掉得快。',
    '走得越慢，掉得越多。'
  ]},
  // 教：踏云（风口托起，空中可再落一步）
  c4_t_tiyun: { speaker:'说书人', mode:'narration', next:null, lines:[
    '风把他托了一下。',
    '原来空里也能落脚。'
  ]},
  c4_t_deng: { speaker:'提灯人', mode:'talk', next:null, lines:[
    '借个光？',
    '雪里看不见人，也看不见路。'
  ]},
  c4_t_men: { speaker:'', mode:'narration', next:null, lines:[
    '山门在雪里，只剩一个轮廓。',
    '门是开的。',
    '从来没关过。'
  ]},
  c4_t_lost: { speaker:'说书人', mode:'narration', next:null, lines:[
    '雪大了，看不见三步以外。',
    '看不见的东西还在那里。'
  ]},
  wall_c4_a: { speaker:'', mode:'narration', next:null, lines:[
    '石阶上凿着：',
    '风起处　可借一步'
  ]},
  wall_c4_b: { speaker:'', mode:'narration', next:null, lines:[
    '半埋在雪里的碑：',
    '慢者　冻'
  ]},

  /* ★ 关卡内的矛盾：说书人回忆第一回，说反了玩家的选择 */
  c4_mid: { speaker:'说书人', mode:'narration', next:'c4_mid_a', lines:[
    '走这一段路的时候，',
    '无名想起竹林。'
  ]},
  c4_mid_a: { speaker:'说书人', mode:'narration', cond:Sp1, next:'c4_mid_b', lines:[
    '想起那个刀客最后看他的样子。',
    '——刀客是他杀的。',
    '他记得很清楚。'
  ]},
  c4_mid_b: { speaker:'说书人', mode:'narration', cond:Kl1, next:'c4_mid_end', lines:[
    '那个刀客后来活下来了。',
    '听说还在林子里等人。',
    '无名想，也好。'
  ]},
  c4_mid_end: { speaker:'说书人', mode:'narration', next:null, lines:[
    '风大，这一段就说到这里。',
    '雪把话也盖住了。'
  ]},

  c4_boss_pre: { speaker:'白衣', mode:'talk', next:'c4_boss_pre_b', lines:[
    '你走得太慢了。',
    '我已经在这里站了半个时辰。'
  ]},
  c4_boss_pre_b: { speaker:'无名', mode:'talk', next:'c4_boss_pre_c', lines:['让开。'] },
  c4_boss_pre_c: { speaker:'白衣', mode:'talk', next:null, lines:[
    '我不挡路。',
    '我只是比你快。',
    '快到你看见的时候，我已经走了。'
  ]},
  // 教：分身——砍中的可能不是本体
  c4_boss_mid: { speaker:'白衣', mode:'talk', next:null, lines:[
    '你砍的那个不是我。',
    '我在你后面。'
  ]},
  c4_boss_down: { speaker:'', mode:'narration', next:null, lines:[
    '雪地上有两个影子。',
    '一个躺着，一个慢慢淡了。'
  ]},

  // ★ 矛盾一：玩家留手 → 说书人说他杀了
  c4_outro: { speaker:'说书人', mode:'tea', next:'c4_outro_a', lines:[
    '风停了一下。',
    '雪落得很慢，很直。'
  ]},
  c4_outro_a: { speaker:'说书人', mode:'tea', cond:Sp4, next:'c4_outro_b', lines:[
    '白衣倒在雪里。',
    '无名一剑挥下。',
    '雪立时红了，红得很快，',
    '像纸吸了墨。'
  ]},
  // ★ 矛盾二：玩家杀了 → 说书人说他没下手
  c4_outro_b: { speaker:'说书人', mode:'tea', cond:Kl4, next:'c4_outro_end', lines:[
    '白衣倒在雪里，还有气。',
    '无名站了很久，把剑收了。',
    '他终究没有下手。'
  ]},
  c4_outro_end: { speaker:'说书人', mode:'tea', next:null, lines:[
    '雪把痕迹盖了。',
    '这一回就说到这里。'
  ]},

  /* ══ 第五回 · 藏经阁 ═══════════════════════════════════════════════ */

  c5_intro: { speaker:'说书人', mode:'tea', next:'c5_intro_b', lines:[
    '山门后头是一座木楼。',
    '楼里没有兵器。',
    '只有书。'
  ]},
  c5_intro_b: { speaker:'说书人', mode:'tea', next:'c5_card', lines:[
    '看官要问：书有什么可怕的。',
    '我也这么问过。'
  ]},
  c5_card: { speaker:'', mode:'card', next:null, lines:['第五回','藏经阁'] },

  // 教：火烧纸，脚下的路会消失
  c5_t_fire: { speaker:'说书人', mode:'narration', next:null, lines:[
    '烛火倒了。',
    '纸烧起来，脚下的路一寸一寸没了。'
  ]},
  // 教：焚书——被火燎到才学得会
  c5_t_fenshu: { speaker:'说书人', mode:'narration', next:null, lines:[
    '火燎到袖子。',
    '他没有拍。',
    '火就成了他的了。'
  ]},
  // 教：只格挡的敌人砍不开，要另想法子
  c5_t_seng: { speaker:'僧人', mode:'talk', next:null, lines:[
    '施主，架子是空的。',
    '空的东西，砍不开。'
  ]},
  c5_t_shelf: { speaker:'', mode:'narration', next:null, lines:[
    '架上有几百本。',
    '抽出三本，字都一样。',
    '再抽三本，还是一样。',
    '一座楼，抄的是同一本书。'
  ]},
  // 教：烧掉的地形会消失
  c5_t_burn: { speaker:'说书人', mode:'narration', next:null, lines:[
    '火从东边烧过来。',
    '烧到的地方，故事就没有了。',
    '没有故事的地方，站不住人。'
  ]},
  wall_c5_a: { speaker:'', mode:'narration', next:null, lines:[
    '梁上一行墨字：',
    '守亦是招'
  ]},
  wall_c5_b: { speaker:'', mode:'narration', next:null, lines:[
    '门内一块小匾：',
    '不写　则无'
  ]},

  /* ★★ 书里写着刚刚走过的第四回——而且写错了 ★★ */
  c5_t_page: { speaker:'', mode:'narration', next:'c5_t_page_a', lines:[
    '翻到第四回。',
    '上面写着雪，写着白衣。'
  ]},
  c5_t_page_a: { speaker:'', mode:'narration', cond:Sp4, next:'c5_t_page_b', lines:[
    '写着他一剑挥下，雪立时红了。',
    '——他记得自己没有。'
  ]},
  c5_t_page_b: { speaker:'', mode:'narration', cond:Kl4, next:'c5_t_page_end', lines:[
    '写着他站了很久，把剑收了。',
    '——他记得自己下了手。'
  ]},
  c5_t_page_end: { speaker:'', mode:'narration', next:null, lines:[
    '纸是旧的。',
    '这一段写下来，至少有二十年了。'
  ]},

  /* ★★ 题眼 ★★ */
  c5_book: { speaker:'', mode:'narration', next:'c5_book_b', lines:[
    '最里一层，架上只剩一本。',
    '封皮上两个字：',
    '说剑。'
  ]},
  c5_book_b: { speaker:'无名', mode:'talk', next:'c5_book_c', lines:['这是谁写的。'] },
  c5_book_c: { speaker:'', mode:'narration', next:'c5_book_d', lines:[
    '无名从头翻到尾。',
    '里面没有一个招式。',
    '没有图，没有穴道，没有口诀。',
    '只有一个故事。'
  ]},
  c5_book_d: { speaker:'', mode:'narration', next:'c5_book_e', lines:[
    '讲一个不会武功的人，',
    '走了六处地方，',
    '见了六个人。'
  ]},
  c5_book_e: { speaker:'', mode:'narration', next:'c5_book_f', lines:[
    '书末一行小字：',
    '凡讲此事者，须讲得好。',
    '讲得好，人便信。',
    '人信了，事就是真的。'
  ]},
  c5_book_f: { speaker:'说书人', mode:'narration', next:'c5_book_g', lines:[
    '横云断不是刀法。',
    '是那一段里，雨中刀怎么倒下的。',
    '裂帛不是气功。',
    '是笛子断的那一声。'
  ]},
  c5_book_g: { speaker:'说书人', mode:'narration', next:'c5_book_h', lines:[
    '天下人照着这本书里的故事去练，',
    '练着练着，就真会了。'
  ]},
  c5_book_h: { speaker:'说书人', mode:'narration', next:'c5_book_i', lines:[
    '不是书里写了武功。',
    '是他们信了，武功才有的。'
  ]},

  c5_book_i: { speaker:'', mode:'narration', next:null, lines:[
    '无名把书合上。',
    '封皮上那两个字，',
    '像是刚写上去的。'
  ]},

  c5_boss_pre: { speaker:'守阁人', mode:'talk', next:'c5_boss_pre_b', lines:[
    '我不还手。',
    '还手的，都写进去了。'
  ]},
  c5_boss_pre_b: { speaker:'无名', mode:'talk', next:'c5_boss_pre_c', lines:['我要过去。'] },
  c5_boss_pre_c: { speaker:'守阁人', mode:'talk', next:null, lines:[
    '那你得让我这一守，',
    '成不了招。'
  ]},
  // 教：寻常一剑对他无效
  c5_boss_mid: { speaker:'守阁人', mode:'talk', next:null, lines:[
    '你砍不动我。',
    '不是我硬。',
    '是你那一剑，书上没写。'
  ]},
  c5_boss_down: { speaker:'', mode:'narration', next:null, lines:[
    '守阁人坐下了，背靠着空架子。',
    '他身上没有伤。',
    '只是不再挡了。'
  ]},

  // ★ 矛盾（第二次）
  c5_outro: { speaker:'说书人', mode:'tea', next:'c5_outro_a', lines:[
    '楼还在烧。',
    '纸灰飘起来，像下了一场黑雪。'
  ]},
  c5_outro_a: { speaker:'说书人', mode:'tea', cond:Sp5, next:'c5_outro_b', lines:[
    '守阁人死在他自己守的架子底下。',
    '血落在纸上，把字泡开了。'
  ]},
  c5_outro_b: { speaker:'说书人', mode:'tea', cond:Kl5, next:'c5_outro_end', lines:[
    '无名没有杀他。',
    '那人到现在还坐在楼里，',
    '守着一座空架子。'
  ]},
  // 说书人开始辩解
  c5_outro_end: { speaker:'说书人', mode:'tea', next:null, lines:[
    '诸位当中，有人皱眉头了。',
    '我知道诸位在想什么。',
    '——故事总要有个准头。',
    '可准头是听的人给的，不是事给的。'
  ]},

  /* ══ 第六回 · 城楼夜 ═══════════════════════════════════════════════ */

  c6_intro: { speaker:'说书人', mode:'tea', next:'c6_intro_b', lines:[
    '最后一处是城楼。',
    '那天夜里月亮很大。',
    '——诸位若在别处听过别的说法，',
    '请听我的。'
  ]},
  c6_intro_b: { speaker:'说书人', mode:'tea', next:'c6_card', lines:[
    '城楼上站着一个人。',
    '他和无名是一个师父教的。',
    '比无名早十年下山。'
  ]},
  c6_card: { speaker:'', mode:'card', next:null, lines:['第六回','城楼夜'] },

  // 教：招多了带不动，得挑着换
  c6_t_all: { speaker:'说书人', mode:'narration', next:null, lines:[
    '一路上遇见的人，这里都有。',
    '带不动的，就得放下。'
  ]},
  c6_t_ghost: { speaker:'说书人', mode:'narration', next:null, lines:[
    '城上这些人，他一个个都见过。',
    '有的在竹林，有的在楼上，',
    '有的在河边。',
    '他们不认得他。'
  ]},
  c6_t_moon: { speaker:'说书人', mode:'narration', next:null, lines:[
    '月亮很大，把影子拉得很长。',
    '影子比人先到。'
  ]},
  c6_t_last: { speaker:'', mode:'narration', next:null, lines:[
    '再往前就没有路了。',
    '城墙尽头站着一个人，',
    '和一张空着的纸。'
  ]},
  wall_c6_a: { speaker:'', mode:'narration', next:null, lines:[
    '城砖上有人写过：',
    '囊中只容四物'
  ]},
  wall_c6_b: { speaker:'', mode:'narration', next:null, lines:[
    '旗杆下压着一张纸：',
    '缺一页'
  ]},

  c6_boss_pre: { speaker:'师兄', mode:'talk', next:'c6_boss_pre_a2', lines:[
    '我等了很久。',
    '不是等你来，是等你走到这里。',
    '前面六回，你走得还算像样。'
  ]},
  c6_boss_pre_a2: { speaker:'师兄', mode:'talk', next:'c6_boss_pre_b', lines:[
    '那本书我也看过。',
    '比你早十年。'
  ]},
  c6_boss_pre_b: { speaker:'师兄', mode:'talk', next:'c6_boss_pre_c', lines:[
    '我看到最后一页，缺了一张。',
    '缺的那张，是结局。'
  ]},
  c6_boss_pre_c: { speaker:'无名', mode:'talk', next:'c6_boss_pre_d', lines:['你说完了？'] },
  c6_boss_pre_d: { speaker:'师兄', mode:'talk', next:'c6_boss_pre_e', lines:[
    '这个故事要有个结局。',
    '你死了，它才算数。'
  ]},
  c6_boss_pre_e: { speaker:'无名', mode:'talk', next:null, lines:['那就讲吧。'] },

  // 教：第三阶段他会现学玩家用过的招
  c6_boss_p3: { speaker:'师兄', mode:'talk', next:'c6_boss_p3_b', lines:[
    '你用过的，我都会。',
    '不难。',
    '你使一次，我就见过一次。'
  ]},
  c6_boss_p3_b: { speaker:'师兄', mode:'talk', next:null, lines:[
    '现在你看着。',
    '这一招是你的。',
    '我使起来，也一样顺手。'
  ]},
  c6_boss_p2: { speaker:'师兄', mode:'talk', next:null, lines:[
    '你这一路，走得比书上慢。',
    '书上你现在应该已经死了。'
  ]},
  c6_boss_down: { speaker:'', mode:'narration', next:'c6_boss_down_b', lines:[
    '师兄坐在垛口上，',
    '背后是整座空城。',
    '他笑了一下，像是松了口气。'
  ]},
  c6_boss_down_b: { speaker:'师兄', mode:'talk', next:null, lines:[
    '写完了？',
    '那你替我看看——',
    '最后一页，写的是谁。'
  ]},

  // ★ 矛盾（第三次）
  c6_outro: { speaker:'说书人', mode:'tea', next:'c6_outro_a', lines:[
    '天快亮了。',
    '城下没有人。'
  ]},
  c6_outro_a: { speaker:'说书人', mode:'tea', cond:Sp6, next:'c6_outro_b', lines:[
    '无名一剑穿过去。',
    '师兄往后倒，从城楼上掉下去了。',
    '底下很黑，没听见声音。'
  ]},
  c6_outro_b: { speaker:'说书人', mode:'tea', cond:Kl6, next:'c6_outro_end', lines:[
    '无名把剑插回鞘里。',
    '师兄还坐在垛口上。',
    '两个人一直坐到天亮。'
  ]},
  // 说书人彻底转向听众
  c6_outro_end: { speaker:'说书人', mode:'tea', next:null, lines:[
    '诸位。',
    '诸位听得比我清楚么？',
    '诸位在场么？',
    '……',
    '茶凉了，我再说最后一回。'
  ]},

  /* ══ 终回 · 说剑 ═══════════════════════════════════════════════════ */

  f_intro: { speaker:'说书人', mode:'tea', next:'f_intro_b', lines:[
    '第七回，没有地方可去了。',
    '他回到这间茶馆。',
    '坐下，要了一壶茶。'
  ]},
  f_intro_b: { speaker:'', mode:'narration', next:'f_card', lines:[
    '然后有人把醒木递给他。',
    '他接了。'
  ]},
  f_card: { speaker:'', mode:'card', next:null, lines:['终回','说剑'] },

  f_t_rain: { speaker:'', mode:'narration', next:null, lines:[
    '二十年后的雨，和那年一样。',
    '茶馆的门槛磨低了一指。'
  ]},
  f_t_seat: { speaker:'', mode:'narration', next:null, lines:[
    '堂里的桌椅还是老样子。',
    '靠窗那个位子空着。',
    '二十年前他坐过。'
  ]},
  f_t_chake: { speaker:'茶博士', mode:'talk', next:null, lines:[
    '先生，今日说哪一段？',
    '客人爱听杀人的。'
  ]},

  // 揭晓：说书人＝主角
  f_reveal: { speaker:'', mode:'narration', next:'f_reveal_b', lines:[
    '台上那个人，穿一件旧衫子。',
    '案上一块醒木，一把没开刃的剑。'
  ]},
  f_reveal_b: { speaker:'说书人', mode:'talk', next:'f_reveal_c', lines:[
    '这故事我讲了二十年。',
    '每年都不太一样。',
    '年头改一点，年尾改一点。'
  ]},
  f_reveal_c: { speaker:'说书人', mode:'talk', next:'f_reveal_c2', lines:[
    '头几年我讲得实在。',
    '实在的没人听。',
    '后来我就改。'
  ]},
  f_reveal_c2: { speaker:'说书人', mode:'talk', next:'f_reveal_c3', lines:[
    '改到人肯听，我自己也就信了。',
    '看官，这不难。',
    '我信了二十年。'
  ]},
  f_reveal_c3: { speaker:'说书人', mode:'talk', next:'f_reveal_d', lines:[
    '改到后来，',
    '哪一段是我做的，哪一段是我说的，',
    '我自己也分不清了。'
  ]},
  f_reveal_d: { speaker:'无名', mode:'talk', next:'f_reveal_e', lines:['我不记得了。'] },
  f_reveal_e: { speaker:'', mode:'narration', next:null, lines:[
    '台上台下，是同一个人。',
    '说的和听的，也是。'
  ]},

  /* ── 结局 ──────────────────────────────────────────────────────── */
  // 入口无 cond。四支互斥穷尽：集大成 → 杀尽 → 留手 → 中间态。
  f_end: { speaker:'说书人', mode:'tea', next:'f_end_all', lines:[
    '说到这里，天也晚了。',
    '诸位要问：后来呢？'
  ]},

  // 集大成（学满 12 招）
  f_end_all: { speaker:'说书人', mode:'tea', cond:EndAll, next:'f_end_all_b', lines:[
    '后来他身上什么都有了。',
    '横云断是雨中刀的。',
    '裂帛是铁笛先生的。',
    '撑天是老翁的。'
  ]},
  f_end_all_b: { speaker:'说书人', mode:'tea', cond:EndAll, next:'f_end_all_b2', lines:[
    '孤影是白衣的。',
    '无锋是守阁人的。',
    '说剑是师兄的。'
  ]},
  f_end_all_b2: { speaker:'说书人', mode:'tea', cond:EndAll, next:'f_end_all_b3', lines:[
    '破雨是路上那些刀客的。',
    '穿杨是弓手的。',
    '镇山是枪兵的。',
    '连环腿是力士的。'
  ]},
  f_end_all_b3: { speaker:'说书人', mode:'tea', cond:EndAll, next:'f_end_all_c', lines:[
    '踏云是雪山的风给的。',
    '焚书是那把火给的。',
    '十二样，一样不缺。'
  ]},
  f_end_all_c: { speaker:'无名', mode:'talk', cond:EndAll, next:'f_end_all_d', lines:['都不是我的。'] },
  f_end_all_d: { speaker:'', mode:'narration', cond:EndAll, next:'f_end_all_e', lines:[
    '他把书拿出来，就着灯点了。',
    '字一个一个散开，',
    '散成墨，落回纸上。',
    '纸是白的。'
  ]},
  // 最后一屏：空白宣纸 ＋ 一枚朱砂印（印文「无名」）
  f_end_all_e: { speaker:'', mode:'card', cond:EndAll, next:'f_end_kill',
                 seal:'无名', lines:['不说了。'] },

  // 杀尽（mercy=0）
  f_end_kill: { speaker:'说书人', mode:'tea', cond:EndKill, next:'f_end_kill_b', lines:[
    '这一版讲得最好。',
    '六个人，一个不留。',
    '干净，利落。',
    '听的人才记得住。'
  ]},
  f_end_kill_b: { speaker:'说书人', mode:'tea', cond:EndKill, next:'f_end_kill_c', lines:[
    '看官请看这满堂——',
    '座无虚席。'
  ]},
  f_end_kill_c: { speaker:'', mode:'narration', cond:EndKill, next:'f_end_kill_d', lines:[
    '后排靠窗那位，从头听到尾，',
    '一句话也没说。',
    '他腰里那把剑，也没有开刃。'
  ]},
  f_end_kill_d: { speaker:'说书人', mode:'tea', cond:EndKill, next:'f_end_mercy', lines:[
    '今日就到这里。',
    '明日请早。'
  ]},

  // 留手（mercy≥4）——回环到楔子
  f_end_mercy: { speaker:'说书人', mode:'tea', cond:EndMercy, next:'f_end_mercy_b', lines:[
    '这一版没人爱听。',
    '六个人，一个也没杀。',
    '没有仇，没有血。',
    '讲到一半，走了三桌。'
  ]},
  f_end_mercy_b: { speaker:'', mode:'narration', cond:EndMercy, next:'f_end_mercy_c', lines:[
    '讲完的时候，堂里只剩茶博士。',
    '他在擦桌子。'
  ]},
  f_end_mercy_c: { speaker:'', mode:'narration', cond:EndMercy, next:'f_end_mercy_d', lines:[
    '他把醒木放下。',
    '茶还温着，他没喝。',
    '他走出去了。'
  ]},
  f_end_mercy_d: { speaker:'', mode:'narration', cond:EndMercy, next:'f_end_mercy_e', lines:[
    '门外在下雨。',
    '雨里有一间茶馆，灯还亮着。',
    '他进去，找了个位子坐下。'
  ]},
  f_end_mercy_e: { speaker:'', mode:'narration', cond:EndMercy, next:'f_end_mercy_f', lines:[
    '台上有人一拍醒木。',
    '「话说江湖……」'
  ]},
  f_end_mercy_f: { speaker:'', mode:'narration', cond:EndMercy, next:'f_end_mid', lines:[
    '他要了一壶茶，坐着听。',
    '这一版他没听过。',
    '听完就走。'
  ]},

  // 中间态（mercy 1–3）
  f_end_mid: { speaker:'说书人', mode:'tea', cond:EndMid, next:'f_end_mid_b', lines:[
    '这一版……',
    '杀了几个，留了几个。',
    '我讲的时候常记岔。'
  ]},
  f_end_mid_b: { speaker:'说书人', mode:'tea', cond:EndMid, next:'f_end_mid_b2', lines:[
    '有时说他杀了，有时说他没杀。',
    '改一回，就少记得一点。'
  ]},
  f_end_mid_b2: { speaker:'说书人', mode:'tea', cond:EndMid, next:'f_end_mid_c', lines:[
    '如今我手里这一版，',
    '是改了二十年的那一版。',
    '看官若问哪个是真的——'
  ]},
  f_end_mid_c: { speaker:'说书人', mode:'tea', cond:EndMid, next:null, lines:[
    '我也想问。',
    '散了吧。'
  ]}

  };
})(window.SJ = window.SJ || {});
