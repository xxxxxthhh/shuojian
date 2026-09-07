# C（音频）实现笔记

`src/audio/audio.js`：纯 Web Audio 程序化合成，零音频文件，classic script，挂 `window.SJ.Audio`。
`dev/audio.html`：测试台（32 个 sfx 按钮 + 11 个 music 按钮 + intensity 滑杆 + 静音开关 + duck 按钮）。

已用 `node --check` 验证语法；已在 Chrome 里逐个点击全部 32 个 sfx、全部 11 首 music（含互相切换/crossfade）、intensity 滑杆、静音开关、`duck()`，控制台无本文件产生的报错。**没有人耳验证音色是否好听**——这需要 Lead 或其他人实际听一遍 `dev/audio.html` 把关。

第一版实现后经 advisor 复核，发现并修复了两个只会"静默出错"、点击测试测不出来的 bug（因为它们不抛异常，只是声音提前变哑/密集卡顿）：
1. `noiseBurst` 曾用 `noiseBufShort`（仅 0.4s，不循环）承载时长 0.4–1.2s 的包络（`wind` 0.9s / `door` 的 creak 0.55s / `tea` 的碗碟嗡嗡 0.5s / `library` 的纸声最长 0.6s），超过 0.4s 后噪声源播完变成真空，只剩衰减的静音——已修：噪声源统一 `loop=true`。
2. `makeScheduler`（inn/wall/boss/final 的鼓点用）在浏览器标签页切到后台被节流后，`setTimeout` 会大幅迟到，`ctx.currentTime` 却仍在走；恢复前台时 `while` 循环会把积压的好几拍全部压在同一瞬间触发，造成一声鼓点爆炸——已加 `if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05;` 归位后再排程。
两处修复后已重新跑过 `node --check` 与浏览器点击回归（含 wind/door 单独复测 + 11 首歌完整轮播），无报错。

## 全局信号链

```
sfxBus ──┐
musicBus ┴─ preBus ─┬─ dryGain(0.9) ──────────────┐
                     └─ convolver(1.6s 程序化脉冲响应) ─ wetGain(0.30) ─┴─ master(0.9) ─ muteGain ─ compressor ─ destination
```

- 混响：`ConvolverNode`，buffer 是程序化生成的立体声脉冲响应（`(Math.random()*2-1) * Math.exp(-4*i/len)`，1.6s），不依赖任何外部 IR 文件。
- `DynamicsCompressorNode`：threshold -20dB / ratio 4 / attack 3ms / release 250ms，防爆音。
- `setMute`：走单独的 `muteGain`，0.05s 线性斜坡到 0/1，避免咔哒声。
- `init()`：只在 `ctx` 不存在时才 `new AudioContext()`；已存在且 `suspended` 时 `resume()`。重复调用安全（已用真实点击手势与 JS 直接调用两种方式测试）。

## 节点生命周期

- 所有一次性音效（`noiseBurst/thump/blip/drum/woodClick/bellTone/pluck/flute/horn`）内部对 `AudioBufferSourceNode`/`OscillatorNode` 挂 `onended` 立即 `disconnect()` 自己的滤波/增益节点；外层包装 gain 用 `setTimeout` 兜底在音效播完后 `disconnect()`。
- `SJ.Audio.sfx()` 每次调用创建一个 `voiceBus`（vol+pan 包装），3 秒后强制 `disconnect()`（所有 sfx 时长都远小于 3 秒，这个超时只是保险丝，不影响正常播放）。
- music 的环境层（雨/风/水/雪风循环噪声）与持续音（drone）通过各自的 `stop()` 显式 `.stop()` + `.disconnect()`；`SJ.Audio.music()` 切歌时对旧 track 的 gain 做 `linearRampToValueAtTime` 淡出后延迟调用 `stop()`。
- 结论：长时间游玩不会累积节点（已用浏览器实测连续切 11 首歌 + 32 个 sfx，无异常）。

## sfx 音色对照（`o={vol,rate,pan}`；rate 只影响频率参数，不影响时长）

| 名称 | 做法 | 备注 |
|---|---|---|
| swing1/2/3 | 带通噪声频率下扫（嗖声），3 段依次更响更沉 | swing3 额外叠一个低频 thump 加重量 |
| hit / hitHeavy | 低频 sine 下扫 thump + 带通噪声瞬态 | heavy 版本更低更长 |
| parry | 磬式双泛音（1200Hz 基频）+ 极短高频噪声 | 全游戏唯一"清脆"音色，突出完美观势 |
| block | 比 hit 更闷，无高频噪声 | |
| guard | 带通噪声由低到高的"唰"声 | |
| dash / draw / sheathe / qi / arrow | 各种方向/频段的带通噪声扫频，用 freq0/freq1 区分 | draw 低→高，sheathe 高→低 |
| jump / land / step / hurt | thump + 小噪声瞬态，量级递减（step 最轻） | |
| death / enemyDeath | death 用低音古琴拨弦（110Hz）+ 噪声；enemyDeath 只用 thump+噪声更短促 | |
| learn | 磬（660Hz，4 泛音，2.2s）+ 古琴音（440Hz） | 配合"悟"的定格+藤黄闪 |
| bell | 单独磬音（523Hz，2.6s） | |
| woodclap | 高 Q（14）带通噪声，极短衰减 | 醒木/木鱼共用 |
| page/door/fire/water/wind | 带通/低通噪声不同参数；door 额外在 +0.5s 处补一个低 thump 模拟关门；fire 额外叠两个小噪声粒子模拟噼啪 | |
| ui/uiConfirm/uiBack/coin/heart | 正弦/三角波短促 blip，confirm 上扬、back 下降，coin 叠一个磬式泛音点缀，heart 双音（五度关系） | |

