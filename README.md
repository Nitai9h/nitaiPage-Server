# NitaiPage Server

NitaiPage 默认把数据存在浏览器本地（localStorage + IndexedDB），本项目用于接管 nitaiPage 的数据，可用于多设备数据同步

## 快速开始

### 部署

```bash
# 克隆仓库
git clone https://github.com/Nitai9h/nitaiPage-Server.git
cd nitaiPage-Server

# 启动服务
docker compose up -d --build
```

首次启动会下载并构建前端，时间较长

### 配对

服务启动后，在浏览器中访问：

```
http://localhost:11123
```

页面会显示一个**配对码**，在服务器上执行以下命令进行批准：

```bash
docker compose exec nitaipage npm run pair -- AB3F9K2M
```

批准后，浏览器会自动进入起始页

## 进阶配置

### 锁定数据保存方式为服务器

在 `.env` 文件中设置：

```dotenv
ONLY_SERVER=true
```

部署后，nitaiPage 将禁用默认存储，只允许保存到数据库

### 更换设备撤销旧配对

```bash
# 查看已授权设备
docker compose exec nitaipage npm run pair -- --devices

# 撤销指定设备
docker compose exec nitaipage npm run pair -- --revoke <设备ID>
```

### 备份数据

数据存储在 `data/` 目录，备份该目录，或者导出容器卷：

```bash
# 导出容器卷
docker compose down
docker volume export <项目名>_nitaipage-data > backup.tar
```

### 更新前端版本

修改 `.env` 中的 `FRONTEND_REF` 指向新的 **tag**，然后重启即可：

```bash
docker compose up -d
```

## 文档

更多内容请 [查看](https://nitaipage.nitai.cc/guide/docs/nitaiPage-server.html)

## 许可

Apache-2.0
