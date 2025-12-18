# SerialFlux Pro - 下一代 Web 串口调试助手 ⚡

**SerialFlux Pro** 是一个基于 Web 技术构建的现代化、高颜值、功能强大的串口调试工具。它采用了“模拟桌面窗口”的沉浸式设计风格，结合了极光流光特效与磨砂玻璃质感，旨在为嵌入式开发者提供极致的调试体验。

*(注：此处可替换为实际截图)*

## ✨ 核心特性

### 🎨 极致 UI/UX 设计

- **模拟桌面窗口**：悬浮于极光网格背景之上的独立窗口，还原原生应用体验。
- **工业级质感**：深色磨砂玻璃面板，配以金属边框光效与精细的螺丝孔位装饰。
- **动态交互**：流光边框、呼吸灯状态指示、细腻的按钮反馈动画。

### 🛠️ 强大的调试功能

- **全平台支持**：基于 Chromium 内核浏览器（Chrome, Edge），免驱动安装，即插即用。
- **多格式支持**：
  - **HEX/ASCII**：接收与发送均支持一键切换十六进制与文本模式。
  - **多编码**：支持 UTF-8 与 GBK 编码切换（需底层支持，当前演示为 UTF-8）。
  - **行尾符控制**：可选 `\n`, `\r`, `\r\n` 或无行尾符。
- **高级发送**：
  - **CRC 校验**：支持自动追加 Modbus CRC16 校验码。
  - **快捷指令**：可自定义、持久化保存的快捷指令组，支持快速点击发送。
  - **历史回溯**：支持通过键盘 `↑` / `↓` 键回溯发送历史。

### ⚡ 性能与便捷

- **数据持久化**：波特率、高亮关键词、快捷指令等配置自动保存到本地（LocalStorage）。
- **智能过滤**：支持实时日志搜索与过滤，快速定位关键信息。
- **关键词高亮**：支持自定义关键词高亮及颜色配置。
- **RX/TX 监控**：底部状态栏集成动态呼吸灯，实时反馈数据收发状态。

## 🚀 快速开始

### 环境要求

- Node.js 16+
- 支持 Web Serial API 的浏览器（Chrome 89+, Edge 89+, Opera）

### 安装步骤

1. **克隆项目**

   ```
   git clone [https://github.com/your-username/serial-flux-pro.git](https://github.com/your-username/serial-flux-pro.git)
   cd serial-flux-pro
   ```

2. **安装依赖**

   ```
   npm install
   # 必须安装图标库
   npm install lucide-react
   ```

3. **启动开发服务器**

   ```
   npm run dev
   ```

4. **访问** 打开浏览器访问 `http://localhost:5173`。

## 📦 技术栈

- **框架**: [React 18](https://react.dev/)
- **构建工具**: [Vite](https://vitejs.dev/)
- **样式**: [Tailwind CSS](https://tailwindcss.com/)
- **图标**: [Lucide React](https://lucide.dev/)
- **核心 API**: [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)

## ⚠️ 注意事项

1. **HTTPS 限制**：Web Serial API 出于安全考虑，仅在 `localhost` 或 `https://` 协议下可用。
2. **驱动问题**：虽然 Web 端免驱，但操作系统层面仍需安装对应的 USB 转串口芯片驱动（如 CH340, CP2102）。
3. **浏览器权限**：首次连接设备时，必须通过浏览器原生的弹窗授权设备。这是浏览器的安全机制，无法绕过。

## 📄 License

MIT License# serial-flux
