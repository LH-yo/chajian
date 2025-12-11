# Ask Continue

在 AI 对话结束前询问用户是否继续，内置 MCP 服务器。

## 功能特性

- 🔄 自动询问用户是否继续对话
- 📝 支持用户输入新指令
- 🖼️ 支持上传图片
- 🖥️ 内置 MCP 服务器（HTTP + stdio 双模式）
- 🌍 跨平台支持（Windows、Linux、macOS）

## 系统要求

### Windows
- Node.js 18+（用于 MCP stdio 模式）

### Linux
- Node.js 18+
- 对话框工具（至少安装其中一个）：
  - `zenity`（GNOME 桌面，推荐）
  - `kdialog`（KDE 桌面）
  - `yad`（通用）

#### Linux 依赖安装

**Ubuntu/Debian:**
```bash
# 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装对话框工具（选择一个）
sudo apt-get install -y zenity  # GNOME
# 或
sudo apt-get install -y kdialog  # KDE
```

**CentOS/RHEL/Fedora:**
```bash
# 安装 Node.js
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs

# 安装对话框工具
sudo yum install -y zenity
```

**Arch Linux:**
```bash
sudo pacman -S nodejs npm zenity
```

### macOS
- Node.js 18+
- 可选：`zenity`（通过 Homebrew 安装）

## 安装

1. 从 VSCode 扩展市场安装，或手动安装 `.vsix` 文件
2. 重启 VSCode/Cursor/Windsurf

## 配置 MCP

### 方法一：自动配置（推荐）
1. 点击侧边栏的 "Ask Continue" 图标
2. 点击 "🔧 配置 MCP" 按钮
3. 选择要配置的 AI 工具

### 方法二：手动配置

**Windsurf** (`~/.codeium/windsurf/mcp_config.json`):
```json
{
  "mcpServers": {
    "ask_continue": {
      "command": "node",
      "args": ["/path/to/extension/mcp-server.js"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "ask_continue": {
      "command": "node",
      "args": ["/path/to/extension/mcp-server.js"]
    }
  }
}
```

## 故障排除

### Linux: "node: executable file not found in $PATH"

确保 Node.js 正确安装并在 PATH 中：
```bash
# 检查 node 是否可用
which node
node --version

# 如果 node 不在 PATH 中，添加到 ~/.bashrc 或 ~/.profile
export PATH=$PATH:/path/to/node/bin
```

### Linux: 对话框不显示

确保安装了 zenity 或 kdialog：
```bash
# 检查
which zenity || which kdialog

# 安装
sudo apt-get install zenity  # Debian/Ubuntu
```

## 作者

- **三千-qs**
- QQ交流群：811459967

