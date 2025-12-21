# Serial Flux Pro

基于 Web Serial API 的现代串口调试工具。

## 功能特性

### 连接管理
- 自动检测已授权设备
- 支持常用波特率（9600 ~ 921600）
- 设备热插拔检测

### 数据收发
- **显示模式**：ASCII / HEX 切换
- **编码支持**：UTF-8 / GBK
- **行尾符**：`\n` 或 `\r\n`
- **CRC16 校验**：自动追加 Modbus CRC16

### 定时发送
- 可配置发送间隔（最小 100ms）
- 支持启停控制

### 快捷指令
- 自定义宏命令
- 本地持久化存储
- 一键快速发送

### 日志管理
- 实时过滤搜索
- 关键词高亮（多色可选）
- 时间戳显示开关
- 日志导出（含完整时间戳）

## 快捷键

| 按键 | 功能 |
|------|------|
| `Enter` | 发送数据 |
| `Shift+Enter` | 输入换行 |
| `↑` / `↓` | 历史记录 |

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 技术栈

- React 18 + Vite
- Tailwind CSS
- Lucide React Icons
- Web Serial API

## 浏览器支持

需要支持 Web Serial API 的浏览器：
- Chrome 89+
- Edge 89+
- Opera 75+

> 注意：Web Serial API 仅在 `localhost` 或 `https://` 下可用。

## 注意事项

1. 操作系统需安装对应 USB 转串口驱动（CH340、CP2102 等）
2. 首次连接需通过浏览器弹窗授权设备

## License

MIT
