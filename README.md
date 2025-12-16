# 神秘许愿池 (Wishing Well)

## 本地运行（开发/直接运行）

1. 安装 Node.js 18+（建议 20）
2. 在项目目录执行：

```bash
npm install
npm start
```

3. 打开：

- http://localhost:3000

数据库文件默认位置：`./data/wishpool.sqlite`（首次运行会自动创建）

## Docker 部署（推荐）

```bash
docker compose up -d --build
```

打开：

- http://<设备IP>:3000

数据持久化：`./data` 目录会映射到容器内 `/data`，SQLite 数据库保存在本地。

## OpenWrt (Linux) 上部署步骤（Docker）

1. 确保已安装 Docker 与 docker-compose（不同固件可能是 `docker` + `docker-compose` 或 `docker compose` 插件）
2. 从 GitHub 拉取代码到路由器本地（或在 PC 上打包上传）
3. 在项目目录执行：

```bash
docker compose up -d --build
```

4. 访问：

- `http://<openwrt-ip>:3000`

## 使用说明

- 用户端：手机号 + 4 位数字密码注册/登录
- 许愿：截止前可投递愿望；投递后仅允许修改 1 次
- 分配：管理员触发随机分配（保证不配到自己）

## 管理入口

- 页面底部点击 `Admin`
- 密码：`Wishpool`

管理功能：

- 修改 Max Wishes / Deadline
- 随机分配（防自配）
- 重置许愿池（清空愿望，不清空用户）
- 重置数据库（清空愿望与用户）
- 导出 CSV
