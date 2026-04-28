# 从花讯到路线：基于腾讯位置服务与Agent的城市赏花地图实践——以清华大学春季赏花为例

一个面向“季节性城市漫游”场景的地图应用原型，详细推文介绍位于：。

项目以清华大学春季赏花为示例，尝试把“花讯信息 + 地点检索 + 路线规划 + Agent 交互”串成一条完整链路：用户用自然语言描述需求，系统结合场景知识、候选花点、补给点与步行路线能力，生成可执行、可解释、可展示的赏花路线。

这个仓库既包含可直接演示的静态地图 Demo，也包含面向比赛升级的 Agent 服务端与对话式前端骨架，适合作为“AI + 地图”方向的项目原型继续扩展。

## 项目目标

- 让用户快速知道“现在去哪看花”
- 支持“想看什么花、走多久、要不要吃饭、最后想不想休息”这类复合需求
- 将赏花点、地标、设施点、花况更新组织成结构化数据
- 输出既适合前端渲染、也适合 Agent 消费的结构化路线结果

## 核心能力

- `静态地图 Demo`
  - 展示校园赏花点、地标点、设施点和推荐路线
  - 用前端规则模拟场景偏好理解与路线组织
- `路线规划服务`
  - 提供路线规划与 POI 搜索接口
  - 支持 `llm+tools` 与 `rules+tools` 两种模式
- `Agent UI 前端骨架`
  - 支持 CloudBase Agent 对话式交互
  - 支持把地图工具结果渲染为自定义 ToolCard
- `比赛素材与数据底座`
  - 提供图片、表格、Shapefile 等原始素材，便于继续完善

## 项目结构

```text
.
├── index.html
├── poi-demo.html
├── styles.css
├── src/                            # 静态 Demo 脚本与数据
├── cloudbase-agent-service/        # Node.js / TypeScript 服务端原型
├── cloudbase-agent-ui/             # React / Vite 对话式前端原型
├── 核心打卡地图片/                  # 图片素材
├── 核心打卡地.*                     # 核心打卡点 GIS 数据
├── 清华花.*                        # 花点 GIS 数据
├── 核心打卡地.xls
├── 清华花.xls
└── 清华poi.xls
```

## 系统组成

### 1. 静态地图 Demo

静态 Demo 用于展示产品形态和基础交互，适合快速预览项目思路。

相关文件：

- [`index.html`](./index.html)
- [`poi-demo.html`](./poi-demo.html)
- [`styles.css`](./styles.css)
- [`src/app.js`](./src/app.js)
- [`src/config.js`](./src/config.js)

### 2. CloudBase Agent 服务端

服务端负责把自然语言需求转成结构化路线结果，当前已包含：

- `GET /healthz`
- `POST /demo/route-plan`
- `POST /demo/poi-search`

核心入口：

- [`cloudbase-agent-service/src/index.ts`](./cloudbase-agent-service/src/index.ts)
- [`cloudbase-agent-service/src/agent.ts`](./cloudbase-agent-service/src/agent.ts)
- [`cloudbase-agent-service/src/demo-planner.ts`](./cloudbase-agent-service/src/demo-planner.ts)
- [`cloudbase-agent-service/src/server-tools.ts`](./cloudbase-agent-service/src/server-tools.ts)

### 3. Agent UI 前端

这个子项目用于展示对话式 Agent 交互与 ToolCard 卡片渲染。

核心入口：

- [`cloudbase-agent-ui/src/App.tsx`](./cloudbase-agent-ui/src/App.tsx)
- [`cloudbase-agent-ui/src/components/ToolCard.tsx`](./cloudbase-agent-ui/src/components/ToolCard.tsx)
- [`cloudbase-agent-ui/src/components/cards/TencentMapToolCard.tsx`](./cloudbase-agent-ui/src/components/cards/TencentMapToolCard.tsx)

## 技术思路

这个项目的主线可以概括为：

1. 用户输入自然语言需求
2. 系统解析赏花偏好、就餐诉求、休息诉求和路线节奏
3. 基于场景知识筛选候选花点、补给点和终点
4. 调用地图检索与步行规划能力组织多阶段路线
5. 输出结构化 JSON，并在前端渲染为地图与卡片结果


## 快速开始

### 1. 运行静态 Demo

编辑 [`src/config.js`](./src/config.js)，填入你自己的腾讯地图 JS Key：

```js
window.APP_CONFIG = {
  TENCENT_MAP_KEY: "your-key",
  AGENT_API_BASE_URL: "http://localhost:9000",
  DEMO_NAME: "清华大学春日赏花日更地图",
};
```

然后直接打开 `index.html`，或者用任意静态服务器启动：

```bash
# 任选一种方式
python3 -m http.server 8080
# 或
npx serve .
```

### 2. 启动服务端

要求：

- Node.js 18+

步骤：

```bash
cd cloudbase-agent-service
cp .env.example .env
npm install
npm run build
npm start
```

默认服务地址：

```text
http://localhost:9000
```

环境变量模板见：

- [`cloudbase-agent-service/.env.example`](./cloudbase-agent-service/.env.example)

常用变量：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`
- `TMAP_WEBSERVICE_KEY`
- `MAP_PROVIDER`
- `BAIDU_MAP_AK`
- `DEFAULT_SCENE_ID`

说明：

- 配置 `OPENAI_API_KEY` 后，优先走 `llm+tools`
- 未配置时，自动回退到 `rules+tools`
- `MAP_PROVIDER` 支持 `tencent` 和 `baidu`

### 3. 启动 Agent UI 前端

```bash
cd cloudbase-agent-ui
npm install
npm run dev
```

环境变量模板见：

- [`cloudbase-agent-ui/.env.example`](./cloudbase-agent-ui/.env.example)

至少需要配置：

- `VITE_CLOUDBASE_ENV_ID`
- `VITE_CLOUDBASE_AGENT_BOT_ID`

## 数据与素材

仓库中保留了比赛推进所需的主要素材：

- `核心打卡地图片/`：现场图片素材
- `核心打卡地.*`：核心打卡点 GIS 数据
- `清华花.*`：花点 GIS 数据
- `*.xls`：人工整理的点位与 POI 表格

这些内容可以继续用于：

- 补点位库
- 调整路线规则
- 组织后端结构化数据源
- 构建花况共建与动态更新机制

## 配置与安全

为了适合上传 GitHub，这个仓库默认不提交以下内容：

- `.env`
- `node_modules/`
- `dist/`
- `.DS_Store`
- `*.sr.lock`

忽略规则见 [`./.gitignore`](./.gitignore)。

拉取仓库后，请在本地自行创建 `.env` 并填入你自己的 Key。

## 适合继续扩展的方向

- 接入真实花况上报、审核与聚合流程
- 把静态数据改造成云端数据库或接口返回
- 完善 Agent 的任务拆解、候选点裁决与推荐理由
- 增加路线详情页、点位详情弹层和图片上传入口
- 扩展到校园外的城市公园、绿道和景区场景

## Roadmap

- [x] 完成静态赏花地图 Demo
- [x] 整理基础点位、图片和 GIS 素材
- [x] 搭建 CloudBase Agent 服务端原型
- [x] 搭建 Agent UI React 前端骨架
- [ ] 接入真实动态花况数据
- [ ] 完善用户共建与审核流
- [ ] 部署可公开访问的演示版本

