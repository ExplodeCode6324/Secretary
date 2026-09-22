# Secretary · Pi 实现验证

本目录提供可运行的 Secretary 原型，用于验证 BrainStorm 的核心职责与交接。实现语言为 TypeScript，直接复用固定版本的 Pi 源码；前面的 Go 设计保留为参考。

- [pi_resource](pi_resource)：Pi 官方源码 git submodule，固定 `v0.87.0`，不跟随 main 自动更新。
- [pi_secretary](pi_secretary/README.md)：Secretary 宿主、Scheduler、授权、持久化、World Model、界面和测试。
- [验证与实现范围](pi_secretary/REVIEW.md)：建议 Master 从这里复核。
- [上游锁定信息](UPSTREAM.json)：来源、版本、commit 和直接复用的文件。

首次取得仓库后：

```sh
git submodule update --init --recursive
cd demo_pi
npm ci --ignore-scripts
npm start
```

需要 Node.js ≥22.19 和 Python 3；World Model 另外需要 PostgreSQL 18。默认是明确标识的离线 fixture 模式，运行真实 Pi loop，但模型输出由测试适配器提供。真实模型配置和 PostgreSQL 初始化见 pi_secretary 的说明。
