# 安装与兼容性

> 目标：任何人按同一套步骤安装，出现问题时能在一分钟内定位到「环境不兼容 / 未重启 / 未安装」中的哪一类。

## 1. 环境矩阵

| 载体 | 看板 | 数据操作 | 说明 |
|---|---|---|---|
| 桌面应用（`dsh-app://` 壳窗口） | ✅ | ✅ | 走共享 `/api` Fetch 通道 |
| `dsh web`（命令行启动 + 浏览器） | ✅ | ✅ | 走共享 `/api`；也兼容旧的 `webServer` 前缀路由 |
| 纯终端 profile（`tui` / `headless` / `acp`） | ❌ | ✅ | 没有 Web 载体，看板不出现；用 `ptodo` CLI 与技能 |

依赖的 DSH 能力（Host）：

- `connection`（共享 `/api` Fetch 通道，必需）
- `agents`（把 sessionId 解析成会话，必需）
- `workingDirectory`（会话目录，可缺；缺失时回退到会话头 `cwd`）
- `webServer`（仅浏览器 Web 载体；可选，旧路由才用）

## 2. 安装

### 2.1 DSH 页面（Host + Client）

```bash
# GitHub（推荐；DSH 会自动把 dsh.bundle 声明登记进 profile bundles）
dsh plugin --profile <profile> add github:OptimisticGeek/dsh-project-todo

# 本地源码（开发期）
dsh plugin --profile <profile> add /absolute/path/to/dsh-project-todo
```

不要手工编辑 `dsh.profile.bundles`：`dsh plugin add` 会在 pnpm 安装后按**真实包名**自动登记；
手工编辑正是「装了但没加载 / 名字对不上」这类问题的来源。

装完**完全退出 DSH 再启动**（不是刷新页面，也不是只开新会话）。

### 2.2 CLI

```bash
git clone https://github.com/OptimisticGeek/dsh-project-todo.git
cd dsh-project-todo
npm link          # 或 npm i -g .
ptodo doctor
```

### 2.3 跨工具技能（可选）

```bash
ptodo skill install --targets all
ptodo skill status
```

## 3. 自检

页面控制台（推荐，带浏览器会话）：

```js
fetch('/api/dsh-project-todo/health').then(r => r.json()).then(console.log)
```

| 字段 | 含义 |
|---|---|
| `version` | 插件版本，用来确认装到的就是最新代码 |
| `services.agents` | `false` = 该宿主没有 agents 服务，看板无法解析会话（阻断） |
| `services.workingDirectory` | `false` = 已回退到会话头记录的目录（可用，提示级） |
| `services.webServer` | 仅浏览器 Web 载体为 true |
| `hint` | 非空时就是当前环境的可读原因 |

也可以 `curl http://127.0.0.1:<port>/api/dsh-project-todo/health`，但浏览器的 `/api` 通道需要会话 cookie，
命令行大概率返回 **401**——这不是故障，用页面控制台跑即可。

## 4. 升级

```bash
dsh plugin --profile <profile> add github:OptimisticGeek/dsh-project-todo@latest
# 或本地目录：重新 git pull 后完全重启 DSH
```

- 桌面壳与浏览器页**都要完全重启**，只刷新页面会继续用旧的客户端 bundle；
- 升级后先看 `health.version` 是否变化，再排查业务问题。

## 5. 卸载

```bash
dsh plugin --profile <profile> remove dsh-project-todo
```

数据仍在项目的 `docs/ptodo/`，不会被删除。

## 6. 排障：症状 → 原因 → 处理

| 症状 | 原因 | 处理 |
|---|---|---|
| 标签页都没有 | 包没装进该 profile / 没重启 | `dsh plugin add` 后重新启动 |
| 打开标签页，接口 404 且响应为空 | Host 半边没注册接口（旧版本 / 未重启 / 名字不一致） | 跑 `health`；确认 `version` 与包名；重新启动 |
| `NO_PROJECT: workingDirectory 服务不可用` | 3.0.0 及以前对 `workingDirectory` 硬依赖 | 升级到 ≥3.0.1（已回退会话头 `cwd`） |
| 401 | 浏览器 `/api` 通道未带会话 cookie（命令行 curl 的常见情况） | 在页面控制台自检，不要用 curl 判断 |
| `not found` / `未知接口` | Host 与 Client 版本不一致（旧 Host 新 Client） | 统一升级后完全重启 |
| 空表格但无报错 | 新项目还没有任务 | 正常；`ptodo task create` 或 `task ready` |
| 中文乱码 | PowerShell/终端编码 | `chcp 65001` 或按 UTF-8 捕获输出 |

## 7. 设计契约（本插件依赖的 DSH 接口）

| 契约 | 位置 | 本插件用法 |
|---|---|---|
| `package.json.dsh.bundle.patch` | `@deepseek-ai/dsh-package-manifest` | `cordis.patch.yml` 插入 Loader 条目，条目名 = 包名 |
| `package.json.dsh.client` | 同上 | `platform: web` + 客户端模块 id = 包名 |
| 客户端 bundle 按**已加载的 Loader 条目**组装 | `@deepseek-ai/dsh-client-modules` | Host 半边的 `apply` 必须成功，否则标签页不会出现 |
| 共享 `/api` Fetch 路由 | `@deepseek-ai/dsh-client-connection` | `ctx.connection.fetch.register({ path: '/api/dsh-project-todo/*' })` |
| 可选 Host 服务按请求获取 | Cordis | `agents` / `workingDirectory` 都在请求时 `ctx.get`，缺失时给可读错误或回退 |

> 结论：DSH 的插件契约没有「能力协商」——包只能在运行时发现自己缺什么。因此本插件把所有
> 可选依赖都降级成可读错误/回退，并用 `/health` 暴露真实状态，而不是让用户面对一个裸 404。
