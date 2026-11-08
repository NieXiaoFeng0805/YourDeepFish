# 小肥鱼 · 桌面宠物

一只常驻 Windows 桌面的女仆小肥鱼：无边框、透明、置顶、可拖拽、像素级点击穿透，会呼吸会摇摆，被扔出去会弹两下，下载目录有新文件时会提醒你。

架构采用**内核 + 外壳**双形态：`core/` 负责「想」和「做」（触发、任务、权限、审计），`electron/` 只负责「演」（渲染与物理）。同一套内核以后可以直接换 DSH / VSCode 插件外壳。

![预览](build/preview.png)

## 快速开始

```powershell
npm install
npm start
```

> 本机若设置了 `ELECTRON_RUN_AS_NODE=1`（例如在 Electron 宿主的终端里），启动前要先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`，否则 Electron 会以 Node 模式运行并报 `ipcMain` 未定义。

单独跑内核（不启动桌宠）：

```powershell
npm run core
```

## 形象基准

唯一形象来源是 `assets/raw/maid.png` 与 `dataset/raw/` 的夜景参考图。当前使用三种姿态：坐姿茶杯（默认）、眨眼（开心）、躺姿（睡觉），统一按头部宽度 192px（2 倍图）归一。窗口 260×340，角色按姿态自然尺寸绘制、底部锚定。

形象识别点与主色板见 [角色设定卡](<docs/角色设定.md>)，性格与台词见 [人设与台词](<docs/人设.md>)：

![设定卡](<docs/character-sheet.png>)

## 交互

| 操作 | 效果 |
| --- | --- |
| 左键拖拽 | 拎起来，松手按抛物线飞出、落地回弹 |
| 单击 | 随机吐槽一句，偶尔闹脾气 |
| 双击 | 摸摸头 |
| 右键 | 托盘菜单 |
| 托盘左键 | 显示 / 隐藏 |
| 气泡 | 内核有话要说时出现，8 秒自动收起 |

生气不再切换立绘，而是**轻微抖动 + 气泡变粉红**——单帧形象下这样最稳，也不会出现两个画风。

## 权限分级

内核执行任何工具前都会检查等级，超出上限直接拒绝并写审计日志。

| 级别 | 能力 | 当前策略（L1） |
| --- | --- | --- |
| L0 | 只读观察 | 自动 |
| L1 | 本地写入 | 自动 + 事后汇报 |
| L2 | 执行命令 | 拒绝（待接入确认弹窗） |
| L3 | 对外发送 | 拒绝（待接入二次校验） |

改 `data/config.json` 的 `allowLevel` 可调整；设为 `0` 即完全只读。

## 自动行为（L0–L1）

- **每日 09:00** 归档下载目录：把 10 分钟以上未改动的文件按类型移进 `_小肥鱼归档/`，只移动不删除，每次写 `data/logs/moves-*.json` 便于回滚。
- **下载目录监视**：出现新文件时气泡提示（90 秒冷却，避免刷屏）。
- **空闲提醒**：连续 20 分钟无键鼠活动提示起身，30 分钟内不重复。
- **剪贴板**：文本超过 800 字时提议总结（只拿到字数与哈希，全文留在本地）。

## 目录

```
packages/core/       内核：WS 服务、触发调度、工具、审计、人设台词
packages/desktop/    桌面外壳：主进程、预加载、渲染（Canvas 2D）
packages/plugin-dsh/ DSH 浏览器外壳：shell.overlay 悬浮层（实验）
assets/char/         抠好的角色姿态（坐姿 / 眨眼 / 躺姿）
assets/icon/         托盘与图标
tools/               构建与验证脚本（素材、设定卡、冒烟测试、插件 harness）
data/                配置、审计、便签（运行时生成）
```

## 素材处理

```powershell
python tools/build_assets.py
python tools/character_sheet.py
```

- 白底抠图：只去掉与画布边缘连通的近白像素，保留裙子与围裙的白色。
- 角色按高度归一（900px 源图 → 窗口内 340px）。
- 托盘图标取头部区域裁切。

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `npm start` | 启动桌面桌宠 |
| `npm run core` | 只启动内核 |
| `npm run qa` | 离屏渲染截图到 `build/preview.png`，**不会在屏幕上弹窗** |
| `node tools/smoke.js` | 内核闭环测试：监视 → 归档 → 审计 |
| `python tools/build_plugin_client.py` | 重新生成插件客户端（内联角色图） |
| `electron tools/harness/main.js` | 在本地 harness 里验证插件渲染 |

## DSH 插件（实验）

`packages/plugin-dsh` 是一个 DSH 浏览器插件：注册到 `shell.overlay`，在界面右下角画一只会呼吸、可点击的小肥鱼。角色图以 base64 内联进 `lib/client.js`，不依赖宿主静态路由。

```powershell
# 生成客户端（改了姿态图之后）
python tools/build_plugin_client.py

# 本地验证（不需要重启 DSH）
electron tools/harness/main.js
```

安装到 DSH profile 需要重启宿主，步骤如下（会中断当前会话）：

```powershell
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add file:D:\桌宠小肥鱼\packages\plugin-dsh
# 然后把 dsh-yourdeepfish 加进 package.json 的 dsh.profile.bundles，重启 DSH
```

## 已知问题

- 单帧形象，没有眨眼与口型；如需实现要补「闭眼 / 张嘴」差分帧。
- 脚下投影已从素材中移除，落地时没有独立阴影（后续可做程序化阴影）。
- 安装包未签名，打包后首次运行会触发 SmartScreen 提示。
- 开机自启只在打包后生效（开发模式会写到 electron.exe，已禁用）。

## 下一步

1. 补「闭眼」「张嘴」两张同角度差分帧，换眨眼与说话口型。
2. 审批 UI：L2/L3 操作由桌宠弹气泡请示，确认后才执行。
3. 能力插件化：`manifest.json` + 工具注册表热加载。
4. 外壳二：把同一套 Canvas 渲染塞进 DSH / VSCode Webview。
