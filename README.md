# Apirak

基于 **Vue 3 + Vite + TypeScript** 的 OpenAPI 接口调试工作台：导入 OpenAPI 3.x / Swagger 2.0 规范后，
即可像 Postman 一样浏览接口、编辑请求、管理集合与变量、批量运行，并一键生成多语言请求代码与
客户端 SDK。独立部署时所有工作区数据本地持久化，无需登录、无后端依赖；也可配合后端启用**可选登录鉴权**（见 [登录页与访问控制](#登录页与访问控制)）。

它有两种用法，本仓库对两者都一等支持：

| 用法 | 产物 | 谁托管页面 |
| --- | --- | --- |
| **独立部署** | `npm run build:prod` → `dist/` | 任意静态服务器 / CDN / Nginx |
| **嵌进 .NET** | `npm run build:dotnet` → `dist/` | ASP.NET Core 类库把 `dist/` 打成内嵌资源，由中间件吐出 |

两者的差别只在构建模式（`--mode dotnet` 会把资源引用改成相对路径、把默认规范地址指向
`/openapi/v1.json`），源码完全一致。

<p align="center">
  <img src="public/apirak.png" alt="Apirak" width="120" />
</p>

---

## 目录

- [功能特性](#功能特性)
- [界面预览](#界面预览)
- [技术栈](#技术栈)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [规范来源解析规则](#规范来源解析规则)
- [URL 参数](#url-参数)
- [环境变量配置](#环境变量配置)
- [运行模式](#运行模式)
- [脚本命令](#脚本命令)
- [登录页与访问控制](#登录页与访问控制)
- [集成到 ASP.NET Core](#集成到-aspnet-core)
- [构建产物说明](#构建产物说明)
- [项目结构](#项目结构)
- [测试](#测试)
- [常见问题](#常见问题)
- [开源协议](#开源协议)

---

## 功能特性

### 规范导入与解析

- 支持 **OpenAPI 3.x** 与 **Swagger 2.0** 文档，JSON / YAML 均可。
- 支持从 **URL** 或 **本地文件** 导入规范（`ImportSpec`），也支持直接内嵌 `data:` 文档。
- 完整的 `$ref` 递归解析（含 `~0` / `~1` 转义），自动展开 Path Item 与 Operation 级参数合并。
- 收到 HTML 而非规范文档时给出明确的排错提示（通常是 `VITE_API_BASE_URL` / `VITE_SPEC_PATH` 配置错误）。
- 从 **URL** 导入失败时按原因分类给出针对性提示：路径 / 文档名错误（404）、鉴权问题（401 / 403）、服务端错误（5xx）、网络或跨域异常（CORS / Failed to fetch，浏览器隐藏真实原因时中性列举可能原因）；同源且配置了 `VITE_API_BASE_URL` 时会自动改走 `/api-proxy` 重试一次。

### 请求调试

- 多标签页（Tabs）工作区，标签可关闭、可持久化，右键菜单支持批量操作。
- 参数 / 请求头 / 表单均可视化键值编辑（`KeyValueEditor`），支持启用开关、文件上传标记。
- 请求体支持 JSON / 表单等多种 `contentType`，内置 **Monaco Editor** 代码编辑与高亮。
- 响应展示状态码、耗时、响应体大小、响应头，二进制响应以 Blob 处理可下载。
- 收藏（Favorites）与按 HTTP 方法筛选、请求搜索。

### 鉴权（Authorization）

- 自动识别规范中的 `securitySchemes`，支持：
  - **Basic Auth**（用户名 / 密码）
  - **API Key**（header / query / cookie）
  - **Bearer Token**
  - **OAuth 2.0**：`implicit`、`password`、`client_credentials`、`authorization_code` 四种流，
    支持 Client Secret 与 Scope 配置，自动换取并缓存 Access Token（含过期时间）。
- 凭据按规范隔离存储，可一键启用 / 停用。
- **「记住凭据」开关决定凭据是否持久化**：勾选后凭据按「工作区标识 + `:credentials`」写入 `localStorage`，
  刷新页面能自动回填；不勾选则只存在于当前会话，刷新即清空（默认不勾选，凭据以明文存储，按需开启）。
- **凭据值支持变量**：访问令牌 / 用户名 / 密码 / API Key 都能填 `{{变量名}}`，发送时才替换。
  典型用法是登录接口把 `token` 存成输出变量，鉴权面板填 `{{@token}}`，后续请求自动带上。
  OAuth 的 client secret、资源所有者密码同样支持。
  变量不存在时保留原样（不会静默发空值），输入框会用颜色标出未解析的引用。

### 集合与运行器（Runner）

- 将任意请求保存进**集合（Collection）**，集合可导入 / 导出（**导入 / 导出默认包含共享配置组与请求参数**），支持设置请求间延迟。
- **集合运行器**：批量顺序执行整个集合并汇总结果，适合回归冒烟测试。
- **集合共享配置组**：在集合上配置多组共享的「请求头 / 请求参数」，每组可独立命名、折叠 / 展开，并勾选作用于哪些接口（**一个接口可同时属于多组**，多组配置叠加合并、请求自身草稿优先）。配置组的请求头 / 参数同样支持 `{{变量}}` 与输出变量（如 `{{@token}}`）——典型用法是登录接口提取 token 后，在配置组统一给下游接口注入 `Authorization: Bearer {{token}}`。集合名与配置组组名均不允许重复。
- **导入校验友好提示**：导入集合文件时，若文件损坏、缺少字段、含不属于当前规范的接口或集合重名，会给出明确的多语言报错（而非笼统提示）。
- 运行**历史记录**自动保留（上限 100 条），**每条可展开查看请求地址、请求头、请求体、响应头、响应体**，并支持**单条删除**与一键清空；历史明细落盘前会对敏感请求头（authorization / cookie / token 等）脱敏。

### 变量系统

- 工作区级**变量表**，请求参数、请求头、请求体中可通过占位符引用。
- 请求执行后的**输出（outputs）**可回写为变量，供后续请求链式使用（如先登录取 token）。

### 代码生成

- 入口在具体接口的「**代码**」标签页（与 Parameters / Headers / Body 并列），切换接口即切换生成目标。
- 单请求代码片段一键生成：**cURL**、**JS/TS (Fetch)**、**Python (requests)**、**C# (HttpClient)**、**Java (OkHttp)**。
- 内置客户端 SDK 生成器：
  - **C# API Client**（`csharpApiClientGenerator`）
  - **JavaScript API Client**（`javascriptApiClientGenerator`）

### 其他

- **接口概览（Overview）**：Markdown 文档渲染（`marked` + `DOMPurify` 消毒，防 XSS）。
- **多语言（i18n）**：内置 **English / 简体中文 / 繁體中文** 三套文案。
    - **默认语言按浏览器协商**：未手动设置时读取 `navigator.languages` 选择默认语言（中文浏览器→中文、英文浏览器→英文）；浏览器语言不在三套内（如 `fr`/`de`/`ja`）一律回退 **English**。
    - **手动选择优先且持久化**：在主页或登录页底部切换语言会写入 `localStorage['apirak:locale']` 并立即生效；之后刷新或重访都以该选择为准，不再跟随浏览器。
    - 登录页与主页共用同一 i18n 实例与存储键，两边语言**双向同步**。
- **主题**：内置多套预设主题——默认 `graphite` 暗色，另含 `github-dark` / `visual-studio-dark` / `dark-plus` / `dark-modern` / `contrast` 等暗色，以及 `github-light` / `visual-studio-light` 浅色，并提供 `system` 跟随系统配色。登录页与主页面共享主题变量，风格自动一致。
- **工作区持久化**：Tabs、历史、收藏、变量、集合按规范标识（URL 或 `info.title + version`）
  存入 `localStorage`，带版本号校验与结构合法性检查，损坏数据自动回退。
  鉴权凭据不在其中，单独由「记住凭据」开关控制（见上文）。
- **开发代理**：内置 `/api-proxy` 代理转发，规避浏览器跨域限制。
- 支持 **JSONPath** 查询，便于在响应中定位数据。

---

## 界面预览

**主工作区（接口浏览、请求调试，以及集合 / 变量 / 运行器 / 代码生成）：**

![主工作区 / 接口调试界面](docs/screenshots/workspace.png)

**登录页（`/login`，可选功能，是否启用由后端决定）：**

![登录页 / 可选登录界面](docs/screenshots/login.png)

---

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 框架 | Vue 3.5（Composition API）+ TypeScript 5.7 |
| 构建 | Vite 6 + vue-tsc |
| 状态管理 | Pinia 2 |
| 国际化 | vue-i18n 10 |
| 编辑器 | Monaco Editor（@guolao/vue-monaco-editor） |
| 工具库 | @vueuse/core、js-yaml、jsonpath-plus、marked、DOMPurify、lucide-vue-next |
| 测试 | Vitest 4 + @vue/test-utils + jsdom |
| 代码规范 | ESLint 9 + eslint-plugin-vue + @typescript-eslint |

---

## 环境要求

- **Node.js ≥ 22.12.0**（`engines` 字段已声明）
- npm（随 Node 安装）
- 仅在「嵌进 .NET」这条路上额外需要：.NET 10 SDK（消费 `dist/` 的类库侧依赖）

---

## 快速开始

### 独立部署

```bash
# 1. 安装依赖
npm install

# 2. 复制环境变量模板并按需修改
cp .env.example .env

# 3. 启动开发服务器（默认 http://127.0.0.1:5173）
npm run dev
```

构建生产版本：

```bash
npm run build:prod
# 产物输出至 dist/
npm run preview   # 本地预览构建产物
```

> `public/swagger.json` 是仓库自带的示例规范，未配置远程 API 时可用于体验全部功能。

### 嵌进 .NET（给 ASP.NET Core 当 `/docs` 页面）

```bash
npm run build:dotnet
```

产物同样落在 `dist/`，之后由 .NET 侧的类库把这一整个目录嵌进 dll。
前端这边**只需要跑这一条命令**，具体怎么接见 [集成到 ASP.NET Core](#集成到-aspnet-core)。

---

## 规范来源解析规则

页面启动时决定拉哪一份 OpenAPI 文档，优先级从高到低（`src/main.ts`）：

| 优先级 | 来源 | 说明 |
| --- | --- | --- |
| 1 | URL 参数 `?spec=` / `?url=` | 临时调试最方便，不写入任何配置 |
| 2 | 宿主注入 `#docui-config` 的 `spec` | .NET 中间件在 `index.html` 里注入的 JSON |
| 3 | 构建期 `define` 的 `__SPEC_URL__` | 由 `.env.<mode>` 的 `VITE_API_BASE_URL` + `VITE_SPEC_PATH` 拼出 |
| 4 | 同目录 `swagger.json` | 兜底，即 `public/swagger.json` 拷进 `dist/` 的那一份 |

规范**显示名称**同理：`?name=` > 宿主注入的 `name` > 构建期 `__SPEC_NAME__` > 空
（空值时界面直接用文档里的 `info.title`）。

这样设计的好处是：嵌进 .NET 之后，改挂载前缀、改文档地址都是**运行时**的事，不用重新构建前端。

---

## URL 参数

| 参数 | 作用 | 示例 |
| --- | --- | --- |
| `spec` / `url` | 指定要加载的规范地址，覆盖一切配置 | `/docs/?spec=https://petstore3.swagger.io/api/v3/openapi.json` |
| `name` | 指定规范显示名称 | `/docs/?name=Petstore` |

调试跨源文档时特别好用——不用改环境变量、不用重新构建，直接在地址栏加参数。

---

## 环境变量配置

所有配置项通过 `.env` 文件（或 `.env.<mode>` 覆盖）注入，模板见 `.env.example`：

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | 后端 API 地址。**非空时**开发服务器会启用 `/api-proxy` 代理到该地址，规避跨域 | `http://localhost:8011/` |
| `VITE_SPEC_PATH` | OpenAPI 规范路径（相对 API 地址），默认 `/v3/api-docs`（Spring Boot 默认文档路径） | `/openapi/v1.json` |
| `VITE_SPEC_NAME` | 规范显示名称。**建议留空**，直接使用文档 `info.title`；填写时仅在文档缺少 `info.title` 时兜底 | 留空 |

典型配置：

```dotenv
# Spring Boot 项目
VITE_API_BASE_URL=http://localhost:8011/
VITE_SPEC_PATH=/v3/api-docs
VITE_SPEC_NAME=
```

```dotenv
# ASP.NET Core 项目（.env.dotnet）
VITE_API_BASE_URL=
VITE_SPEC_PATH=/openapi/v1.json
VITE_SPEC_NAME=
```

- 不配置 `VITE_API_BASE_URL` 时，应用直接从 `VITE_SPEC_PATH` 拉取规范（需该路径允许跨域，
  或使用 `public/` 下的静态文件）。嵌进 .NET 时页面与 API 同域，正是这种情况。
- 运行时也支持在页面中从**本地文件**或**粘贴内容**导入规范，无需预先配置。

---

## 运行模式

项目内置多套 Vite 模式，对应不同的 `.env.<mode>` 文件：

| 脚本 | 模式 | 用途 |
| --- | --- | --- |
| `npm run dev` / `dev:test` / `dev:prod` / `dev:local` | development / test / production / local | 本地开发，加载对应环境配置 |
| `npm run build` / `build:test` / `build:prod` | 同上 | 构建对应环境的产物 |
| `npm run build:dotnet` | dotnet | 构建给 .NET 类库内嵌的产物（相对路径 + `/openapi/v1.json`） |

`dotnet` 模式不干扰原有任何模式：`.env.dotnet` 是新增文件，dev/test/prod 的行为一字未改。

---

## 脚本命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器（127.0.0.1:5173） |
| `npm run build` | 类型检查 + 生产构建（`vue-tsc --noEmit && vite build`） |
| `npm run build:test` / `build:prod` | 构建对应环境的产物 |
| `npm run build:dotnet` | 构建给 .NET 内嵌的产物（**先删 `dist/` 再构建**） |
| `npm run preview` | 预览构建产物 |
| `npm run test` | 运行单元测试（Vitest 单次执行） |
| `npm run test:watch` | 以 watch 模式运行测试 |
| `npm run typecheck` | 仅执行 TypeScript 类型检查 |
| `npm run lint` | ESLint 检查并自动修复 |

> `build:dotnet` 里那句 `(if exist dist rmdir /s /q dist)` 不是多余的：某些环境（如受限的
> 自动化工具链）下 vite 清空 `outDir` 会走"移入回收站"的实现并被拦截，报
> `Error during a 'trash' operation`。用 cmd 原生 `rmdir` 绕开即可，删掉这句第二次构建会失败。

---

## 登录页与访问控制

登录是**可选功能**：是否要求登录、由谁校验、登录后跳去哪，全部由后端决定。前端只提供登录页 UI，并约定好表单字段与回跳参数。

### 它是怎么工作的（前端侧）

- **没有引入路由**。SPA 内部按访问路径分流：当 `location.pathname`（去掉结尾斜杠）以 `/login` 结尾时渲染登录视图；其余路径（含 `/`）一律渲染接口工作台首页。
    - 开发：`http://127.0.0.1:5173/login`
    - 嵌进 .NET（挂在 `/docs` 下）：`http://<host>/docs/login`
- 登录页**复用主页的主题与多语言**：样式全部吃 `main.css` 的主题变量，底部语言下拉与主页面共用同一 `i18n` 实例与 `localStorage['apirak:locale']`，两边语言双向同步。
- 表单行为（与后端对接的约定）：
    - `method="post" action=""`：直接 POST 回**当前路径**（如 `/login`、`/docs/login`），不写死端点。
    - 隐藏字段 `return`：携带登录来源（未登录跳来时由后端塞入的原目标路径），登录成功后回跳。
    - 读取 URL 的 `?error`：后端校验失败时带 `?error=1` 重定向回登录页，前端据此显示错误提示。
    - 读取 URL 的 `?return`：未登录访问受保护资源时，后端重定向到登录页并带上 `?return=<原路径>`。

### 后端需要做什么

前端只负责页面渲染，账号体系、校验、Cookie 由宿主实现（例如 .NET 侧的 `DocUiMiddleware`）。要让登录页真正可用，宿主需满足三条约定：

1. **登录路径返回 SPA 的 `index.html`**：访问 `/login`（或 `/docs/login`）时，宿主要把 SPA 入口（`dist/index.html`）作为响应返回，而不是 404。这样前端才能接管渲染登录视图。（开发模式下 Vite 自带 history fallback，直接访问 `/login` 即可。）
2. **该路径接收 POST 并校验**：提供一个消费表单字段 `username` / `password` / `return` 的端点——
    - 校验通过 → 下发认证 Cookie，302 跳转到 `return`（无则返回首页）；
    - 校验失败 → 302 跳回登录页并带 `?error=1`。
3. **受保护资源未认证时跳登录页**：未登录访问受保护资源时重定向到登录页并带 `?return=<原路径>`。

> 前端表单字段名（`username`/`password`/`return`）与 `?error`/`?return` 约定已与常见的 `DocUiMiddleware`（其 `HandleLoginPost` / `IsLoginArea`）对齐，后端无需额外适配即可对接。

### 关闭登录

不配置账号密码（宿主不启用鉴权）时，前端 `isLoginRoute` 分流照常工作，但**不会有人把你重定向到登录页**，`/` 直接打开接口工作台首页——即"登录为可选项"。

---

## 集成到 ASP.NET Core

页面可以被 .NET 类库整目录嵌进 dll，主程序两行代码挂出 `/docs`。这条链路上有三处约定，
改任何一侧都要对齐：

### 1. 产物用相对路径引用资源

`vite.config.ts`：

```ts
base: command === 'build' ? './' : '/',
```

产出的 `index.html` 里是 `./assets/index-xxx.js` 而不是 `/assets/index-xxx.js`。
**这一条最关键**——绝对路径会绕过挂载前缀直接打到站点根，页面能开但所有 js/css 全 404。
dev 模式仍用 `/`，保证 history fallback 正常。

### 2. 用 `.env.dotnet` 指定文档地址

```
VITE_API_BASE_URL=
VITE_SPEC_PATH=/openapi/v1.json
VITE_SPEC_NAME=
```

`VITE_API_BASE_URL` 留空，产物里烧进去的 `__SPEC_URL__` 就是 `/openapi/v1.json`，
与 ASP.NET Core 内置 `MapOpenApi()` 的默认路径一致，同域无需代理。

### 3. 运行时配置由宿主注入

宿主（.NET 中间件）在吐出 `index.html` 时会做两件事：

1. 把 `<title>` 替换成配置的标题；
2. 在 `</head>` 前插入一段 JSON：

```html
<script id="docui-config" type="application/json">
  {"root":"/docs","spec":"/openapi/v1.json","title":"Demo.Api 接口文档"}
</script>
```

`src/main.ts` 里的 `readHostConfig()` 读这个节点，取出 `spec`（可选 `name`）作为规范地址。
没有该节点时返回空对象，回退到构建期 `__SPEC_URL__`，**独立部署的行为完全不受影响**。

```ts
function readHostConfig(): { spec?: string; name?: string } {
  try {
    const el = document.getElementById('docui-config')
    return el?.textContent ? JSON.parse(el.textContent) : {}
  } catch {
    return {}
  }
}
```

### 为什么不在 `index.html` 里写 `{{title}}` 之类的占位符

因为 `dist/index.html` 是**构建产物**，下一次 `npm run build` 就把手写的内容冲掉了。
同理，不要手改 `dist/` 下的任何文件——要改就改源码或模板，然后重新构建。

### 宿主怎么改挂载前缀

消费方把前缀直接写在挂载那一行，改完重启即可：

```csharp
app.OpenApiUI("docs");        // -> /docs
app.OpenApiUI("api-docs");    // -> /api-docs，前端不用重新构建
```

因为 `base: './'` 让产物里的引用全是相对路径，页面挂在哪个前缀下都成立——
**这正是第 1 条约定存在的意义**。

### 前端侧的改动清单

改完前端后，消费方拿到新产物只需：

```bash
npm run build:dotnet     # 1. 出产物
# 2. 在 .NET 侧执行 dotnet build（或 dotnet build /p:BuildVue=true 一步到位）
```

`dist/` 下文件名的 hash 变了也没关系，消费方用的是通配符，不用改任何配置。

---

## 构建产物说明

`npm run build:dotnet` 之后 `dist/` 大致是这样：

```
dist/
├── index.html                 # 入口，资源引用为 ./assets/... 相对路径
├── apirak.png             # 来自 public/，页面图标
├── swagger.json               # 来自 public/，示例规范，兜底来源（第 4 优先级）
└── assets/
    ├── index-<hash>.js
    └── index-<hash>.css
```

- `public/` 下的文件会被**原样拷贝**到 `dist/` 根目录，不做 hash 处理，所以可以用稳定 URL 引用。
- `assets/` 下的文件名带内容 hash，每次改代码都会变——消费方必须用通配，不能写死文件名。
- `swagger.json` 供"导入示例 API"使用；如果你的场景不需要，删掉 `public/swagger.json` 即可，
  但那样第 4 优先级的兜底也就没了。

---

## 项目结构

```
apirak/
├── public/                  # 静态资源（应用图标、示例 swagger.json）
├── src/
│   ├── components/
│   │   ├── Authorization.vue    # 鉴权面板（Basic / API Key / Bearer / OAuth2）
│   │   ├── ImportSpec.vue       # 规范导入（URL / 文件 / 粘贴）
│   │   ├── RequestView.vue      # 请求编辑与响应展示
│   │   ├── RequestTabContextMenu.vue  # 标签页右键菜单
│   │   ├── Runner.vue           # 集合运行器
│   │   ├── Workspace.vue        # 工作区主布局（标签页 / 导航 / 主题 / 语言）
│   │   ├── LoginView.vue        # 登录页（/login 路径分流；可选登录，由后端鉴权）
│   │   ├── tools/               # 工具面板（集合 / 历史 / 概览 / 变量）
│   │   └── ui/                  # 通用 UI 组件（Monaco 封装、键值编辑器、Modal 等）
│   ├── composables/             # 组合式函数（useWorkspace）
│   ├── i18n/                    # 国际化（en / zh-CN / zh-TW）
│   ├── lib/
│   │   ├── api.ts               # 规范解析、$ref 展开、Operation 提取
│   │   ├── codeSnippets.ts      # cURL / Fetch / Python / C# / Java 代码片段生成
│   │   ├── generators/          # C# 与 JavaScript 客户端 SDK 生成器
│   │   ├── oauth.ts             # OAuth2 各流式的令牌获取与刷新
│   │   └── workspace.ts         # 工作区持久化（版本校验 / 数据合法性检查）
│   ├── styles/                  # 全局样式
│   ├── types.ts                 # 核心类型定义
│   └── main.ts                  # 入口：解析来源优先级、读宿主注入配置
├── .env.example             # 环境变量模板
├── .env.dotnet              # 嵌进 .NET 时的构建配置（base 相对路径 + /openapi/v1.json）
├── vite.config.ts           # Vite 配置（别名 @、/api-proxy 代理、base、规范 URL 注入）
└── package.json
```

---

## 测试

测试基于 Vitest + jsdom，覆盖规范解析、工作区持久化等核心逻辑：

```bash
npm run test          # 单次运行
npm run test:watch    # 监听模式
```

改了 `src/lib/` 下的解析或持久化逻辑，跑一遍再出产物。

---

## 常见问题

**页面能打开但一片空白，控制台一堆 404**
产物里的资源引用是绝对路径（`/assets/...`）。确认是用 `build:dotnet` 构建的，
且 `vite.config.ts` 里 `base` 在 `command === 'build'` 时为 `'./'`。

**页面提示"收到 HTML 而不是规范文档"**
`spec` 地址指向了一个 HTML 页面（通常是 SPA 的 index.html，或地址被挂载前缀吃掉）。
在 `/docs/` 页面地址栏加 `?spec=/openapi/v1.json` 验证，确认后去查宿主的 `OpenApiUrl` 配置。

**改了 .NET 侧的标题 / 文档地址，页面没变**
这些是运行时注入的，改完要重启 .NET 服务；浏览器记得强刷（`Ctrl+F5`），
`index.html` 带了 1 小时的 `Cache-Control`。

**`npm run build:dotnet` 报 trash / 删除相关错误**
`dist/` 清理被环境的删除策略拦了。脚本里已用 `rmdir /s /q` 绕开；
若仍失败，手动删掉 `dist/` 目录再跑。

**`.env.dotnet` 里的地址没生效**
`--mode dotnet` 才会加载它。直接跑 `vite build` 用的是 `.env` + `.env.production`。

**登录页打不开 / 一片空白（嵌进 .NET 时）**
登录页依赖后端把 `/login`（或 `/docs/login`）指向 SPA 的 `index.html`。若宿主未做这条约定，访问该路径会 404。
开发模式下直接 `npm run dev` 然后访问 `http://127.0.0.1:5173/login` 即可（Vite 自带 history fallback）。
确认后端已按 [登录页与访问控制](#登录页与访问控制) 的约定把登录路径吐出 SPA。

**登录后没有跳回原页面**
检查后端在登录成功 302 时是否带上了 `return` 字段（来自登录页隐藏字段）。没有 `return` 时回跳首页是符合预期的行为；若想回到登录前所在页，后端重定向到登录页时必须带 `?return=<原路径>`。

---

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。

Copyright (c) 2026 Viken Wang
