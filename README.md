# 星喰いの遺物 · Hoshikui no Ibutsu

一件不规则的星之遗物悬浮在石台上，远处一颗星星是世界里唯一的光源。玩家推倒遗物、翻开它的外壳碎片，让体内的一滴星光液滴沿凹槽滚进核心。最后一关里，遗物会把那颗星吞下去。

这是一个**完全没有文字**的 3D 解谜小游戏：菜单、按钮、提示、进度都只用图标、光和动态来表达。五关，十几分钟通关，桌面浏览器和手机浏览器共用同一套代码。

> 作品集说明：评审时间有限的话，可以在网址后面加上 `?all` 解锁全部章节，再从左下角的章节图标直接跳到第 4、5 关。

---

## 怎么玩

| 操作 | 桌面 | 手机 |
|---|---|---|
| 开始 | 点击呼吸发光的遗物 | 点击遗物 |
| **翻滚**（推倒遗物，换一个面贴地） | 在遗物上按住，往某个方向拖，超过一段距离后松手 | 在遗物上按住拖动 |
| **折叠**（翻开或合上碎片） | 点击带蓝色星脉的铰链或碎片 | 点击 |
| 转动视角 | 在背景上拖动；滚轮缩放 | 在背景上拖动；双指缩放 |
| 撤销 / 重置 / 菜单 | 右上角图标（也可以用 `Z` / `R` / `Esc`） | 右上角图标 |
| 键盘翻滚 | 方向键按屏幕方向推倒遗物；数字键 `1–3` 折叠碎片 | — |

规则只有三条：

1. **翻滚会改变重力。** 哪个面贴地，遗物内部的“下”就是哪个方向，液滴沿凹槽一路滚到停下为止。
2. **折叠会改变形状。** 翻开碎片可以让一个原本立不住的面撑住（第 3 关）；碎片也会接通或切断凹槽、挡住或露出裂缝。
3. **星光只照得进正对星星的裂缝。** 光射进去时，会显现隐藏的金色凹槽；最后一关还要用星光点亮核心。

卡住了不用着急：闲置 30 秒后，下一步要动的部位会呼吸发光；连续三次无效操作，会出现一只半透明的手做一次示范。

## 技术亮点

- **纯逻辑层和渲染层完全分离。** `src/puzzle/` 不 import Three.js：`rules.ts` 是纯函数 `(关卡, 状态, 动作) → 新状态`，可以直接在 Node 里跑。渲染层只读取状态、播放插值动画，不做任何物理模拟，所以判定稳定、公平、可复现。
- **BFS 求解器保证每一关都有解、而且没有死局。** `npm run verify-levels` 会对每一关穷举所有可到达的状态，检查：有解；最短步数落在设计区间内；**任何**可到达的状态都还能走到终点；初始状态不是已通关。关卡数据只能靠通过这个脚本来调，不能手调到“看起来能玩”。同一个求解器也负责游戏里的提示和手势示范。
- **几何也经过校验。** 遗物外形由一组切割平面相交生成，每个落地姿态都对应一个真实的面。校验脚本还会确认：相邻姿态的两个面确实共用一条棱；每条裂缝都在外壳表面上；翻开的碎片永远不会插进台座。
- **零语言设计。** 画面里没有一个字：所有按钮都是内联 SVG；“可以开始”用呼吸光提示；进度用遗物表面点亮的星脉和顶部的光点表示；章节用 1–5 颗星组成的小星座区分顺序。反馈不只靠颜色，也靠形状和动态：成功时光流动、聚拢、扩散，无效操作时轻轻回弹、闪一下就灭。蓝色只用在可以操作的部位上。
- **只依赖浏览器本身。** 音效全部用 WebAudio 实时合成（翻滚落地、液滴滚动、星光射入、过关、结局），没有外部模型、贴图或音频文件。移动端会自动关闭 Bloom，并减少星点数量。

## 本地运行

需要 Node 18 或更高版本。

```bash
npm install
npm run dev            # 开发服务器
npm test               # 规则单元测试（Vitest）
npm run verify-levels  # 关卡求解与校验，任何一项 FAIL 都会以非零码退出
npm run build          # 类型检查 + 构建出纯静态的 dist/
npm run preview        # 本地预览 dist/
```

当前的 `verify-levels` 输出：

