"use strict";
/**
 * Ask Continue - VSCode/Windsurf/Cursor 扩展
 *
 * 完全独立运行，不依赖 Python 或外部 exe
 * 提供 MCP 服务器和 GUI 对话框功能
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const http = __importStar(require("http"));
const crypto = __importStar(require("crypto"));
// ==================== 全局变量 ====================
let outputChannel;
let mcpServer = null;
let settingsPanel = null;
let sidebarProvider = null;
let statusBarItem;
let pendingRequests = new Map();
let requestCounter = 0;
// 保留一个引用用于 selectImages 功能
let activeRequestId = null;
let hiddenModeRequests = new Map();
let currentPort = 3456;
let extensionContext;
let activationCheckInterval = null;
let currentWorkspacePath = ''; // 当前工作区路径
// ==================== 本地版本（已移除网络时间同步和在线激活）====================
async function getCurrentTime() { return Date.now(); }
function getCurrentTimeSync() { return Date.now(); }
// ==================== 规则模板 ====================
const RULE_TEMPLATE = `# 继续牛马 - AI对话持续规则

⚠️⚠️⚠️ 最高优先级警告 ⚠️⚠️⚠️
无论任何情况，每次回复结束前必须调用 ask_continue 工具！没有任何例外！

## 核心规则

1. **完整输出** - 输出完整代码和答案，禁止使用省略号或"代码过长不展示"

2. **持续执行** - 复杂任务尽量一次性完成，不要频繁中断或反复追问是否继续

3. **结束确认** - 当你想结束对话或任务时，必须先调用 ask_continue 工具询问用户是否继续

4. **严格遵守用户选择** - 当用户选择"结束对话"（返回 should_continue=False）时，必须立即停止所有操作

## 调用 ask_continue 工具时

⚠️ **必须同时传递 reason 和 workspace 两个参数**，缺一不可！

\`\`\`json
{
  "reason": "任务完成原因",
  "workspace": "当前工作区的绝对路径"
}
\`\`\`

- **reason**: AI想要结束对话的原因
- **workspace**: 当前工作区的根目录绝对路径，用于确保对话框在正确的IDE窗口中打开。若不传递此参数，对话框可能在错误的窗口中弹出！
`;
/**
 * 获取激活状态（本地版本 - 始终返回已激活）
 */
function getActivationInfo() {
    return { isActivated: true, activatedAt: Date.now(), expiresAt: Date.now() + 365*24*60*60*1000*100 };
}
/**
 * 保存激活状态
 */
async function saveActivationInfo(info) {
    await extensionContext.globalState.update('activationInfo', info);
}
/**
 * 统一更新端口配置
 * 如果存在工作区配置，先清除工作区配置，再更新全局配置
 * 这样可以确保端口设置不会被工作区配置覆盖
 */
async function updatePortConfig(newPort) {
    const config = vscode.workspace.getConfiguration('askContinue');
    // 检查是否存在工作区配置
    const inspection = config.inspect('mcpPort');
    if (inspection?.workspaceValue !== undefined) {
        // 清除工作区级别的配置，避免覆盖全局配置
        await config.update('mcpPort', undefined, vscode.ConfigurationTarget.Workspace);
        outputChannel.appendLine(`已清除工作区端口配置`);
    }
    // 更新全局配置
    await config.update('mcpPort', newPort, vscode.ConfigurationTarget.Global);
    currentPort = newPort;
    outputChannel.appendLine(`端口已更新为: ${newPort}`);
}
// ==================== 通信加密工具 ====================
/**
 * 激活插件（本地版本 - 无需激活）
 */
async function activatePlugin(code) {
    return { success: true, message: '本地版本，无需激活' };
}
/**
 * 取消激活（本地版本 - 无操作）
 */
async function deactivatePlugin() { }
// 上一次检查的激活状态（本地版本不需要）
let lastActivationState = null;
/**
 * 启动激活状态检查定时器（本地版本 - 简化）
 */
function startActivationCheck() { }
/**
 * 处理未激活/到期状态（本地版本 - 无操作）
 */
async function handleDeactivation() { }
// ==================== 扩展激活 ====================
function activate(context) {
    extensionContext = context;
    outputChannel = vscode.window.createOutputChannel('Ask Continue');
    outputChannel.appendLine('Ask Continue 扩展已激活');
    // 记录当前工作区路径
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        currentWorkspacePath = workspaceFolders[0].uri.fsPath;
        outputChannel.appendLine(`当前工作区: ${currentWorkspacePath}`);
    }
    // 创建状态栏项
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'askContinue.openSettings';
    updateStatusBar();
    statusBarItem.show();
    // 创建侧边栏 Webview Provider
    sidebarProvider = new SidebarProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('askContinue.sidebarView', sidebarProvider));
    // 注册命令
    context.subscriptions.push(vscode.commands.registerCommand('askContinue.show', () => showAskContinueWebview(context)), vscode.commands.registerCommand('askContinue.openSettings', () => showSettingsPanel(context)), vscode.commands.registerCommand('askContinue.createRules', () => createRulesFileWebview(context)), vscode.commands.registerCommand('askContinue.startMCPServer', () => startMCPServer(context)), vscode.commands.registerCommand('askContinue.stopMCPServer', () => stopMCPServer()), vscode.commands.registerCommand('askContinue.toggleServer', () => toggleMCPServer(context)), vscode.commands.registerCommand('askContinue.installMCP', () => installMCPConfig(context)), vscode.commands.registerCommand('askContinue.openHiddenRequest', (requestId) => openHiddenModeWebview(context, requestId)), statusBarItem, outputChannel);
    // 检查激活状态
    const activationInfo = getActivationInfo();
    const config = vscode.workspace.getConfiguration('askContinue');
    currentPort = config.get('mcpPort') || 3456;
    if (activationInfo.isActivated) {
        // 已激活：启动 MCP 服务器（优先使用配置的端口，避免频繁切换导致MCP配置不同步）
        const autoStart = config.get('autoStart');
        if (autoStart !== false) {
            outputChannel.appendLine('IDE启动，启动MCP服务器...');
            // 直接启动，startMCPServer会自动处理端口冲突
            startMCPServer(context);
        }
    }
    else {
        // 未激活：确保服务停止并清理MCP配置
        outputChannel.appendLine('插件未激活，跳过MCP服务器启动');
        handleDeactivation();
    }
    // 启动激活状态检查定时器
    startActivationCheck();
}
function updateStatusBar() {
    const serverExists = mcpServer !== null;
    outputChannel.appendLine(`updateStatusBar: mcpServer=${serverExists ? '存在' : '空'}, port=${currentPort}`);
    if (mcpServer) {
        statusBarItem.text = `$(check) AC Server :${currentPort}`;
        statusBarItem.tooltip = `Ask Continue MCP 服务器运行中 (端口 ${currentPort})\n点击打开设置`;
        statusBarItem.backgroundColor = undefined;
    }
    else {
        statusBarItem.text = `$(x) AC Server`;
        statusBarItem.tooltip = 'Ask Continue MCP 服务器已停止\n点击打开设置';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    // 同步更新侧边栏
    sidebarProvider?.updateServerStatus(mcpServer !== null, currentPort);
}
async function toggleMCPServer(context) {
    if (mcpServer) {
        stopMCPServer();
    }
    else {
        await startMCPServer(context);
    }
    // 通知设置面板更新状态
    if (settingsPanel) {
        settingsPanel.webview.postMessage({ type: 'serverStatus', running: mcpServer !== null, port: currentPort });
    }
}
function deactivate() {
    stopMCPServer();
    if (activationCheckInterval) {
        clearInterval(activationCheckInterval);
        activationCheckInterval = null;
    }
}
// ==================== MCP 服务器 (HTTP) ====================
/**
 * IDE启动时自动刷新端口号并启动服务器
 */
async function refreshPortAndStart(context) {
    outputChannel.appendLine('正在刷新端口号...');
    // 查找新的可用端口
    const newPort = await findAvailablePort();
    if (newPort) {
        await updatePortConfig(newPort);
        outputChannel.appendLine(`端口已刷新为: ${newPort}`);
        // 更新Windsurf MCP配置中的端口
        await updateMCPConfigPort(newPort);
        // 更新工作区端口映射（用于多窗口支持）
        if (currentWorkspacePath) {
            registerWorkspacePort(currentWorkspacePath, newPort);
        }
    }
    // 启动MCP服务器
    outputChannel.appendLine('启动 MCP 服务器...');
    await startMCPServer(context);
}
/**
 * 更新Windsurf MCP配置中的端口号
 */
async function updateMCPConfigPort(port) {
    try {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const windsurfConfigPath = path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json');
        if (fs.existsSync(windsurfConfigPath)) {
            const configContent = fs.readFileSync(windsurfConfigPath, 'utf-8');
            const config = JSON.parse(configContent);
            // 如果ask_continue配置存在，更新端口
            if (config.mcpServers && config.mcpServers.ask_continue) {
                const serverConfig = config.mcpServers.ask_continue;
                if (serverConfig.url) {
                    // 更新HTTP模式的URL端口
                    serverConfig.url = `http://localhost:${port}`;
                    fs.writeFileSync(windsurfConfigPath, JSON.stringify(config, null, 2), 'utf-8');
                    outputChannel.appendLine(`MCP配置端口已更新为: ${port}`);
                }
            }
        }
    }
    catch (e) {
        outputChannel.appendLine(`更新MCP配置端口失败: ${e}`);
    }
}
// 检查端口是否已被 ask_continue 服务器占用
async function checkPortInUse(port) {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: 'localhost',
            port: port,
            path: '/',
            method: 'GET',
            timeout: 1000
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    // 检查是否是 ask_continue 服务器
                    resolve(json.server === 'ask_continue');
                }
                catch {
                    resolve(false);
                }
            });
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
        req.end();
    });
}
// 检查端口是否被任何服务占用
function isPortOccupied(port) {
    return new Promise((resolve) => {
        const net = require('net');
        const server = net.createServer();
        server.once('error', () => resolve(true));
        server.once('listening', () => {
            server.close();
            resolve(false);
        });
        server.listen(port, 'localhost');
    });
}
// Windows 系统常用端口和保留端口范围
const RESERVED_PORTS = new Set([
    // 常用系统服务端口
    80, 443, 445, 135, 137, 138, 139,
    // 数据库
    1433, 1434, 3306, 5432, 27017,
    // 开发常用
    3000, 3001, 4200, 5000, 5173, 8000, 8080, 8443, 9000,
    // RDP 和其他 Windows 服务
    3389, 5985, 5986,
    // 其他常用服务
    21, 22, 23, 25, 53, 110, 143, 993, 995
]);
// 查找可用端口
async function findAvailablePort() {
    // 从 10000 开始，避开常用端口
    const startPort = 10000;
    const endPort = 60000;
    // 随机选择起始点，避免每次都从同一端口开始
    const randomStart = startPort + Math.floor(Math.random() * (endPort - startPort));
    // 先尝试随机起始点附近的端口
    for (let offset = 0; offset < 1000; offset++) {
        const port = randomStart + offset;
        if (port > endPort)
            break;
        if (RESERVED_PORTS.has(port))
            continue;
        const occupied = await isPortOccupied(port);
        if (!occupied) {
            outputChannel.appendLine(`找到可用端口: ${port}`);
            return port;
        }
    }
    // 如果随机范围没找到，从头开始扫描
    for (let port = startPort; port <= endPort; port++) {
        if (RESERVED_PORTS.has(port))
            continue;
        const occupied = await isPortOccupied(port);
        if (!occupied) {
            outputChannel.appendLine(`找到可用端口: ${port}`);
            return port;
        }
    }
    vscode.window.showErrorMessage('无法找到可用端口');
    return null;
}
async function startMCPServer(context) {
    if (mcpServer) {
        vscode.window.showWarningMessage('MCP 服务器已在运行');
        return;
    }
    const config = vscode.workspace.getConfiguration('askContinue');
    let port = config.get('mcpPort') || 3456;
    // 检查端口是否被占用，如果占用则自动选择新端口
    const portOccupied = await isPortOccupied(port);
    if (portOccupied) {
        outputChannel.appendLine(`端口 ${port} 已被占用，自动选择新端口...`);
        const newPort = await findAvailablePort();
        if (!newPort) {
            vscode.window.showErrorMessage('无法找到可用端口');
            return;
        }
        port = newPort;
        // 保存新端口到配置并更新MCP配置文件
        await updatePortConfig(port);
        await updateMCPConfigPort(port);
        outputChannel.appendLine(`已自动切换到端口 ${port}，MCP配置已更新`);
        // 提示用户可能需要重新加载MCP
        vscode.window.showWarningMessage(`MCP端口已切换到 ${port}，如果工具调用失败请重新加载MCP配置`);
    }
    mcpServer = http.createServer(async (req, res) => {
        // CORS 头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        // 处理 MCP 请求
        if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', async () => {
                try {
                    const request = JSON.parse(body);
                    const response = await handleMCPRequest(request, context);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(response));
                }
                catch (error) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: String(error) }));
                }
            });
        }
        else if (req.method === 'GET') {
            // 健康检查
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', server: 'ask_continue' }));
        }
        else {
            res.writeHead(405);
            res.end();
        }
    });
    mcpServer.listen(port, () => {
        currentPort = port;
        outputChannel.appendLine(`MCP 服务器已启动: http://localhost:${port}`);
        outputChannel.appendLine(`服务器状态: mcpServer=${mcpServer ? '存在' : '空'}`);
        updateStatusBar();
        // 写入端口配置文件 - 全局和工作区两个位置
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const globalPortFile = path.join(homeDir, '.ask_continue_port');
        // 写入全局端口文件（备用）
        try {
            fs.writeFileSync(globalPortFile, String(port), 'utf-8');
            outputChannel.appendLine(`全局端口配置已写入: ${globalPortFile}`);
        }
        catch (e) {
            outputChannel.appendLine(`写入全局端口配置失败: ${e}`);
        }
        // 写入工作区端口文件（优先）
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspacePortFile = path.join(workspaceFolders[0].uri.fsPath, '.ask_continue_port');
            try {
                fs.writeFileSync(workspacePortFile, String(port), 'utf-8');
                outputChannel.appendLine(`工作区端口配置已写入: ${workspacePortFile}`);
            }
            catch (e) {
                outputChannel.appendLine(`写入工作区端口配置失败: ${e}`);
            }
            // 注册工作区到端口的映射（用于HTTP模式多窗口支持）
            registerWorkspacePort(workspaceFolders[0].uri.fsPath, port);
        }
        // 通知设置面板
        if (settingsPanel) {
            settingsPanel.webview.postMessage({ type: 'serverStatus', running: true, port });
        }
    });
    mcpServer.on('error', async (error) => {
        outputChannel.appendLine(`MCP 服务器错误: ${error.message}`);
        mcpServer = null;
        // 端口冲突时自动选择新端口并重启
        if (error.code === 'EADDRINUSE') {
            outputChannel.appendLine(`端口 ${port} 冲突，自动选择新端口并重启...`);
            const newPort = await findAvailablePort();
            if (newPort) {
                await updatePortConfig(newPort);
                await updateMCPConfigPort(newPort);
                outputChannel.appendLine(`正在重启服务器，新端口: ${newPort}`);
                vscode.window.showWarningMessage(`MCP端口已切换到 ${newPort}，如果工具调用失败请重新加载MCP配置`);
                // 延迟一下再重启，确保旧资源释放
                setTimeout(() => startMCPServer(context), 500);
            }
            else {
                vscode.window.showErrorMessage('端口冲突且无法找到可用端口');
            }
        }
        else {
            vscode.window.showErrorMessage(`MCP 服务器错误: ${error.message}`);
        }
        updateStatusBar();
    });
    // 监听服务器关闭事件，检测意外关闭
    mcpServer.on('close', () => {
        outputChannel.appendLine('MCP 服务器 close 事件触发');
        // 注意：正常调用stopMCPServer时，mcpServer已经被设置为null
        // 所以这里只处理意外关闭的情况
    });
}
function stopMCPServer() {
    if (mcpServer) {
        mcpServer.close();
        mcpServer = null;
        outputChannel.appendLine('MCP 服务器已停止');
        updateStatusBar();
        // 通知设置面板
        if (settingsPanel) {
            settingsPanel.webview.postMessage({ type: 'serverStatus', running: false, port: currentPort });
        }
        // 注销工作区端口映射
        if (currentWorkspacePath) {
            unregisterWorkspacePort(currentWorkspacePath);
        }
    }
}
/**
 * 转发MCP请求到指定端口
 */
