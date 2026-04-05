# 要是当初卖了就好了... 🕹️

> 韭菜后悔计算器 — 看看你错过了多少钱

输入你的买入记录，看看如果在**历史最高点**完美逃顶，你现在应该在马尔代夫而不是在工位。

🔗 **在线体验**: [stock-profit-calculator-seven.vercel.app](https://stock-profit-calculator-seven.vercel.app)

## 功能

- **全球股票** — 美股 / 港股 / 沪A / 深A 热门股票一键选择，支持搜索任意股票
- **灵活输入** — 按股数或总金额买入，支持填写实际卖出日期对比
- **你的操作 VS 完美操作** — 看看你比最佳时机少赚了多少
- **价格走势图** — 标注买入点、卖出点、历史最高点
- **等价物换算** — 错过的钱能买多少 iPhone、喜茶、PS5、日本机票...
- **韭菜鉴定** — S~F 评分、后悔等级、每天少赚多少
- **Meme 语录** — 按收益率分 5 档随机生成搞笑配文
- **分享图生成** — 一键生成带数据和走势图的分享卡片
- **像素游戏风格** — STAGE 关卡、REGRET LV 后悔条、GAME OVER 特效

## 技术栈

- 纯前端单页应用 (HTML/CSS/JS)，无框架依赖
- Vercel Serverless Functions 代理 Yahoo Finance API
- Canvas API 绘制价格走势图
- html2canvas 生成分享截图
- Press Start 2P 像素字体

## 部署

### Vercel (推荐)

```bash
# 安装 Vercel CLI
npm i -g vercel

# 一键部署
vercel --prod
```

### 本地开发

```bash
npx http-server -p 8080
```

> 注意：本地运行时 `/api/stock` 代理不可用，需要部署到 Vercel 才能正常获取股票数据。

## 项目结构

```
├── index.html        # 完整的单页应用
├── api/
│   ├── stock.js      # Yahoo Finance 数据代理 (Vercel Serverless)
│   └── search.js     # 股票搜索接口 (Vercel Serverless)
├── vercel.json       # Vercel 配置
└── package.json
```

## 作者

**陈锦初 Andrew**

- 𝕏: [@0xajc](https://x.com/0xajc)
- 小红书: [陈锦初Andrew（AI创业版）](https://www.xiaohongshu.com/user/profile/67c46824000000000a03e9b6)

## License

MIT