```
| level | solvable | minMoves        | noDeadEnds (dead/reach) | initNotWon | structure | geometry | solution                |
| l1    | PASS yes | PASS 2 in [2,3] | PASS 0/18               | PASS ok    | PASS ok   | PASS ok  | →N →B                   |
| l2    | PASS yes | PASS 3 in [3,5] | PASS 0/19               | PASS ok    | PASS ok   | PASS ok  | →E →N →B                |
| l3    | PASS yes | PASS 3 in [3,5] | PASS 0/15               | PASS ok    | PASS ok   | PASS ok  | →E ⟲p →S                |
| l4    | PASS yes | PASS 6 in [5,7] | PASS 0/45               | PASS ok    | PASS ok   | PASS ok  | →N ⟲a ⟲p →W ⟲p →S       |
| l5    | PASS yes | PASS 8 in [6,9] | PASS 0/98               | PASS ok    | PASS ok   | PASS ok  | →N ⟲a ⟲p →B ⟲p →S →W ⟲q |
```

浏览器端的冒烟测试（需要先运行 `npm run preview`，并且本机有 Chromium，可以用环境变量 `CHROME` 指定路径）：

```bash
node tests/e2e/shoot.mjs  http://localhost:4173/ shots   # 截图 + 控制台错误 + 画面文字检查
node tests/e2e/levels.mjs http://localhost:4173/ shots   # 按求解器的解法打通全部五关直到结局
node tests/e2e/ui.mjs     http://localhost:4173/ shots   # 用真实指针 / 触摸输入走一遍 UI 流程
```

URL 参数：`?all` 解锁全部章节（作品集模式）；`?debug` 会暴露 `window.__hoshikui`，供上面的测试脚本使用。

## 部署到 GitHub Pages

`vite.config.ts` 已经设置了 `base: './'`，`dist/` 可以放在任意子路径下。下面的步骤需要你自己执行，本仓库不会自动推送。

**方式 A：GitHub Actions（推荐）**

1. 在 GitHub 上新建一个空仓库，例如 `hoshikui`。
2. 关联远端并推送：
   ```bash
   git remote add origin git@github.com:<你的用户名>/hoshikui.git
   git push -u origin main
   ```
3. 在仓库的 **Settings → Pages → Build and deployment** 里，把 Source 选为 **GitHub Actions**。
4. 仓库里已经带有 `.github/workflows/deploy.yml`：每次推送到 `main` 都会运行测试、关卡校验和构建，再把 `dist/` 发布出去。几分钟后访问 `https://<你的用户名>.github.io/hoshikui/` 即可。

**方式 B：手动发布 `gh-pages` 分支**

```bash
npm run build
npx gh-pages -d dist        # 把 dist/ 推送到 gh-pages 分支
```

然后在 **Settings → Pages** 里选择 `gh-pages` 分支的根目录。

## 目录结构

```
src/
  main.ts               入口
  game.ts               流程：标题 → 关卡 → 结局，历史栈、提示、输入路由
  puzzle/               纯逻辑层（不依赖 Three.js）
    types.ts  rules.ts  solver.ts  geometry.ts  math.ts
  levels/               level1.ts … level5.ts（纯数据，由切割平面生成外形）
  scene/                渲染器、相机、星空、星星、台座、Bloom
  relic/                遗物、凹槽、液滴、碎片、裂缝与光束、碎裂重组过场
  input/                Pointer Events：视角旋转 / 翻滚拖动 / 铰链点击
  ui/                   SVG 图标、HUD、章节星弧、菜单、示范手势
  audio/                WebAudio 程序化音效
  save.ts               localStorage（键名 hoshikui.v1，所有读写都包在 try/catch 里）
scripts/verify-levels.ts
tests/rules.test.ts     规则单元测试
tests/e2e/              Playwright 冒烟测试脚本
```

## 已知限制

- 翻滚动画是“绕接地棱旋转”加上一小段朝目标朝向的偏航修正。相邻面之间的二面角不是 90° 时，落地前能看到一点轻微的扭转。
- 碎片挡光是用数据定义的。光束会停在挡住它的那块碎片上，但碎片的位置并不严格位于星星和裂缝的连线上。
- 自动化测试跑在无 GPU 的软件渲染（SwiftShader）上，没有在真实的 iPhone 和 Android 设备上实测。