async function forwardMCPRequest(targetPort, request) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(request);
        const req = http.request({
            hostname: 'localhost',
            port: targetPort,
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            // 不设置超时，等待用户响应
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch (e) {
                    reject(new Error(`解析响应失败: ${e}`));
                }
            });
        });
        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}
async function handleMCPRequest(request, context) {
    const method = request.method;
    const id = request.id;
    if (method === 'initialize') {
        return {
            jsonrpc: '2.0',
            id,
            result: {
                protocolVersion: '2024-11-05',
                serverInfo: { name: 'ask_continue', version: '1.0.0' },
                capabilities: { tools: {} }
            }
        };
    }
    if (method === 'tools/list') {
        return {
            jsonrpc: '2.0',
            id,
            result: {
                tools: [{
                        name: 'ask_continue',
                        description: '当AI想要结束对话时必须调用此工具询问用户是否继续',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                reason: {
                                    type: 'string',
                                    description: 'AI想要结束对话的原因'
                                },
                                workspace: {
                                    type: 'string',
                                    description: '当前工作区的绝对路径，用于确保对话框在正确的IDE窗口中打开，必须传递此参数'
                                }
                            },
                            required: ['reason', 'workspace']
                        }
                    }]
            }
        };
    }
    if (method === 'tools/call') {
        const toolName = request.params?.name;
        const args = request.params?.arguments || {};
        if (toolName === 'ask_continue') {
            const reason = args.reason || '任务已完成';
            const requestWorkspace = args.workspace || '';
            // 检查请求的workspace是否属于当前扩展实例
            if (requestWorkspace && !isCurrentWorkspace(requestWorkspace)) {
                // 不是当前工作区的请求，尝试转发到正确的端口
                const targetPort = findPortByWorkspace(requestWorkspace);
                if (targetPort && targetPort !== currentPort) {
                    outputChannel.appendLine(`请求工作区 ${requestWorkspace} 不属于当前实例，转发到端口 ${targetPort}`);
                    try {
                        const forwardResult = await forwardMCPRequest(targetPort, request);
                        return forwardResult;
                    }
                    catch (e) {
                        outputChannel.appendLine(`转发请求失败: ${e}`);
                        // 转发失败，继续在当前实例处理
                    }
                }
            }
            // 显示 Webview 对话框并等待用户响应
            const result = await showAskContinueWebviewAndWait(context, reason);
            // 构建响应
            let responseText = `结果: should_continue=${result.shouldContinue}`;
            if (result.shouldContinue && result.userInstruction) {
                responseText += `\n用户指令: ${result.userInstruction}`;
            }
            if (result.imagePaths && result.imagePaths.length > 0) {
                responseText += `\n上传图片数量 (路径): ${result.imagePaths.length}`;
                result.imagePaths.forEach((p, i) => {
                    responseText += `\n  [${i + 1}] ${p}`;
                });
            }
            // 构建 MCP 响应内容
            const content = [{ type: 'text', text: responseText }];
            // 如果有图片内容 (Base64)，添加到响应中
            if (result.imageContents && result.imageContents.length > 0) {
                result.imageContents.forEach(img => {
                    content.push({
                        type: 'image',
                        data: img.data,
                        mimeType: img.mimeType
                    });
                });
            }
            return {
                jsonrpc: '2.0',
                id,
                result: { content }
            };
        }
        return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Unknown tool: ${toolName}` }
        };
    }
    return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown method: ${method}` }
    };
}
// ==================== Webview 对话框 ====================
/**
 * 生成唯一的窗口标题
 */
function generateWindowTitle(reason) {
    const shortReason = reason.length > 15 ? reason.substring(0, 15) + '...' : reason;
    const randomNum = Math.floor(1000 + Math.random() * 9000); // 4位随机数
    return `继续对话-${shortReason}-${randomNum}`;
}
async function showAskContinueWebviewAndWait(context, reason) {
    const config = vscode.workspace.getConfiguration('askContinue');
    const popupMode = config.get('popupMode') || 'direct';
    return new Promise((resolve) => {
        // 生成唯一请求ID
        const requestId = `req_${Date.now()}_${++requestCounter}`;
        outputChannel.appendLine(`创建弹窗: ${requestId}, 模式: ${popupMode}, 当前弹窗数量: ${pendingRequests.size + 1}`);
        if (popupMode === 'hidden') {
            // 隐藏模式：创建状态栏项目
            createHiddenModeRequest(context, requestId, reason, resolve);
        }
        else {
            // 直接弹出模式：使用原有逻辑
            createIndependentWebview(context, requestId, reason, resolve);
        }
    });
}
/**
 * 隐藏模式：创建状态栏项目
 */
function createHiddenModeRequest(context, requestId, reason, resolve) {
    const shortReason = reason.length > 20 ? reason.substring(0, 20) + '...' : reason;
    // 创建状态栏项目
    const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
    statusItem.text = `$(comment-discussion) ${shortReason}`;
    statusItem.tooltip = `点击打开继续对话窗口\n原因: ${reason}`;
    statusItem.command = {
        title: '打开继续对话窗口',
        command: 'askContinue.openHiddenRequest',
        arguments: [requestId]
    };
    statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusItem.show();
    // 存储请求信息
    const hiddenRequest = {
        requestId,
        reason,
        statusBarItem: statusItem,
        panel: null,
        resolve,
        isResolved: false
    };
    hiddenModeRequests.set(requestId, hiddenRequest);
    outputChannel.appendLine(`隐藏模式: 已创建状态栏项目 ${requestId}`);
    // 更新状态栏显示待处理数量
    updateHiddenModeStatusCount();
}
/**
 * 隐藏模式：打开对应的webview窗口
 */
function openHiddenModeWebview(context, requestId) {
    const request = hiddenModeRequests.get(requestId);
    if (!request) {
        outputChannel.appendLine(`隐藏模式: 请求 ${requestId} 未找到`);
        return;
    }
    // 如果已经有打开的面板，直接显示
    if (request.panel) {
        request.panel.reveal(vscode.ViewColumn.Two);
        return;
    }
    const windowTitle = generateWindowTitle(request.reason);
    // 创建webview面板
    const panel = vscode.window.createWebviewPanel(`askContinue_${requestId}`, windowTitle, vscode.ViewColumn.Two, {
        enableScripts: true,
        retainContextWhenHidden: true
    });
    request.panel = panel;
    panel.webview.html = getWebviewContent(request.reason);
    // 消息处理
    panel.webview.onDidReceiveMessage((message) => {
        switch (message.type) {
            case 'continue':
                handleHiddenModeResult(requestId, {
                    shouldContinue: true,
                    userInstruction: message.instruction,
                    imagePaths: message.imagePaths,
                    imageContents: message.imageContents
                });
                break;
            case 'end':
                handleHiddenModeResult(requestId, { shouldContinue: false });
                break;
            case 'selectImages':
                selectImagesForHiddenRequest(requestId);
                break;
        }
    }, undefined, context.subscriptions);
    // 隐藏模式下关闭窗口不返回false，只是隐藏面板
    panel.onDidDispose(() => {
        const req = hiddenModeRequests.get(requestId);
        if (req && !req.isResolved) {
            // 只清除面板引用，不解决请求
            req.panel = null;
            outputChannel.appendLine(`隐藏模式: 面板关闭但请求未结束 ${requestId}`);
        }
    });
}
/**
 * 隐藏模式：处理结果
 */
function handleHiddenModeResult(requestId, result) {
    const request = hiddenModeRequests.get(requestId);
    if (!request || request.isResolved) {
        outputChannel.appendLine(`隐藏模式: 请求 ${requestId} 未找到或已处理`);
        return;
    }
    // 标记为已解决
    request.isResolved = true;
    // 输出日志
    outputChannel.appendLine('');
    outputChannel.appendLine(`隐藏模式请求 ${requestId} 响应:`);
    outputChannel.appendLine(`结果: should_continue=${result.shouldContinue}`);
    if (result.userInstruction) {
        outputChannel.appendLine(`用户指令: ${result.userInstruction}`);
    }
    outputChannel.show();
    // 关闭面板
    if (request.panel) {
        request.panel.dispose();
    }
    // 移除状态栏项目
    request.statusBarItem.dispose();
    // 从Map中移除
    hiddenModeRequests.delete(requestId);
    // 更新状态栏计数
    updateHiddenModeStatusCount();
    // 解决Promise
    request.resolve(result);
}
/**
 * 隐藏模式：选择图片
 */
