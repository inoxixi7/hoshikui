# 星喰いの遺物 · Hoshikui no Ibutsu

一件星之遗物悬浮在石台上，远处一颗星星是世界里唯一的光源。玩家推倒遗物、让星光照进裂缝，借助外壳上亮起的星脉制造视觉错位，让体内的一滴星光液滴一路滚进核心。最后一关里，遗物会把那颗星吞下去。

这是一个**完全没有文字**的 3D 解谜小游戏：菜单、按钮、提示、进度都只用图标、光和动态来表达。五关，十几分钟通关，桌面浏览器和手机浏览器共用同一套代码。

> 作品集说明：评审时间有限的话，可以在网址后面加上 `?all` 解锁全部章节，再从左下角的章节图标直接跳到第 4、5 关。

---

## 怎么玩

| 操作 | 桌面 | 手机 |
|---|---|---|
| 开始 | 点击呼吸发光的遗物 | 点击遗物 |
| **翻滚**（往哪边推，遗物就从那一侧的棱翻过去） | 在遗物上按住，往任意方向拖，超过一段距离后松手 | 在遗物上按住拖动 |
| **水平转动**（遗物在台座上原地转 90°） | 在台座（蓝色圆环一带）上按住，绕着遗物拖动 | 同左 |
| 偷看 | 在背景上拖动可以转动视角；松手后视角会自动回到正面 | 同左；双指缩放 |
| 撤销 / 重置 / 菜单 | 右上角图标（也可以用 `Z` / `R` / `Esc`） | 右上角图标 |
| 键盘 | 方向键按屏幕方向推倒遗物；`Q` / `E` 水平转动 | — |

规则只有三条：

1. **翻滚会改变重力。** 遗物可以朝四个方向自由翻滚，每次绕接地的那条棱转 90°；也可以在台座上原地水平转动 90°。哪个面贴地，遗物内部的“下”就是哪个方向，液滴沿凹槽一路滚到停下为止。水平转动不改变重力，但会改变裂缝朝向和屏幕上的重叠。
2. **星光只照得进正对星星的裂缝。** 光射进去时，会显现隐藏的金色通路。
3. **看起来连着，就是连着。** 遗物外壳上刻着五条星脉，每通过一关，就会点亮一条，并在之后的关卡里一直可用。画面是固定的等轴测视角：当某条亮起的星脉端点和内部凹槽在屏幕上重叠时，液滴就能从一处走到另一处，就像纪念碑谷里那样。

卡住了不用着急：闲置 30 秒后，台座边缘会亮起下一步该推的方向；连续三次无效操作，会出现一只半透明的手做一次示范。

## 技术亮点

- **纯逻辑层和渲染层完全分离。** `src/puzzle/` 不 import Three.js：`rules.ts` 是纯函数 `(关卡, 状态, 动作) → 新状态`，可以直接在 Node 里跑。遗物朝向用整数旋转矩阵精确表示（立方体的 24 种旋转），翻滚是精确的 90° 转动，不做物理模拟，判定稳定、可复现。
- **视觉错位也是纯逻辑。** 视角固定为等轴测、正交投影，“屏幕上重叠”就可以用投影坐标精确计算，不受分辨率和设备影响。规则层直接判断哪些星脉端点和凹槽节点在当前朝向下重叠，求解器把这些重叠当作真实的连接来搜索。
- **BFS 求解器保证每一关都有解、而且没有死局。** `npm run verify-levels` 会对每一关穷举所有可到达的状态，检查：有解；最短步数落在设计区间内；任何可到达的状态都还能走到终点；初始状态不是已通关。另外还会检查每关的设计意图：第 2 关不借助星光就无解，第 3 关不借助星脉错位就无解，第 4、5 关两者缺一不可。同一个求解器也负责游戏里的提示和手势示范。
- **关卡由搜索生成，再交给校验把关。** `scripts/design-levels.ts` 在共用的遗物里随机生成凹槽网络，用求解器筛出符合每关意图的候选；最终数据仍然必须通过 `verify-levels`。
- **零语言设计。** 画面里没有一个字：所有按钮都是内联 SVG；“可以开始”用呼吸光提示；进度用遗物表面点亮的星脉和顶部的光点表示；章节用 1–5 颗星组成的小星座区分顺序。反馈不只靠颜色，也靠形状和动态。
- **只依赖浏览器本身。** 音效全部用 WebAudio 实时合成，没有外部模型、贴图或音频文件。移动端会自动关闭 Bloom，并减少星点数量。

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
| level | solvable | minMoves        | noDeadEnds (dead/reach) | initNotWon | needs            | structure | geometry | solution                |
| l1    | PASS yes | PASS 2 in [2,3] | PASS 0/89               | PASS ok    | PASS tumble      | PASS ok   | PASS ok  | px nx                   |
| l2    | PASS yes | PASS 3 in [3,5] | PASS 0/132              | PASS ok    | PASS light       | PASS ok   | PASS ok  | nz nz nx                |
| l3    | PASS yes | PASS 3 in [3,5] | PASS 0/186              | PASS ok    | PASS veins       | PASS ok   | PASS ok  | px nx px                |
| l4    | PASS yes | PASS 7 in [5,7] | PASS 0/161              | PASS ok    | PASS light veins | PASS ok   | PASS ok  | px px pz nz px px pz    |
| l5    | PASS yes | PASS 8 in [6,9] | PASS 0/304              | PASS ok    | PASS light veins | PASS ok   | PASS ok  | nx px pz nx nx pz pz nz |
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
  levels/               relic.ts（共用的遗物外形与五条星脉）+ level1.ts … level5.ts
  scene/                渲染器、相机、星空、星星、台座、Bloom
  relic/                遗物、凹槽、星脉与错位闪光、液滴、裂缝与光束、碎裂重组过场
  input/                Pointer Events：视角偷看 / 翻滚拖动
  ui/                   SVG 图标、HUD、章节星弧、菜单、示范手势
  audio/                WebAudio 程序化音效
  save.ts               localStorage（键名 hoshikui.v1，所有读写都包在 try/catch 里）
scripts/verify-levels.ts   关卡校验
scripts/design-levels.ts   关卡搜索生成器
tests/rules.test.ts     规则单元测试
tests/e2e/              Playwright 冒烟测试脚本
```

## 已知限制

- 视觉错位只在正面的等轴测视角下成立。拖动背景偷看时，错觉会被打破（这是有意的），松手后视角会回正。
- 关卡的凹槽网络由搜索生成，路线偏几何化，不像手工设计那样有叙事感。
- 自动化测试跑在无 GPU 的软件渲染（SwiftShader）上，没有在真实的 iPhone 和 Android 设备上实测。