## music 轨道设计

统一走"五声音阶（D 宫：D E F# A B）+ 加权随机选音"生成，无写死的音序；每首曲子靠**调式音区/节奏密度/音色配比/环境层**区分：

| 轨道 | 环境层 | 核心乐器行为 |
|---|---|---|
| tea | 雨（含随机小颗粒） | 稀疏古琴单音（2.5–5s 一个）+ 极稀疏低量噪声模拟碗碟人声嗡嗡 |
| bamboo | 雨 | 笛做小步随机游走的旋律线（1.2–2.6s 一句）+ 极稀疏古琴 |
| inn | 无 | "轮指"：每次触发连打 3–6 个同音高快速拨弦模拟琵琶轮指 + 稳定鼓点（0.42s/拍，85% 概率命中） |
| river | 水 | 持续低音 drone（sine + detune LFO）+ 稀疏长音笛（1.6–2.6s） |
| snow | 雪风（很轻） | 磬，4–10s 才响一次，刻意留白 |
| library | 无 | 无节奏：偶发古琴单音（5–12s）+ 偶发"纸声"噪声（3–8s） |
| wall | 风 | 鼓点骨架（随 intensity 提速）+ 号角长音（sawtooth+lowpass，6–10s 一次） |
| boss | 无 | drone + 鼓点（密度/音量随 curIntensity 提升）+ 拍点古琴刺音；intensity>0.6 时叠加高音笛层 |
| final | 无 | 比 boss 更密：drone + 双层鼓（intensity 高时加一个偏移 0.16s 的副鼓点）+ 拍点古琴；intensity>0.4 时叠磬音高层 |
| ending | 无 | 单一古琴旋律线，2 度内小步随机游走，慢（1.8–3s 一句） |
| silence | 极轻低通噪声（房间底噪） | 无音符、无节奏 |

`intensity(v)` 内部通过一个 100ms tick 的指数平滑（时间常数 0.6s，约 1.5–1.8s 到位）把目标值追到 `curIntensity`，`boss/final/wall` 的鼓点概率、鼓点间隔、拍点音量、以及是否叠加高音层都读这个平滑值——所以推子拉动时听感是渐变而不是突变。

`duck(sec)`：把 `musicBus.gain` 快速压到 30%，保持 `sec` 秒后 0.5s 内升回，用于"悟"/过场。

调度器有两种：
- `startLoop`：普通 `setTimeout` 递归，用于不需要卡拍的稀疏事件（环境颗粒、古琴单音、纸声等）。
- `makeScheduler`：音频时钟 lookahead（提前 0.25s 排程、每 0.1s poll 一次），用于需要卡拍的鼓点（inn/wall/boss/final），避免 JS 定时器抖动影响节奏感。

## 调用方注意事项

1. **合理触发频率**：`step`（脚步）设计为极便宜（1 个噪声节点），但仍建议调用方按脚步周期触发（不要每帧调），别的 sfx 同理——虽然引擎有 3 秒兜底断开，高频调用仍会瞬间叠很多节点。`swing/hit` 类可以按攻击帧率随意触发，不用节流。
2. `SJ.Audio.music(name)` 对相同 `name` 的重复调用会被忽略（不会重启当前曲目），避免每帧/每次进关都调用导致重新起播的问题；真的想重启需要先 `music(null)` 再 `music(name)`。
3. `rate` 只按比例缩放各合成器内部的"频率类"参数，不影响包络时长；合理范围建议 0.7–1.4，超出 [0.25,4] 会被 clamp。
4. `init()` 必须在真实用户手势的回调里调用第一次（浏览器 autoplay 策略），之后可以随便调（幂等）。
5. 全局只有一份 `AudioContext`；`SJ.Audio.ready` 在 `init()` 完成后为 `true`，调用其它接口前应该检查（不过内部各方法已经在 `ready` 为 false 时直接 no-op，不会抛异常）。

## 觉得还不够好的地方（诚实反馈）

- **inn 的"轮指"和 boss/final 的鼓点节奏**是我主观设计的密度曲线，没有真人试听，可能偏机械或偏稀疏，建议实机试听后调 `makeScheduler` 里的 `stepDur`/概率常数。
- **磬/铃的泛音比**（`bellTone` 的 `partials`）是随手选的近似无理数比例，没有针对"中国磬"的真实频谱调过，可能偏"西方钟"味而不够"磬"。
- **fire/water 这几个一次性 sfx** 用单段扫频简化了真实声音的复杂包络，如果实机觉得单薄，可以再叠一层。`wind` 之前听起来单薄是上面提到的截断 bug，修好后没有再单独复听调过参数，仍可能偏简单。
- **古琴的"吟猱" pitch bend**（`pluck` 里的 `bendAmt`）幅度是拍脑袋定的 0.8%，没有对照真实古琴录音调过。
- 没有做任何“音色随 SJ.C 视觉色彩联动”的东西（比如某个特效颜色触发某个音色变化）——契约里没要求，没做，仅在此提醒可能是个加分点。