async function selectImagesForHiddenRequest(requestId) {
    const request = hiddenModeRequests.get(requestId);
    if (!request || !request.panel)
        return;
    const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        filters: { 'Images': ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }
    });
    if (uris && uris.length > 0) {
        const config = vscode.workspace.getConfiguration('askContinue');
        const paths = uris.map(uri => uri.fsPath);
        // 读取图片内容
        const contents = await Promise.all(uris.map(async (uri) => {
            const data = await vscode.workspace.fs.readFile(uri);
            const base64 = Buffer.from(data).toString('base64');
            const ext = path.extname(uri.fsPath).toLowerCase().slice(1);
            const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
            return {
                name: path.basename(uri.fsPath),
                data: base64,
                mimeType
            };
        }));
        request.panel.webview.postMessage({
            type: 'imagesSelected',
            paths,
            contents
        });
    }
}
/**
 * 更新隐藏模式状态栏计数
 */
function updateHiddenModeStatusCount() {
    const count = hiddenModeRequests.size;
    outputChannel.appendLine(`隐藏模式: 当前待处理请求数量 ${count}`);
}
/**
 * 清理已超时或无效的隐藏模式请求
 */
function cleanupHiddenModeRequests() {
    // 这个函数可以在将来添加超时检测逻辑
    // 目前只是占位
}
/**
 * 为每个请求创建独立的webview弹窗
 */
function createIndependentWebview(context, requestId, reason, resolve) {
    const config = vscode.workspace.getConfiguration('askContinue');
    const defaultReason = reason || config.get('defaultReason') || '任务已完成';
    const windowTitle = generateWindowTitle(defaultReason);
    // 创建独立的webview面板
    const panel = vscode.window.createWebviewPanel(`askContinue_${requestId}`, windowTitle, vscode.ViewColumn.Two, {
        enableScripts: true,
        retainContextWhenHidden: true
    });
    // 存储请求信息
    pendingRequests.set(requestId, { resolve, panel, reason: defaultReason });
    activeRequestId = requestId;
    panel.webview.html = getWebviewContent(defaultReason);
    // 每个面板有独立的消息处理
    panel.webview.onDidReceiveMessage((message) => {
        switch (message.type) {
            case 'continue':
                handleSingleResult(requestId, {
                    shouldContinue: true,
                    userInstruction: message.instruction,
                    imagePaths: message.imagePaths,
                    imageContents: message.imageContents
                });
                break;
            case 'end':
                handleSingleResult(requestId, { shouldContinue: false });
                break;
            case 'selectImages':
                selectImagesForRequest(requestId);
                break;
        }
    }, undefined, context.subscriptions);
    panel.onDidDispose(() => {
        // 面板被关闭，只解决这个请求
        const request = pendingRequests.get(requestId);
        if (request) {
            outputChannel.appendLine(`面板关闭，解决请求: ${requestId}`);
            request.resolve({ shouldContinue: false });
            pendingRequests.delete(requestId);
        }
        if (activeRequestId === requestId) {
            activeRequestId = null;
        }
    });
}
/**
 * 处理单个请求的响应（只影响对应的请求，不影响其他弹窗）
 */
function handleSingleResult(requestId, result) {
    const request = pendingRequests.get(requestId);
    if (!request) {
        outputChannel.appendLine(`请求 ${requestId} 未找到，可能已被处理`);
        return;
    }
    // 先从Map中移除，防止重复处理
    pendingRequests.delete(requestId);
    // 输出到日志
    outputChannel.appendLine('');
    outputChannel.appendLine(`请求 ${requestId} 响应:`);
    outputChannel.appendLine(`结果: should_continue=${result.shouldContinue}`);
    if (result.userInstruction) {
        outputChannel.appendLine(`用户指令: ${result.userInstruction}`);
    }
    if (result.imagePaths && result.imagePaths.length > 0) {
        outputChannel.appendLine(`上传图片数量 (路径模式): ${result.imagePaths.length}`);
        result.imagePaths.forEach((p, i) => {
            outputChannel.appendLine(`  [${i + 1}] ${p}`);
        });
    }
    if (result.imageContents && result.imageContents.length > 0) {
        outputChannel.appendLine(`上传图片数量 (Base64模式): ${result.imageContents.length}`);
        result.imageContents.forEach((img, i) => {
            outputChannel.appendLine(`  [${i + 1}] ${img.name} (${img.mimeType}, ${Math.round(img.data.length / 1024)}KB)`);
        });
    }
    outputChannel.show();
    // 关闭这个请求的面板
    if (request.panel) {
        request.panel.dispose();
    }
    // 解决这个请求的 Promise
    request.resolve(result);
    // 显示通知
    if (result.shouldContinue) {
        vscode.window.showInformationMessage(`继续执行${result.userInstruction ? `，指令: ${result.userInstruction}` : ''}`);
    }
    else {
        vscode.window.showInformationMessage('对话已结束');
    }
    if (activeRequestId === requestId) {
        activeRequestId = null;
    }
}
/**
 * 为特定请求选择图片
 */
