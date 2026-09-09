# 说剑

一款中国水墨风的横版过关游戏。一个不会武功的人，背一柄没开刃的剑，走了六处地方，见了六个人。

纯浏览器运行，**零外部素材**：所有画面是程序化的毛笔笔触，所有声音是 Web Audio 合成。约三十到五十分钟一周目，四个结局。

## 开始

- macOS：双击 `开始游戏.command`（起一个本地静态服务并打开浏览器）。
- 其它系统：在仓库根目录起任意静态服务，打开 `index.html`，例如 `python3 -m http.server 8765` 然后访问 `http://127.0.0.1:8765/`。

游戏里没有教程，玩法靠自己摸索。下面只列键位。

| 键 | |
|---|---|
| A / D，← / → | 左右 |
| W / ↑ | 上、跳、互动 |
| S / ↓ | 下 |
| 空格 | 跳、确认 |
| J，鼠标左键 | 攻击、确认 |
| K，鼠标右键 | 按住 |
| L / Shift | 身法 |
| U / I / O / P | 四个格子 |
| F | 互动 |
| Esc | 暂停 |

## 手册

`docs/手册.html`（源稿 `docs/手册.md`）是通关后的完整手册：故事、人物、设定、十二招、图鉴、导览。**含全部剧透**，建议打完再看。

## 仓库结构

```
index.html          入口（脚本加载顺序在此写死）
src/                游戏源码：core / render / audio / combat / entity / level / story / ui / data
dev/                无头自检与工具：smoke、player-check、level-check、enemy-check、autoplay（八关通关机器人）…
docs/               手册
_spec/              设计总纲、剧本总纲、接口契约与决议、各模块笔记、QA 截图（含剧透）
```

自检：

```
node dev/smoke.js && node dev/player-check.js && node dev/level-check.js && node dev/script-check.js && node dev/enemy-check.js
```

## 怎么做出来的

由一队 AI 代理（Claude Code agent team）并行实现：先写设计总纲与接口契约，再分引擎、水墨、音频、剧本、战斗、敌人、关卡七路；第二波四路做可靠性与打磨。过程中的二十七条决议在 `_spec/CONTRACTS.md`。