async function selectImagesForRequest(requestId) {
    const request = pendingRequests.get(requestId);
    if (!request)
        return;
    const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        filters: {
            'Images': ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']
        }
    });
    if (uris && request.panel) {
        const paths = uris.map((uri) => uri.fsPath);
        // 读取图片内容为 Base64
        const contents = [];
        for (const uri of uris) {
            try {
                const data = fs.readFileSync(uri.fsPath);
                const ext = path.extname(uri.fsPath).toLowerCase();
                const mimeTypes = {
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.bmp': 'image/bmp',
                    '.webp': 'image/webp'
                };
                contents.push({
                    name: path.basename(uri.fsPath),
                    data: data.toString('base64'),
                    mimeType: mimeTypes[ext] || 'image/png'
                });
            }
            catch (e) {
                outputChannel.appendLine(`读取图片失败: ${uri.fsPath}, ${e}`);
            }
        }
        request.panel.webview.postMessage({
            type: 'imagesSelected',
            paths,
            contents
        });
    }
}
// 保留原来的 showAskContinueWebview 用于手动打开（非MCP调用）
function showAskContinueWebview(context, reason) {
    const config = vscode.workspace.getConfiguration('askContinue');
    const defaultReason = reason || config.get('defaultReason') || '任务已完成';
    // 手动打开时也创建独立窗口
    const requestId = `manual_${Date.now()}_${++requestCounter}`;
    createIndependentWebview(context, requestId, defaultReason, (result) => {
        // 手动打开时只显示通知，不需要返回值
        if (result.shouldContinue) {
            vscode.window.showInformationMessage(`继续执行${result.userInstruction ? `，指令: ${result.userInstruction}` : ''}`);
        }
        else {
            vscode.window.showInformationMessage('对话已结束');
        }
    });
}
async function selectImages() {
    // 使用activeRequestId找到当前活动的请求
    if (!activeRequestId)
        return;
    await selectImagesForRequest(activeRequestId);
}
function getWebviewContent(reason) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ask Continue</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            min-height: 100vh;
        }
        .container { max-width: 500px; margin: 0 auto; }
        h1 {
            font-size: 1.4em;
            margin-bottom: 15px;
            color: var(--vscode-titleBar-activeForeground);
        }
        .reason-box {
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            padding: 10px 15px;
            margin-bottom: 20px;
            border-radius: 4px;
        }
        .reason-label { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-bottom: 5px; }
        .reason-text { font-size: 1em; }
        label { display: block; margin-bottom: 8px; font-weight: 500; }
        textarea {
            width: 100%;
            height: 100px;
            padding: 10px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            font-size: 0.95em;
            resize: vertical;
        }
        textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
        .image-section { margin: 15px 0; }
        .image-list {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            min-height: 60px;
            max-height: 120px;
            overflow-y: auto;
            padding: 5px;
            margin-bottom: 10px;
        }
        .image-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 5px 8px;
            background: var(--vscode-badge-background);
            border-radius: 3px;
            margin-bottom: 4px;
            font-size: 0.85em;
        }
        .image-item:last-child { margin-bottom: 0; }
        .image-item button {
            background: transparent;
            border: none;
            color: var(--vscode-errorForeground);
            cursor: pointer;
            font-size: 1.1em;
        }
        .btn-row { display: flex; gap: 10px; margin-top: 20px; }
        button {
            flex: 1;
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            font-size: 1em;
            cursor: pointer;
            transition: opacity 0.2s;
        }
        button:hover { opacity: 0.9; }
        .btn-continue {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-end {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-add {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            padding: 8px 15px;
            flex: none;
        }
        .shortcut-hint {
            text-align: center;
            margin-top: 15px;
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
        }
        .image-preview {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 10px;
        }
        .image-preview-item {
            position: relative;
            width: 80px;
            height: 80px;
            border-radius: 4px;
            overflow: hidden;
            border: 1px solid var(--vscode-input-border);
        }
        .image-preview-item img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .image-preview-item .remove-btn {
            position: absolute;
            top: 2px;
            right: 2px;
            width: 18px;
            height: 18px;
            background: rgba(0,0,0,0.6);
            border: none;
            border-radius: 50%;
            color: white;
            font-size: 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
        }
        .image-preview-item .remove-btn:hover {
            background: rgba(255,0,0,0.8);
        }
        .paste-hint {
            color: var(--vscode-textLink-foreground);
            font-size: 0.85em;
            margin-top: 5px;
        }
        /* 拖放区域样式 */
        .drop-zone {
            border: 2px dashed var(--vscode-input-border);
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            transition: all 0.3s;
            cursor: pointer;
            margin-bottom: 10px;
        }
        .drop-zone:hover {
            border-color: var(--vscode-textLink-foreground);
            background: var(--vscode-list-hoverBackground);
        }
        .drop-zone.drag-over {
            border-color: var(--vscode-textLink-foreground);
            background: var(--vscode-list-activeSelectionBackground);
            transform: scale(1.02);
        }
        .drop-zone-icon { font-size: 2em; margin-bottom: 8px; }
        .drop-zone-text { font-size: 0.9em; color: var(--vscode-descriptionForeground); }
        .drop-zone-hint { font-size: 0.8em; color: var(--vscode-textLink-foreground); margin-top: 5px; }
        /* 图片预览增强 */
        .image-preview-item {
            cursor: pointer;
            transition: transform 0.2s;
        }
        .image-preview-item:hover {
            transform: scale(1.05);
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        /* 图片放大模态框 */
        .image-modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.9);
            z-index: 1000;
            justify-content: center;
            align-items: center;
            cursor: zoom-out;
        }
        .image-modal.show { display: flex; }
        .image-modal img {
            max-width: 90%;
            max-height: 90%;
            object-fit: contain;
            border-radius: 4px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }
        .image-modal-close {
            position: absolute;
            top: 20px;
            right: 30px;
            font-size: 2em;
            color: white;
            cursor: pointer;
            background: none;
            border: none;
            padding: 10px;
        }
        .image-modal-close:hover { color: #ff6b6b; }
        /* 隐藏的文件输入 */
        .hidden-input { display: none; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 继续对话？</h1>
        
        <div class="reason-box">
            <div class="reason-label">AI想要结束对话的原因：</div>
            <div class="reason-text" id="reason">${escapeHtml(reason)}</div>
        </div>
        
        <label for="instruction">如需继续，请输入新的指令（可选）：</label>
        <textarea id="instruction" placeholder="输入新指令或留空继续上一个任务..." autofocus></textarea>
        
        <div class="image-section">
            <label>上传图片（可选）：</label>
            <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                    <input type="radio" name="imageMode" value="content" checked onchange="updateImageMode()"> 图片内容 (Base64)
                </label>
                <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                    <input type="radio" name="imageMode" value="path" onchange="updateImageMode()"> 仅路径
                </label>
            </div>
            <!-- 拖放上传区域 -->
            <div class="drop-zone" id="dropZone" onclick="document.getElementById('fileInput').click()">
                <div class="drop-zone-icon">📷</div>
                <div class="drop-zone-text">拖放图片到这里，或点击选择</div>
                <div class="drop-zone-hint">支持 Ctrl+V 粘贴 | 支持多张图片</div>
            </div>
            <input type="file" id="fileInput" class="hidden-input" accept="image/*" multiple onchange="handleFileSelect(event)">
            <div class="image-preview" id="imagePreview"></div>
            <button class="btn-add" onclick="selectImages()">📁 从系统选择图片</button>
        </div>
        
        <!-- 图片放大模态框 -->
        <div class="image-modal" id="imageModal" onclick="closeImageModal()">
            <button class="image-modal-close" onclick="closeImageModal()">&times;</button>
            <img id="modalImage" src="" alt="放大预览">
        </div>
        
        <div class="btn-row">
            <button class="btn-continue" onclick="onContinue()">▶ 继续执行</button>
            <button class="btn-end" onclick="onEnd()">⏹ 结束对话</button>
        </div>
        
        <div class="shortcut-hint">快捷键: Enter = 继续 | Shift+Enter = 换行 | Esc = 结束</div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        let imagePaths = [];
        let imageContents = [];  // Base64 内容
        let imageMode = 'content';  // 'content' 或 'path'
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function updateImageMode() {
            imageMode = document.querySelector('input[name="imageMode"]:checked').value;
        }
        
        function onContinue() {
            const instruction = document.getElementById('instruction').value.trim();
            const msg = {
                type: 'continue',
                instruction: instruction || undefined,
                imageMode: imageMode
            };
            if (imageMode === 'path' && imagePaths.length > 0) {
                msg.imagePaths = imagePaths;
            } else if (imageMode === 'content' && imageContents.length > 0) {
                msg.imageContents = imageContents;
            }
            vscode.postMessage(msg);
        }
        
        function onEnd() {
            vscode.postMessage({ type: 'end' });
        }
        
        function selectImages() {
            vscode.postMessage({ type: 'selectImages', imageMode: imageMode });
        }
        
        function updateImageList() {
            const dropZone = document.getElementById('dropZone');
            const preview = document.getElementById('imagePreview');
            
            if (imagePaths.length === 0 && imageContents.length === 0) {
                // 恢复默认拖放区域
                dropZone.innerHTML = '<div class="drop-zone-icon">📷</div><div class="drop-zone-text">拖放图片到这里，或点击选择</div><div class="drop-zone-hint">支持 Ctrl+V 粘贴 | 支持多张图片</div>';
                preview.innerHTML = '';
            } else {
                // 更新拖放区域显示已选图片数量
                dropZone.innerHTML = '<div class="drop-zone-icon">✅</div><div class="drop-zone-text">已添加 ' + imagePaths.length + ' 张图片</div><div class="drop-zone-hint">继续拖放或点击添加更多</div>';
                
                // 显示图片预览（仅Base64模式有预览）
                if (imageMode === 'content' && imageContents.length > 0) {
                    preview.innerHTML = imageContents.map((img, i) => 
                        '<div class="image-preview-item" onclick="openImageModal(' + i + ')">' +
                        '<img src="data:' + img.mimeType + ';base64,' + img.data + '" alt="' + escapeHtml(img.name) + '" title="点击放大">' +
                        '<button class="remove-btn" onclick="event.stopPropagation(); removeImage(' + i + ')">✕</button>' +
                        '</div>'
                    ).join('');
                } else {
                    // 路径模式：显示文件名列表
                    preview.innerHTML = imagePaths.map((p, i) => 
                        '<div class="image-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px; background: var(--vscode-badge-background); border-radius: 4px; margin-bottom: 4px;">' +
                        '<span style="font-size: 0.85em;">' + escapeHtml(p.split(/[\\\\/]/).pop()) + '</span>' +
                        '<button onclick="removeImage(' + i + ')" style="background: transparent; border: none; color: var(--vscode-errorForeground); cursor: pointer;">✕</button>' +
                        '</div>'
                    ).join('');
                }
            }
        }
        
        function removeImage(index) {
            imagePaths.splice(index, 1);
            imageContents.splice(index, 1);
            updateImageList();
        }
        
        // 图片放大预览
        function openImageModal(index) {
            const img = imageContents[index];
            if (!img) return;
            const modal = document.getElementById('imageModal');
            const modalImg = document.getElementById('modalImage');
            modalImg.src = 'data:' + img.mimeType + ';base64,' + img.data;
            modal.classList.add('show');
        }
        
        function closeImageModal() {
            document.getElementById('imageModal').classList.remove('show');
        }
        
        // ESC 关闭模态框
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && document.getElementById('imageModal').classList.contains('show')) {
                e.stopPropagation();
                closeImageModal();
                return;
            }
        });
        
        // 处理文件选择（点击上传）
        function handleFileSelect(e) {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            processFiles(files);
            e.target.value = ''; // 清空以便重复选择同一文件
        }
        
        // 处理拖放上传
        const dropZone = document.getElementById('dropZone');
        
        dropZone.addEventListener('dragover', e => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        
        dropZone.addEventListener('dragleave', e => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
        });
        
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                processFiles(files);
            }
        });
        
        // 通用文件处理函数
        function processFiles(files) {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (!file.type.startsWith('image/')) continue;
                
                const reader = new FileReader();
                reader.onload = function(event) {
                    const base64 = event.target.result;
                    if (typeof base64 !== 'string') return;
                    
                    const base64Data = base64.split(',')[1];
                    const mimeType = file.type || 'image/png';
                    
                    imagePaths.push(file.name);
                    imageContents.push({
                        name: file.name,
                        data: base64Data,
                        mimeType: mimeType
                    });
                    
                    updateImageList();
                };
                reader.readAsDataURL(file);
            }
        }
        
        // 处理粘贴图片
        function handlePasteImage(e) {
            const items = e.clipboardData?.items;
            if (!items) return;
            
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.type.indexOf('image') !== -1) {
                    e.preventDefault();  // 阻止默认粘贴行为
                    
                    const blob = item.getAsFile();
                    if (!blob) continue;
                    
                    const reader = new FileReader();
                    reader.onload = function(event) {
                        const base64 = event.target.result;
                        if (typeof base64 !== 'string') return;
                        
                        // 提取纯base64数据（去掉data:xxx;base64,前缀）
                        const base64Data = base64.split(',')[1];
                        const mimeType = item.type || 'image/png';
                        
                        // 生成文件名
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                        const ext = mimeType.split('/')[1] || 'png';
                        const name = 'pasted_' + timestamp + '.' + ext;
                        
                        // 添加到列表
                        imagePaths.push(name);  // 使用生成的名称作为标识
                        imageContents.push({
                            name: name,
                            data: base64Data,
                            mimeType: mimeType
                        });
                        
                        updateImageList();
                    };
                    reader.readAsDataURL(blob);
                    break;  // 只处理第一张图片
                }
            }
        }
        
        // 监听消息
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'setReason') {
                document.getElementById('reason').textContent = message.reason;
            } else if (message.type === 'imagesSelected') {
                imagePaths = imagePaths.concat(message.paths);
                if (message.contents) {
                    imageContents = imageContents.concat(message.contents);
                }
                updateImageList();
            }
        });
        
        // 快捷键: Enter 发送，Shift+Enter 换行，Esc 结束
        document.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();  // 阻止默认的换行行为
                onContinue();
            } else if (e.key === 'Escape') {
                onEnd();
            }
        });
        
        // 监听粘贴事件（整个文档，这样无论焦点在哪都能粘贴图片）
        document.addEventListener('paste', handlePasteImage);
        
        // 聚焦输入框 - 使用多种方式确保聚焦生效
        function focusInput() {
            const input = document.getElementById('instruction');
            if (input) {
                input.focus();
                // 确保可以立即输入
                input.click();
            }
        }
        
        // 立即尝试聚焦
        focusInput();
        
        // 延迟聚焦以确保 webview 完全加载
        setTimeout(focusInput, 100);
        setTimeout(focusInput, 300);
        
        // 当窗口获得焦点时也尝试聚焦
        window.addEventListener('focus', focusInput);
    </script>
</body>
</html>`;
}
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
// ==================== 快速对话框 ====================
async function showQuickDialog() {
    const config = vscode.workspace.getConfiguration('askContinue');
    const defaultReason = config.get('defaultReason') || '任务已完成';
    const reason = await vscode.window.showInputBox({
        prompt: 'AI想要结束对话的原因',
        value: defaultReason
    });
    if (!reason) {
        return;
    }
    const result = await vscode.window.showQuickPick([
        { label: '$(play) 继续执行', value: 'continue' },
        { label: '$(stop) 结束对话', value: 'end' }
    ], { placeHolder: `原因: ${reason}` });
    if (!result) {
        return;
    }
    if (result.value === 'continue') {
        const instruction = await vscode.window.showInputBox({
            prompt: '请输入新的指令（可选）'
        });
        vscode.window.showInformationMessage(`继续执行${instruction ? `，指令: ${instruction}` : ''}`);
    }
    else {
        vscode.window.showInformationMessage('对话已结束');
    }
}
// ==================== 规则文件创建 ====================
async function createRulesFile() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('请先打开一个工作区');
        return;
    }
    const rootPath = workspaceFolders[0].uri.fsPath;
    const ruleType = await vscode.window.showQuickPick([
        { label: 'Windsurf (.windsurfrules)', value: 'windsurf' }
    ], { placeHolder: '选择要创建的文件类型' });
    if (!ruleType) {
        return;
    }
    try {
        await writeFile(path.join(rootPath, '.windsurfrules'), RULE_TEMPLATE);
        vscode.window.showInformationMessage('文件创建成功！');
    }
    catch (error) {
        vscode.window.showErrorMessage(`创建失败: ${error}`);
    }
}
async function writeFile(filePath, content) {
    fs.writeFileSync(filePath, content, 'utf-8');
    outputChannel.appendLine(`创建: ${filePath}`);
    return true;
}
// ==================== 设置面板 ====================
function showSettingsPanel(context) {
    if (settingsPanel) {
        settingsPanel.reveal(vscode.ViewColumn.One);
        return;
    }
    settingsPanel = vscode.window.createWebviewPanel('askContinueSettings', 'Ask Continue 设置', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    const config = vscode.workspace.getConfiguration('askContinue');
    settingsPanel.webview.html = getSettingsWebviewContent(mcpServer !== null, currentPort, config.get('autoStart') || true, config.get('defaultReason') || '任务已完成');
    settingsPanel.webview.onDidReceiveMessage(async (message) => {
        const config = vscode.workspace.getConfiguration('askContinue');
        switch (message.type) {
            case 'toggleServer':
                await toggleMCPServer(context);
                break;
            case 'saveSettings':
                if (message.port !== undefined) {
                    await updatePortConfig(message.port);
                }
                if (message.autoStart !== undefined) {
                    await config.update('autoStart', message.autoStart, vscode.ConfigurationTarget.Global);
                }
                if (message.defaultReason !== undefined) {
                    await config.update('defaultReason', message.defaultReason, vscode.ConfigurationTarget.Global);
                }
                settingsPanel?.webview.postMessage({ type: 'settingsSaved' });
                break;
            case 'restartServer':
                stopMCPServer();
                if (message.port) {
                    await updatePortConfig(message.port);
                }
                await startMCPServer(context);
                break;
            case 'createRules':
                await createRulesFromSettings(message.ruleType || 'both');
                settingsPanel?.webview.postMessage({ type: 'rulesCreated' });
                break;
            case 'testDialog':
                showAskContinueWebview(context, message.defaultReason);
                break;
        }
    }, undefined, context.subscriptions);
    settingsPanel.onDidDispose(() => {
        settingsPanel = null;
    });
}
// ==================== 工作区端口映射管理 ====================
/**
 * 获取工作区端口映射文件路径
 */
function getWorkspacePortMapPath() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    return path.join(homeDir, '.ask_continue_workspace_ports.json');
}
/**
 * 读取工作区端口映射
 */
function readWorkspacePortMap() {
    try {
        const mapPath = getWorkspacePortMapPath();
        if (fs.existsSync(mapPath)) {
            const content = fs.readFileSync(mapPath, 'utf-8');
            return JSON.parse(content);
        }
    }
    catch (e) {
        outputChannel.appendLine(`读取工作区端口映射失败: ${e}`);
    }
    return {};
}
/**
 * 注册工作区到端口的映射
 */
function registerWorkspacePort(workspace, port) {
    try {
        const mapPath = getWorkspacePortMapPath();
        const portMap = readWorkspacePortMap();
        // 规范化路径（统一使用小写和正斜杠，便于匹配）
        const normalizedWorkspace = workspace.toLowerCase().replace(/\\/g, '/');
        portMap[normalizedWorkspace] = port;
        fs.writeFileSync(mapPath, JSON.stringify(portMap, null, 2), 'utf-8');
        outputChannel.appendLine(`工作区端口映射已注册: ${normalizedWorkspace} -> ${port}`);
    }
    catch (e) {
        outputChannel.appendLine(`注册工作区端口映射失败: ${e}`);
    }
}
/**
 * 注销工作区端口映射
 */
function unregisterWorkspacePort(workspace) {
    try {
        const mapPath = getWorkspacePortMapPath();
        const portMap = readWorkspacePortMap();
        const normalizedWorkspace = workspace.toLowerCase().replace(/\\/g, '/');
        delete portMap[normalizedWorkspace];
        fs.writeFileSync(mapPath, JSON.stringify(portMap, null, 2), 'utf-8');
        outputChannel.appendLine(`工作区端口映射已注销: ${normalizedWorkspace}`);
    }
    catch (e) {
        outputChannel.appendLine(`注销工作区端口映射失败: ${e}`);
    }
}
/**
 * 根据工作区路径查找对应的端口
 */
function findPortByWorkspace(workspace) {
    const portMap = readWorkspacePortMap();
    const normalizedWorkspace = workspace.toLowerCase().replace(/\\/g, '/');
    // 精确匹配
    if (portMap[normalizedWorkspace]) {
        return portMap[normalizedWorkspace];
    }
    // 尝试匹配子路径（工作区可能是传入路径的父目录）
    for (const [ws, port] of Object.entries(portMap)) {
        if (normalizedWorkspace.startsWith(ws + '/') || normalizedWorkspace === ws) {
            return port;
        }
    }
    return null;
}
/**
 * 检查请求的workspace是否属于当前扩展实例
 */
function isCurrentWorkspace(workspace) {
    if (!currentWorkspacePath)
        return true; // 没有工作区时接受所有请求
    const normalizedRequest = workspace.toLowerCase().replace(/\\/g, '/');
    const normalizedCurrent = currentWorkspacePath.toLowerCase().replace(/\\/g, '/');
    return normalizedRequest === normalizedCurrent ||
        normalizedRequest.startsWith(normalizedCurrent + '/');
}
// ==================== MCP 服务配置安装 ====================
/**
 * 静默安装MCP配置到Windsurf全局配置
 */
async function installMCPConfigSilent() {
    try {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const windsurfConfigPath = path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json');
        // 默认使用HTTP模式安装，无需Node.js依赖
        await writeMCPConfig(windsurfConfigPath, currentPort, 'http', extensionContext.extensionPath);
    }
    catch {
        // 静默处理错误
    }
}
async function installMCPConfig(context) {
    const config = vscode.workspace.getConfiguration('askContinue');
    const port = config.get('mcpPort') || 3456;
    const mcpUrl = `http://localhost:${port}`;
    // MCP 服务器脚本路径
    const mcpServerScript = path.join(context.extensionPath, 'mcp-server.js');
    // 检测可能的配置文件位置（跨平台支持）
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const isWindows = process.platform === 'win32';
    const isLinux = process.platform === 'linux';
    const isMac = process.platform === 'darwin';
    // 根据平台选择正确的配置目录
    let appDataDir;
    let claudeConfigDir;
    if (isWindows) {
        appDataDir = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
        claudeConfigDir = path.join(appDataDir, 'Claude');
    }
    else if (isMac) {
        appDataDir = path.join(homeDir, 'Library', 'Application Support');
        claudeConfigDir = path.join(appDataDir, 'Claude');
    }
    else {
        // Linux
        appDataDir = process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config');
        claudeConfigDir = path.join(appDataDir, 'Claude');
    }
    const configLocations = [
        {
            name: 'Windsurf (全局)',
            path: path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json'),
            type: 'windsurf-global',
            mode: 'stdio'
        }
    ];
    // 显示配置向导
    const panel = vscode.window.createWebviewPanel('mcpInstall', 'MCP 服务配置向导', vscode.ViewColumn.One, { enableScripts: true });
    panel.webview.html = getMCPInstallWebviewContent(mcpUrl, port, configLocations);
    panel.webview.onDidReceiveMessage(async (message) => {
        if (message.type === 'install') {
            const target = message.target;
            let configPath = '';
            // 优先使用用户选择的模式
            let mode = message.mode || 'stdio';
            if (target === 'custom' && message.customPath) {
                configPath = message.customPath;
            }
            else {
                const location = configLocations.find(l => l.type === target);
                if (location?.path) {
                    configPath = location.path;
                }
            }
            if (configPath) {
                try {
                    await writeMCPConfig(configPath, port, mode, context.extensionPath);
                    const modeText = mode === 'stdio' ? 'stdio 模式' : 'HTTP 模式';
                    panel.webview.postMessage({ type: 'success', message: `已配置 (${modeText}): ${configPath}` });
                    outputChannel.appendLine(`MCP 配置已写入 (${modeText}): ${configPath}`);
                }
                catch (error) {
                    panel.webview.postMessage({ type: 'error', message: `配置失败: ${error}` });
                }
            }
        }
        else if (message.type === 'copy') {
            const copyMode = message.mode || 'http';
            let configJson;
            if (copyMode === 'stdio') {
                const mcpServerScript = path.join(context.extensionPath, 'mcp-server.js');
                const nodeResult = getNodePath();
                configJson = JSON.stringify({
                    mcpServers: {
                        ask_continue: {
                            command: nodeResult.path,
                            args: [mcpServerScript]
                        }
                    }
                }, null, 2);
            }
            else {
                configJson = JSON.stringify({
                    mcpServers: {
                        ask_continue: { url: mcpUrl }
                    }
                }, null, 2);
            }
            vscode.env.clipboard.writeText(configJson);
            panel.webview.postMessage({ type: 'success', message: '已复制到剪贴板' });
        }
        else if (message.type === 'startServer') {
            await startMCPServer(context);
            panel.webview.postMessage({ type: 'serverStarted' });
        }
    }, undefined, context.subscriptions);
}
// Windows 默认 Node.js 安装路径
const WINDOWS_DEFAULT_NODE_PATH = 'C:\\Program Files\\nodejs\\node.exe';
// 获取 node 的完整路径（跨平台支持）
function getNodePath() {
    const isWindows = process.platform === 'win32';
    if (isWindows) {
        // Windows: 尝试多种方式查找 Node.js
        // 1. 尝试使用 where 命令查找
        try {
            const { execSync } = require('child_process');
            const result = execSync('where node', { encoding: 'utf-8', timeout: 5000 }).trim();
            // where 可能返回多行，取第一行
            const nodePath = result.split('\n')[0].trim();
            if (nodePath && fs.existsSync(nodePath)) {
                outputChannel.appendLine(`通过 where 命令找到 node 路径: ${nodePath}`);
                return { path: nodePath, found: true };
            }
        }
        catch (e) {
            outputChannel.appendLine('where node 命令执行失败，尝试常见路径');
        }
        // 2. 检查常见的 Windows Node.js 安装路径
        const windowsCommonPaths = [
            WINDOWS_DEFAULT_NODE_PATH,
            'C:\\Program Files (x86)\\nodejs\\node.exe',
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'node', 'node.exe'),
            path.join(process.env.APPDATA || '', 'npm', 'node.exe'),
            path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'node', 'node.exe'),
            // nvm-windows 路径
            path.join(process.env.NVM_HOME || '', 'nodejs', 'node.exe'),
            path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'nvm', 'current', 'node.exe')
        ];
        for (const p of windowsCommonPaths) {
            if (p && fs.existsSync(p)) {
                outputChannel.appendLine(`在常见路径找到 node: ${p}`);
                return { path: p, found: true };
            }
        }
        // 3. 未找到，返回默认路径
        outputChannel.appendLine(`未找到 Node.js，将使用默认路径: ${WINDOWS_DEFAULT_NODE_PATH}`);
        return { path: WINDOWS_DEFAULT_NODE_PATH, found: false };
    }
    // Linux/macOS: 尝试获取完整路径
    try {
        const { execSync } = require('child_process');
        const nodePath = execSync('which node', { encoding: 'utf-8', timeout: 5000 }).trim();
        if (nodePath && fs.existsSync(nodePath)) {
            outputChannel.appendLine(`找到 node 路径: ${nodePath}`);
            return { path: nodePath, found: true };
        }
    }
    catch (e) {
        outputChannel.appendLine('无法获取 node 完整路径，尝试常见路径');
    }
    // 回退到常见路径
    const commonPaths = [
        '/usr/bin/node',
        '/usr/local/bin/node',
        '/opt/node/bin/node',
        '/opt/homebrew/bin/node',
        path.join(process.env.HOME || '', '.nvm/versions/node/*/bin/node'),
        path.join(process.env.HOME || '', '.local/bin/node')
    ];
    for (const p of commonPaths) {
        if (fs.existsSync(p)) {
            outputChannel.appendLine(`使用 node 路径: ${p}`);
            return { path: p, found: true };
        }
    }
    // 最后回退到 node
    const defaultPath = isWindows ? WINDOWS_DEFAULT_NODE_PATH : '/usr/bin/node';
    return { path: defaultPath, found: false };
}
async function writeMCPConfig(configPath, port, mode = 'stdio', extensionPath = '') {
    let config = {};
    // 确保目录存在
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    // 读取现有配置
    if (fs.existsSync(configPath)) {
        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            config = JSON.parse(content);
        }
        catch {
            config = {};
        }
    }
    // 添加或更新 MCP 服务器配置
    if (!config.mcpServers) {
        config.mcpServers = {};
    }
    if (mode === 'stdio' && extensionPath) {
        // stdio 模式 - 使用 Node.js 运行 MCP 服务器脚本
        const mcpServerScript = path.join(extensionPath, 'mcp-server.js');
        const nodeResult = getNodePath();
        // 如果未找到 Node.js，提示用户
        if (!nodeResult.found) {
            const isWindows = process.platform === 'win32';
            if (isWindows) {
                vscode.window.showWarningMessage(`未检测到 Node.js 安装。请安装 Node.js 到默认路径 (${WINDOWS_DEFAULT_NODE_PATH})，或确保 node 在系统 PATH 中。MCP 配置将使用默认路径。`, '下载 Node.js').then(selection => {
                    if (selection === '下载 Node.js') {
                        vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
                    }
                });
            }
            else {
                vscode.window.showWarningMessage('未检测到 Node.js 安装。请安装 Node.js 并确保在系统 PATH 中。', '下载 Node.js').then(selection => {
                    if (selection === '下载 Node.js') {
                        vscode.env.openExternal(vscode.Uri.parse('https://nodejs.org/'));
                    }
                });
            }
            outputChannel.appendLine(`警告: 未找到 Node.js，使用默认路径: ${nodeResult.path}`);
        }
        config.mcpServers.ask_continue = {
            command: nodeResult.path,
            args: [mcpServerScript]
        };
    }
    else {
        // HTTP 模式
        config.mcpServers.ask_continue = {
            url: `http://localhost:${port}`
        };
    }
    // 写入配置
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
function getMCPInstallWebviewContent(mcpUrl, port, locations) {
    const locationItems = locations
        .filter(l => l.path)
        .map(l => `<div class="location-item" data-type="${l.type}">
            <span class="name">${l.name}</span>
            <span class="path">${l.path}</span>
            <button class="btn-install" onclick="install('${l.type}')">安装</button>
        </div>`).join('');
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 30px;
            line-height: 1.6;
        }
        .container { max-width: 700px; margin: 0 auto; }
        h1 { font-size: 1.5em; margin-bottom: 10px; }
        .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 25px; }
        
        .section {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }
        .section-title { font-size: 1.1em; font-weight: 600; margin-bottom: 15px; }
        
        .server-info {
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 15px;
            background: var(--vscode-editor-background);
            border-radius: 6px;
            margin-bottom: 15px;
        }
        .server-url {
            flex: 1;
            font-family: monospace;
            font-size: 1.1em;
            color: var(--vscode-textLink-foreground);
        }
        
        .location-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px;
            background: var(--vscode-editor-background);
            border-radius: 4px;
            margin-bottom: 8px;
        }
        .location-item .name { font-weight: 500; min-width: 150px; }
        .location-item .path {
            flex: 1;
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
            word-break: break-all;
        }
        .mode-badge {
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.75em;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        
        button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
        }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-install { background: #4CAF50; color: white; }
        .btn-copy { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        
        .config-preview {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 15px;
            font-family: monospace;
            font-size: 0.9em;
            white-space: pre;
            overflow-x: auto;
        }
        
        .custom-path {
            display: flex;
            gap: 10px;
            margin-top: 15px;
        }
        .custom-path input {
            flex: 1;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
        }
        
        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 20px;
            background: #4CAF50;
            color: white;
            border-radius: 4px;
            opacity: 0;
            transition: opacity 0.3s;
        }
        .toast.error { background: #f44336; }
        .toast.show { opacity: 1; }

        .steps { margin-top: 15px; }
        .step {
            display: flex;
            gap: 10px;
            margin-bottom: 10px;
        }
        .step-num {
            width: 24px;
            height: 24px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.8em;
            font-weight: bold;
        }
        
        .mode-selector {
            display: flex;
            gap: 15px;
            margin-top: 10px;
        }
        .mode-option {
            flex: 1;
            cursor: pointer;
        }
        .mode-option input {
            display: none;
        }
        .mode-card {
            padding: 15px;
            border: 2px solid var(--vscode-input-border);
            border-radius: 8px;
            background: var(--vscode-editor-background);
            transition: all 0.2s;
        }
        .mode-option input:checked + .mode-card {
            border-color: var(--vscode-button-background);
            background: var(--vscode-editor-inactiveSelectionBackground);
        }
        .mode-card:hover {
            border-color: var(--vscode-focusBorder);
        }
        .mode-title {
            font-weight: 600;
            margin-bottom: 5px;
        }
        .mode-desc {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔧 MCP 服务配置向导</h1>
        <p class="subtitle">将 Ask Continue MCP 服务添加到您的 AI 工具中</p>
        
        <div class="section">
            <div class="section-title">⚙️ 连接模式选择</div>
            <div class="mode-selector">
                <label class="mode-option">
                    <input type="radio" name="mcpMode" value="stdio" checked onchange="updateMode()">
                    <div class="mode-card">
                        <div class="mode-title">📦 stdio 模式 (推荐)</div>
                        <div class="mode-desc">需要 Node.js 环境，更稳定可靠</div>
                    </div>
                </label>
                <label class="mode-option">
                    <input type="radio" name="mcpMode" value="http" onchange="updateMode()">
                    <div class="mode-card">
                        <div class="mode-title">🌐 HTTP 模式</div>
                        <div class="mode-desc">无需 Node.js，但需保持服务器运行</div>
                    </div>
                </label>
            </div>
            <div id="httpServerInfo" style="display: none; margin-top: 15px;">
                <div class="server-info">
                    <span>服务器地址:</span>
                    <span class="server-url">${mcpUrl}</span>
                    <button class="btn-primary" onclick="startServer()">启动服务器</button>
                </div>
                <p style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">
                    ⚠️ HTTP 模式需要确保 MCP 服务器正在运行
                </p>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">🎯 自动配置</div>
            <p style="margin-bottom: 15px; color: var(--vscode-descriptionForeground);">
                选择要配置的 AI 工具，点击"安装"自动添加 MCP 配置
            </p>
            ${locationItems}
            
            <div class="custom-path">
                <input type="text" id="customPath" placeholder="自定义配置文件路径...">
                <button class="btn-install" onclick="installCustom()">安装到自定义路径</button>
            </div>
        </div>
        
        <div class="section">
            <div class="section-title">📋 手动配置</div>
            <p style="margin-bottom: 10px;">复制以下配置到您的 AI 工具的 MCP 配置文件中:</p>
            <div class="config-preview" id="configPreview">{
  "mcpServers": {
    "ask_continue": {
      "url": "${mcpUrl}"
    }
  }
}</div>
            <div style="margin-top: 10px;">
                <button class="btn-copy" onclick="copyConfig()">📋 复制配置</button>
            </div>
        </div>

        <div class="section">
            <div class="section-title">📖 配置步骤</div>
            <div class="steps">
                <div class="step">
                    <span class="step-num">1</span>
                    <span>点击上方"启动服务器"确保 MCP 服务运行</span>
                </div>
                <div class="step">
                    <span class="step-num">2</span>
                    <span>选择自动配置或手动复制配置到 AI 工具</span>
                </div>
                <div class="step">
                    <span class="step-num">3</span>
                    <span>重启 Windsurf</span>
                </div>
                <div class="step">
                    <span class="step-num">4</span>
                    <span>在 AI 对话中，AI 会自动调用 ask_continue 工具</span>
                </div>
            </div>
        </div>
    </div>
    
    <div class="toast" id="toast"></div>
    
    <script>
        const vscode = acquireVsCodeApi();
        const mcpUrl = '${mcpUrl}';
        
        // stdio 模式的配置预览（占位符，实际值由后端生成）
        const stdioConfig = {
            mcpServers: {
                ask_continue: {
                    command: "node",
                    args: ["<扩展路径>/mcp-server.js"]
                }
            }
        };
        
        const httpConfig = {
            mcpServers: {
                ask_continue: {
                    url: mcpUrl
                }
            }
        };
        
        function getSelectedMode() {
            return document.querySelector('input[name="mcpMode"]:checked').value;
        }
        
        function updateMode() {
            const mode = getSelectedMode();
            const httpInfo = document.getElementById('httpServerInfo');
            const preview = document.getElementById('configPreview');
            
            if (mode === 'http') {
                httpInfo.style.display = 'block';
                preview.textContent = JSON.stringify(httpConfig, null, 2);
            } else {
                httpInfo.style.display = 'none';
                preview.textContent = JSON.stringify(stdioConfig, null, 2);
            }
        }
        
        function install(type) {
            const mode = getSelectedMode();
            vscode.postMessage({ type: 'install', target: type, mode: mode });
        }
        
        function installCustom() {
            const path = document.getElementById('customPath').value;
            if (path) {
                const mode = getSelectedMode();
                vscode.postMessage({ type: 'install', target: 'custom', customPath: path, mode: mode });
            }
        }
        
        function copyConfig() {
            const mode = getSelectedMode();
            vscode.postMessage({ type: 'copy', mode: mode });
        }
        
        function startServer() {
            vscode.postMessage({ type: 'startServer' });
        }
        
        function showToast(msg, isError) {
            const toast = document.getElementById('toast');
            toast.textContent = msg;
            toast.className = 'toast show' + (isError ? ' error' : '');
            setTimeout(() => toast.className = 'toast', 3000);
        }
        
        window.addEventListener('message', e => {
            const m = e.data;
            if (m.type === 'success') showToast(m.message, false);
            else if (m.type === 'error') showToast(m.message, true);
            else if (m.type === 'serverStarted') showToast('服务器已启动', false);
        });
        
        // 初始化时更新配置预览
        updateMode();
    </script>
</body>
</html>`;
}
async function createRulesFromSettings(ruleType) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('请先打开一个工作区');
        return;
    }
    const rootPath = workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration('askContinue');
    const port = config.get('mcpPort') || 3456;
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    try {
        // 只创建 Windsurf 规则文件
        if (ruleType === 'windsurf' || ruleType === 'all') {
            await writeFile(path.join(rootPath, '.windsurfrules'), RULE_TEMPLATE.replace('3456', String(port)));
        }
        if (ruleType === 'mcp' || ruleType === 'all') {
            // 写入 Windsurf 全局 MCP 配置
            const mcpServerScript = path.join(extensionContext.extensionPath, 'mcp-server.js');
            const nodeResult = getNodePath();
            const mcpConfig = {
                mcpServers: {
                    ask_continue: {
                        command: nodeResult.path,
                        args: [mcpServerScript]
                    }
                }
            };
            const windsurfDir = path.join(homeDir, '.codeium', 'windsurf');
            if (!fs.existsSync(windsurfDir)) {
                fs.mkdirSync(windsurfDir, { recursive: true });
            }
            await writeFile(path.join(windsurfDir, 'mcp_config.json'), JSON.stringify(mcpConfig, null, 2));
        }
        outputChannel.appendLine('规则文件创建成功');
    }
    catch (error) {
        vscode.window.showErrorMessage(`创建失败: ${error}`);
    }
}
function createRulesFileWebview(context) {
    showSettingsPanel(context);
}
// ==================== 侧边栏 Provider ====================
class SidebarProvider {
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        this._updateContent();
        // 监听可见性变化，切换回来时刷新状态
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                outputChannel.appendLine(`侧边栏变为可见，刷新状态: mcpServer=${mcpServer ? '存在' : '空'}`);
                this._updateContent();
            }
        });
        webviewView.webview.onDidReceiveMessage(async (message) => {
            const config = vscode.workspace.getConfiguration('askContinue');
            switch (message.type) {
                case 'activate':
                    if (message.activationCode) {
                        const result = await activatePlugin(message.activationCode);
                        this._view?.webview.postMessage({ type: 'activationResult', success: result.success, message: result.message });
                        if (result.success) {
                            this._updateContent();
                        }
                    }
                    break;
                case 'deactivate':
                    await deactivatePlugin();
                    this._updateContent();
                    break;
                case 'toggleServer':
                    await toggleMCPServer(extensionContext);
                    break;
                case 'saveSettings':
                    if (message.port !== undefined) {
                        await updatePortConfig(message.port);
                    }
                    if (message.autoStart !== undefined) {
                        await config.update('autoStart', message.autoStart, vscode.ConfigurationTarget.Global);
                    }
                    // 保存后重启服务器到新端口
                    if (message.port !== undefined) {
                        if (mcpServer) {
                            stopMCPServer();
                        }
                        await startMCPServer(extensionContext);
                    }
                    this._view?.webview.postMessage({ type: 'settingsSaved' });
                    updateStatusBar();
                    break;
                case 'createRules':
                    await createRulesFromSettings(message.ruleType || 'both');
                    this._view?.webview.postMessage({ type: 'rulesCreated' });
                    break;
                case 'testDialog':
                    showAskContinueWebview(extensionContext, '测试对话框');
                    break;
                case 'openFullSettings':
                    showSettingsPanel(extensionContext);
                    break;
                case 'installMCP':
                    installMCPConfig(extensionContext);
                    break;
                case 'autoSelectPort':
                    const newPort = await findAvailablePort();
                    if (newPort) {
                        await updatePortConfig(newPort);
                        // 重启服务器
                        if (mcpServer) {
                            stopMCPServer();
                        }
                        await startMCPServer(extensionContext);
                        this._view?.webview.postMessage({ type: 'portSelected', port: newPort });
                        updateStatusBar();
                    }
                    break;
                case 'resetConfig':
                    await this._handleResetConfig(message.mode || 'http');
                    break;
                case 'savePopupMode':
                    if (message.popupMode) {
                        await config.update('popupMode', message.popupMode, vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage(`弹窗模式已切换为: ${message.popupMode === 'direct' ? '直接弹出' : '隐藏到状态栏'}`);
                    }
                    break;
            }
        });
    }
    _updateContent() {
        if (!this._view)
            return;
        const activationInfo = getActivationInfo();
        if (activationInfo.isActivated) {
            this._view.webview.html = this._getControlPanelHtml(activationInfo);
        }
        else {
            this._view.webview.html = this._getActivationHtml();
        }
    }
    refreshView() {
        this._updateContent();
    }
    updateServerStatus(running, port) {
        this._view?.webview.postMessage({ type: 'serverStatus', running, port });
    }
    /**
     * 处理重新配置（一键修复）
     * 1. 删除旧的MCP配置和规则文件
     * 2. 延迟2秒
     * 3. 重新设置MCP并创建规则文件
     */
    async _handleResetConfig(mode) {
        try {
            const homeDir = process.env.HOME || process.env.USERPROFILE || '';
            const windsurfConfigPath = path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json');
            // 步骤1: 删除旧的MCP配置中的ask_continue
            this._view?.webview.postMessage({ type: 'resetProgress', status: '正在删除MCP配置...' });
            try {
                if (fs.existsSync(windsurfConfigPath)) {
                    const configContent = fs.readFileSync(windsurfConfigPath, 'utf-8');
                    const config = JSON.parse(configContent);
                    if (config.mcpServers && config.mcpServers.ask_continue) {
                        delete config.mcpServers.ask_continue;
                        fs.writeFileSync(windsurfConfigPath, JSON.stringify(config, null, 2), 'utf-8');
                        outputChannel.appendLine('已删除MCP配置中的ask_continue');
                    }
                }
            }
            catch (e) {
                outputChannel.appendLine(`删除MCP配置失败: ${e}`);
            }
            // 步骤2: 删除当前工作区的规则文件
            this._view?.webview.postMessage({ type: 'resetProgress', status: '正在删除规则文件...' });
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                const ruleFiles = [
                    path.join(workspaceRoot, '.windsurfrules'),
                    path.join(workspaceRoot, '.cursorrules'),
                    path.join(workspaceRoot, '.github', 'copilot-instructions.md')
                ];
                for (const ruleFile of ruleFiles) {
                    try {
                        if (fs.existsSync(ruleFile)) {
                            fs.unlinkSync(ruleFile);
                            outputChannel.appendLine(`已删除规则文件: ${ruleFile}`);
                        }
                    }
                    catch (e) {
                        outputChannel.appendLine(`删除规则文件失败: ${ruleFile}, ${e}`);
                    }
                }
            }
            // 步骤3: 延迟2秒
            this._view?.webview.postMessage({ type: 'resetProgress', status: '等待2秒...' });
            await new Promise(resolve => setTimeout(resolve, 2000));
            // 步骤4: 重新设置MCP配置
            this._view?.webview.postMessage({ type: 'resetProgress', status: '正在重新配置MCP...' });
            try {
                await writeMCPConfig(windsurfConfigPath, currentPort, mode, extensionContext.extensionPath);
                outputChannel.appendLine(`已重新配置MCP (${mode}模式)`);
            }
            catch (e) {
                outputChannel.appendLine(`重新配置MCP失败: ${e}`);
            }
            // 步骤5: 创建规则文件
            this._view?.webview.postMessage({ type: 'resetProgress', status: '正在创建规则文件...' });
            await createRulesFromSettings('windsurf');
            // 完成
            this._view?.webview.postMessage({ type: 'resetComplete', success: true });
            vscode.window.showInformationMessage(`重新配置完成 (${mode}模式)！已重新加载所有配置。`);
        }
        catch (e) {
            outputChannel.appendLine(`重新配置失败: ${e}`);
            this._view?.webview.postMessage({ type: 'resetComplete', success: false, error: e.message });
        }
    }
    _getActivationHtml() {
        const config = vscode.workspace.getConfiguration('askContinue');
        const authorName = config.get('authorName') || '三千-qs';
        const authorContact = config.get('authorContact') || '2095028343';
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            padding: 15px;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            text-align: center;
            margin-bottom: 20px;
            padding: 20px 10px;
            background: linear-gradient(135deg, var(--vscode-editor-inactiveSelectionBackground), var(--vscode-editor-background));
            border-radius: 8px;
        }
        .logo { font-size: 3em; margin-bottom: 10px; }
        h2 { font-size: 1.2em; margin-bottom: 5px; color: var(--vscode-textLink-foreground); }
        .subtitle { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
        
        .activation-form {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        .form-group { margin-bottom: 15px; }
        .form-group label {
            display: block;
            font-size: 0.85em;
            margin-bottom: 6px;
            font-weight: 500;
        }
        input[type="text"] {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 1em;
            font-family: monospace;
            letter-spacing: 1px;
            text-transform: uppercase;
        }
        input[type="text"]:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
        }
        input[type="text"]::placeholder {
            text-transform: none;
            letter-spacing: normal;
        }
        
        button {
            width: 100%;
            padding: 12px 20px;
            border: none;
            border-radius: 4px;
            font-size: 1em;
            cursor: pointer;
            transition: all 0.2s;
            font-weight: 500;
        }
        button:hover { opacity: 0.9; transform: translateY(-1px); }
        .btn-primary {
            background: linear-gradient(135deg, #4CAF50, #45a049);
            color: white;
            box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
        }
        
        .message {
            margin-top: 10px;
            padding: 10px 12px;
            border-radius: 4px;
            font-size: 0.9em;
            display: none;
        }
        .message.success {
            background: rgba(76, 175, 80, 0.15);
            border: 1px solid #4CAF50;
            color: #4CAF50;
        }
        .message.error {
            background: rgba(244, 67, 54, 0.15);
            border: 1px solid #f44336;
            color: #f44336;
        }
        .message.show { display: block; }
        
        .info-section {
            margin-top: auto;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-input-border);
        }
        .info-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 0;
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
        }
        .info-icon { font-size: 1.1em; }
        
        .help-text {
            margin-top: 15px;
            padding: 12px;
            background: var(--vscode-inputValidation-infoBackground);
            border-radius: 4px;
            border-left: 3px solid var(--vscode-textLink-foreground);
            font-size: 0.85em;
            line-height: 1.5;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">🔐</div>
        <h2>AC Server - 牛马工具</h2>
        <div class="subtitle">请输入激活码以解锁完整功能</div>
    </div>
    
    <div class="activation-form">
        <div class="form-group">
            <label for="activationCode">激活码</label>
            <input type="text" id="activationCode" placeholder="XXXX-XXXX-XXXX-XXXX" maxlength="19" autocomplete="off">
        </div>
        
        <button class="btn-primary" onclick="activate()">🚀 激活</button>
        
        <div class="message" id="message"></div>
        
        <div class="help-text">
            <strong>💡 如何获取激活码？</strong><br>
            请联系作者获取激活码，激活后可使用所有功能。
        </div>
    </div>
    
    <div class="info-section">
        <div class="info-item">
            <span class="info-icon">👤</span>
            <span>作者：${authorName}</span>
        </div>
        <div class="info-item">
            <span class="info-icon">💬</span>
            <span>QQ交流群：${authorContact}</span>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        // 格式化激活码输入
        document.getElementById('activationCode').addEventListener('input', function(e) {
            let value = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
            if (value.length > 16) value = value.slice(0, 16);
            
            // 自动添加连字符
            let formatted = '';
            for (let i = 0; i < value.length; i++) {
                if (i > 0 && i % 4 === 0) formatted += '-';
                formatted += value[i];
            }
            e.target.value = formatted;
        });
        
        let isActivating = false;  // 防抖标志
        
        function activate() {
            // 防止重复点击
            if (isActivating) {
                return;
            }
            
            const code = document.getElementById('activationCode').value;
            if (!code || code.replace(/-/g, '').length !== 16) {
                showMessage('请输入完整的激活码 (16位)', false);
                return;
            }
            
            // 设置激活中状态
            isActivating = true;
            const btn = document.querySelector('.btn-primary');
            btn.disabled = true;
            btn.textContent = '⏳ 激活中...';
            btn.style.opacity = '0.7';
            
            vscode.postMessage({ type: 'activate', activationCode: code });
        }
        
        function showMessage(text, success) {
            const msg = document.getElementById('message');
            msg.textContent = text;
            msg.className = 'message show ' + (success ? 'success' : 'error');
        }
        
        function resetButton() {
            isActivating = false;
            const btn = document.querySelector('.btn-primary');
            btn.disabled = false;
            btn.textContent = '🚀 激活';
            btn.style.opacity = '1';
        }
        
        // 回车键激活
        document.getElementById('activationCode').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') activate();
        });
        
        // 接收消息
        window.addEventListener('message', e => {
            const m = e.data;
            if (m.type === 'activationResult') {
                showMessage(m.message, m.success);
                resetButton();  // 恢复按钮状态
            }
        });
    </script>
</body>
</html>`;
    }
    _getControlPanelHtml(activationInfo) {
        const config = vscode.workspace.getConfiguration('askContinue');
        const serverRunning = mcpServer !== null;
        const port = currentPort;
        const autoStart = config.get('autoStart') || true;
        const version = '1.8.0';
        const popupMode = config.get('popupMode') || 'direct';
        const authorName = config.get('authorName') || '三千-qs';
        const authorContact = config.get('authorContact') || '2095028343';
        const description = config.get('description') || '榨干你的每一点积分';
        // 激活信息
        const expiresAt = activationInfo.expiresAt ? new Date(activationInfo.expiresAt).toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        }) : '未知';
        // 计算剩余时间（精确到分钟）
        const msLeft = activationInfo.expiresAt ? activationInfo.expiresAt - Date.now() : 0;
        const totalMinutesLeft = Math.max(0, Math.floor(msLeft / 60000));
        const daysLeft = Math.floor(totalMinutesLeft / 1440);
        const hoursLeft = Math.floor((totalMinutesLeft % 1440) / 60);
        const minutesLeft = totalMinutesLeft % 60;
        const timeLeftStr = daysLeft > 0
            ? `${daysLeft}天 ${hoursLeft}小时 ${minutesLeft}分钟`
            : hoursLeft > 0
                ? `${hoursLeft}小时 ${minutesLeft}分钟`
                : `${minutesLeft}分钟`;
        const isExpiringSoon = daysLeft <= 7 && msLeft > 0;
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            padding: 10px;
        }
        h3 { font-size: 1em; margin-bottom: 10px; }
        .section { margin-bottom: 15px; }
        .server-status {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
            margin-bottom: 10px;
        }
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }
        .status-dot.running { background: #4CAF50; }
        .status-dot.stopped { background: #f44336; }
        .status-text { flex: 1; font-size: 0.9em; }
        .form-group { margin-bottom: 10px; }
        .form-group label { display: block; font-size: 0.85em; margin-bottom: 4px; color: var(--vscode-descriptionForeground); }
        input[type="number"], input[type="text"] {
            width: 100%;
            padding: 5px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-size: 0.9em;
        }
        .checkbox-group { display: flex; align-items: center; gap: 6px; }
        .checkbox-group input { width: 14px; height: 14px; }
        button {
            width: 100%;
            padding: 6px 10px;
            border: none;
            border-radius: 3px;
            font-size: 0.85em;
            cursor: pointer;
            margin-bottom: 5px;
        }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-success { background: #4CAF50; color: white; }
        .btn-danger { background: #f44336; color: white; }
        .btn-row { display: flex; gap: 5px; }
        .btn-row button { flex: 1; }
        select {
            width: 100%;
            padding: 5px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            margin-bottom: 8px;
        }
        .toast {
            position: fixed; bottom: 10px; left: 10px; right: 10px;
            padding: 8px; background: #4CAF50; color: white;
            border-radius: 3px; text-align: center; font-size: 0.85em;
            opacity: 0; transition: opacity 0.3s;
        }
        .toast.show { opacity: 1; }
    </style>
</head>
<body>
    <div class="section">
        <h3>🖥️ MCP AC-Server 服务器</h3>
        <div class="server-status">
            <div class="status-dot ${serverRunning ? 'running' : 'stopped'}" id="dot"></div>
            <span class="status-text" id="status">${serverRunning ? `运行中 :${port}` : '已停止'}</span>
        </div>
        <button class="${serverRunning ? 'btn-danger' : 'btn-success'}" id="toggleBtn" onclick="toggleServer()" style="width: 100%;">
            ${serverRunning ? '⏹ 停止服务' : '▶ 启动服务'}
        </button>
    </div>

    <div class="section">
        <h3>⚙️ 设置</h3>
        <div class="form-group">
            <label>端口</label>
            <div style="display: flex; gap: 5px;">
                <input type="number" id="port" value="${port}" min="1024" max="65535" style="flex: 1;">
                <button class="btn-secondary" onclick="autoSelectPort()" style="width: auto; margin: 0; padding: 5px 10px;" title="自动选择未被占用的端口">🔄</button>
            </div>
        </div>
        <div class="form-group">
            <label>弹窗模式</label>
            <select id="popupMode" onchange="savePopupMode()">
                <option value="direct" ${popupMode === 'direct' ? 'selected' : ''}>直接弹出</option>
                <option value="hidden" ${popupMode === 'hidden' ? 'selected' : ''}>隐藏到状态栏</option>
            </select>
        </div>
        <div class="form-group">
            <div class="checkbox-group">
                <input type="checkbox" id="autoStart" ${autoStart ? 'checked' : ''}>
                <label>自动启动</label>
            </div>
        </div>
        <button class="btn-primary" onclick="saveSettings()">💾 保存并重启</button>
    </div>

    <div class="section">
        <h3>📝 规则文件</h3>
        <select id="ruleType">
            <option value="windsurf">Windsurf 规则</option>
            <option value="mcp">MCP 配置</option>
            <option value="all">全部创建</option>
        </select>
        <button class="btn-secondary" onclick="createRules()">创建规则</button>
    </div>

    <div class="section">
        <button class="btn-secondary" onclick="testDialog()">🧪 测试对话框</button>
        <button class="btn-secondary" onclick="openFull()">📋 完整设置</button>
        <button class="btn-primary" onclick="installMCP()">🔧 配置 MCP</button>
    </div>

    <div class="section">
        <h3>🔄 一键配置（一键修复）</h3>
        <p style="font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-bottom: 10px;">删除旧配置和规则，重新设置MCP并创建规则文件</p>
        <div class="btn-row">
            <button class="btn-primary" onclick="resetConfig('http')" id="resetHttpBtn">HTTP模式</button>
            <button class="btn-secondary" onclick="resetConfig('stdio')" id="resetStdioBtn">STDIO模式</button>
        </div>
        <div id="resetProgress" style="display: none; margin-top: 10px; padding: 8px; background: var(--vscode-editor-background); border-radius: 4px; font-size: 0.85em;">
            <span id="resetStatus">正在重新配置...</span>
        </div>
    </div>

    <div class="section" style="margin-top: 15px; padding: 12px; background: linear-gradient(135deg, rgba(76,175,80,0.1), rgba(76,175,80,0.05)); border-radius: 6px; border: 1px solid rgba(76,175,80,0.3);">
        <h3 style="color: #4CAF50;">✅ 本地版本</h3>
        <div style="font-size: 0.85em; margin-top: 8px; line-height: 1.6;">
            <p>无需激活，永久免费使用</p>
        </div>
    </div>

    <div class="section" style="margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--vscode-input-border);">
        <h3>👤 关于</h3>
        <div style="font-size: 0.85em; color: var(--vscode-descriptionForeground); line-height: 1.5;">
            <p style="margin-bottom: 8px; font-style: italic;">${description}</p>
            <p style="margin-bottom: 8px; padding: 8px; background: var(--vscode-inputValidation-warningBackground); border-radius: 3px; border-left: 3px solid #f0ad4e;">
                💡 <strong>提示：</strong>若AI调用MCP时未弹出窗口，或一直显示"结束对话"，请点击上方 🔄 按钮刷新端口
            </p>
            <p style="margin-bottom: 8px; padding: 8px; background: var(--vscode-inputValidation-infoBackground); border-radius: 3px; border-left: 3px solid #17a2b8;">
                📦 <strong>若使用stdio模式MCP报错？</strong>需安装 <a href="https://nodejs.org/" style="color: var(--vscode-textLink-foreground);">Node.js</a>：下载LTS版本，安装时勾选"Add to PATH"，完成后重启Windsurf。<br>若默认HTTP模式不能正常使用，请在"配置MCP"中选择stdio模式安装。
            </p>
            <p>版本：v${version}</p>
            <p>作者：${authorName}</p>
            <p>QQ交流群：${authorContact}</p>
        </div>
    </div>

    <div class="toast" id="toast"></div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function toggleServer() { vscode.postMessage({ type: 'toggleServer' }); }
        function saveSettings() {
            vscode.postMessage({
                type: 'saveSettings',
                port: parseInt(document.getElementById('port').value),
                autoStart: document.getElementById('autoStart').checked
            });
        }
        function autoSelectPort() { vscode.postMessage({ type: 'autoSelectPort' }); }
        function createRules() { vscode.postMessage({ type: 'createRules', ruleType: document.getElementById('ruleType').value }); }
        function testDialog() { vscode.postMessage({ type: 'testDialog' }); }
        function openFull() { vscode.postMessage({ type: 'openFullSettings' }); }
        function installMCP() { vscode.postMessage({ type: 'installMCP' }); }
        function savePopupMode() {
            const mode = document.getElementById('popupMode').value;
            vscode.postMessage({ type: 'savePopupMode', popupMode: mode });
        }
        
        function resetConfig(mode) {
            document.getElementById('resetHttpBtn').disabled = true;
            document.getElementById('resetStdioBtn').disabled = true;
            document.getElementById('resetProgress').style.display = 'block';
            document.getElementById('resetStatus').textContent = '正在删除旧配置...';
            vscode.postMessage({ type: 'resetConfig', mode: mode });
        }
        
        function showToast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 2000);
        }
        
        function updateStatus(running, port) {
            document.getElementById('dot').className = 'status-dot ' + (running ? 'running' : 'stopped');
            document.getElementById('status').textContent = running ? '运行中 :' + port : '已停止';
            const btn = document.getElementById('toggleBtn');
            btn.className = running ? 'btn-danger' : 'btn-success';
            btn.textContent = running ? '⏹ 停止服务' : '▶ 启动服务';
        }
        
        window.addEventListener('message', e => {
            const m = e.data;
            if (m.type === 'serverStatus') {
                updateStatus(m.running, m.port);
                document.getElementById('port').value = m.port;
            }
            else if (m.type === 'settingsSaved') showToast('设置已保存，服务已重启');
            else if (m.type === 'rulesCreated') showToast('规则已创建');
            else if (m.type === 'portSelected') {
                document.getElementById('port').value = m.port;
                showToast('已选择端口 ' + m.port);
            }
            else if (m.type === 'resetProgress') {
                document.getElementById('resetStatus').textContent = m.status;
            }
            else if (m.type === 'resetComplete') {
                document.getElementById('resetHttpBtn').disabled = false;
                document.getElementById('resetStdioBtn').disabled = false;
                document.getElementById('resetProgress').style.display = 'none';
                showToast(m.success ? '重新配置完成！' : '配置失败: ' + m.error);
            }
        });
    </script>
</body>
</html>`;
    }
}
function updateSidebarStatus() {
    sidebarProvider?.updateServerStatus(mcpServer !== null, currentPort);
}
function getSettingsWebviewContent(serverRunning, port, autoStart, defaultReason) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ask Continue 设置</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 30px;
            line-height: 1.6;
        }
        .container { max-width: 600px; margin: 0 auto; }
        h1 { font-size: 1.6em; margin-bottom: 10px; display: flex; align-items: center; gap: 10px; }
        .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 25px; }
        
        .section {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }
        .section-title {
            font-size: 1.1em;
            font-weight: 600;
            margin-bottom: 15px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .server-status {
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 15px;
            background: var(--vscode-editor-background);
            border-radius: 6px;
            margin-bottom: 15px;
        }
        .status-indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        .status-indicator.running { background: #4CAF50; }
        .status-indicator.stopped { background: #f44336; animation: none; }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .status-text { flex: 1; }
        .status-text .label { font-weight: 500; }
        .status-text .url { font-size: 0.85em; color: var(--vscode-textLink-foreground); }
        
        .form-group { margin-bottom: 15px; }
        .form-group label {
            display: block;
            margin-bottom: 6px;
            font-weight: 500;
        }
        .form-group input[type="text"],
        .form-group input[type="number"] {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 0.95em;
        }
        .form-group input:focus { outline: 1px solid var(--vscode-focusBorder); }
        .form-group .hint { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-top: 4px; }
        
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .checkbox-group input[type="checkbox"] {
            width: 18px;
            height: 18px;
            cursor: pointer;
        }
        
        .btn-row { display: flex; gap: 10px; flex-wrap: wrap; }
        button {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            font-size: 0.95em;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        button:hover { opacity: 0.9; }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-success { background: #4CAF50; color: white; }
        .btn-danger { background: #f44336; color: white; }
        .btn-wide { flex: 1; justify-content: center; }
        
        .rule-options { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 15px; }
        .rule-option {
            padding: 8px 15px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .rule-option:hover { border-color: var(--vscode-focusBorder); }
        .rule-option.selected {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }
        
        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 20px;
            background: #4CAF50;
            color: white;
            border-radius: 4px;
            opacity: 0;
            transition: opacity 0.3s;
            pointer-events: none;
        }
        .toast.show { opacity: 1; }
    </style>
</head>
<body>
    <div class="container">
        <h1>⚙️ Ask Continue 设置</h1>
        <p class="subtitle">配置 MCP 服务器和对话规则</p>
        
        <!-- 服务器状态 -->
        <div class="section">
            <div class="section-title">🖥️ MCP 服务器</div>
            <div class="server-status">
                <div class="status-indicator ${serverRunning ? 'running' : 'stopped'}" id="statusIndicator"></div>
                <div class="status-text">
                    <div class="label" id="statusLabel">${serverRunning ? '运行中' : '已停止'}</div>
                    <div class="url" id="statusUrl">${serverRunning ? `http://localhost:${port}` : '点击启动服务器'}</div>
                </div>
                <button class="${serverRunning ? 'btn-danger' : 'btn-success'}" id="toggleBtn" onclick="toggleServer()">
                    ${serverRunning ? '⏹ 停止' : '▶ 启动'}
                </button>
            </div>
            
            <div class="form-group">
                <label for="port">服务器端口</label>
                <input type="number" id="port" value="${port}" min="1024" max="65535">
                <div class="hint">修改端口后需重启服务器生效</div>
            </div>
            
            <div class="btn-row">
                <button class="btn-secondary" onclick="restartServer()">🔄 重启服务器</button>
            </div>
        </div>
        
        <!-- 通用设置 -->
        <div class="section">
            <div class="section-title">⚡ 通用设置</div>
            
            <div class="form-group">
                <div class="checkbox-group">
                    <input type="checkbox" id="autoStart" ${autoStart ? 'checked' : ''}>
                    <label for="autoStart">启动时自动运行 MCP 服务器</label>
                </div>
            </div>
            
            <div class="form-group">
                <label for="defaultReason">默认结束原因</label>
                <input type="text" id="defaultReason" value="${escapeHtml(defaultReason)}">
            </div>
            
            <div class="btn-row">
                <button class="btn-primary btn-wide" onclick="saveSettings()">💾 保存设置</button>
                <button class="btn-secondary" onclick="testDialog()">🧪 测试对话框</button>
            </div>
        </div>
        
        <!-- 规则文件 -->
        <div class="section">
            <div class="section-title">📝 规则文件</div>
            <p style="margin-bottom: 15px; color: var(--vscode-descriptionForeground);">
                在当前工作区创建 AI 规则文件，让 AI 自动调用 ask_continue 工具
            </p>
            
            <div class="rule-options">
                <div class="rule-option selected" data-value="windsurf" onclick="selectRuleType(this)">Windsurf 规则</div>
                <div class="rule-option" data-value="mcp" onclick="selectRuleType(this)">MCP 配置</div>
                <div class="rule-option" data-value="all" onclick="selectRuleType(this)">全部创建</div>
            </div>
            
            <button class="btn-primary btn-wide" onclick="createRules()">📄 创建规则文件</button>
        </div>
    </div>
    
    <div class="toast" id="toast">设置已保存</div>
    
    <script>
        const vscode = acquireVsCodeApi();
        let selectedRuleType = 'windsurf';
        
        function toggleServer() {
            vscode.postMessage({ type: 'toggleServer' });
        }
        
        function restartServer() {
            const port = parseInt(document.getElementById('port').value);
            vscode.postMessage({ type: 'restartServer', port });
        }
        
        function saveSettings() {
            vscode.postMessage({
                type: 'saveSettings',
                port: parseInt(document.getElementById('port').value),
                autoStart: document.getElementById('autoStart').checked,
                defaultReason: document.getElementById('defaultReason').value
            });
        }
        
        function testDialog() {
            vscode.postMessage({
                type: 'testDialog',
                defaultReason: document.getElementById('defaultReason').value
            });
        }
        
        function selectRuleType(el) {
            document.querySelectorAll('.rule-option').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
            selectedRuleType = el.dataset.value;
        }
        
        function createRules() {
            vscode.postMessage({ type: 'createRules', ruleType: selectedRuleType });
        }
        
        function showToast(message) {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2000);
        }
        
        function updateServerStatus(running, port) {
            const indicator = document.getElementById('statusIndicator');
            const label = document.getElementById('statusLabel');
            const url = document.getElementById('statusUrl');
            const btn = document.getElementById('toggleBtn');
            
            indicator.className = 'status-indicator ' + (running ? 'running' : 'stopped');
            label.textContent = running ? '运行中' : '已停止';
            url.textContent = running ? 'http://localhost:' + port : '点击启动服务器';
            btn.className = running ? 'btn-danger' : 'btn-success';
            btn.innerHTML = running ? '⏹ 停止' : '▶ 启动';
        }
        
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'serverStatus':
                    updateServerStatus(message.running, message.port);
                    break;
                case 'settingsSaved':
                    showToast('设置已保存');
                    break;
                case 'rulesCreated':
                    showToast('规则文件已创建');
                    break;
            }
        });
    </script>
</body>
</html>`;
}
//# sourceMappingURL=extension.js.map