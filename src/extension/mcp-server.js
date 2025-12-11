#!/usr/bin/env node
/**
 * Ask Continue MCP Server (stdio mode)
 * 
 * 这是一个 stdio 模式的 MCP 服务器，用于与 Windsurf/Cursor/Claude 等 AI 工具集成
 * 通过 HTTP 与 VSCode 扩展通信来显示对话框
 */

const readline = require('readline');
const http = require('http');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 动态读取端口配置
// 支持传入工作区路径来实现工作区隔离
function getExtensionPort(workspacePath) {
    // 1. 如果提供了工作区路径，从该路径向上查找端口文件
    if (workspacePath) {
        let searchPath = workspacePath;
        // 如果是文件路径，取目录
        try {
            if (fs.existsSync(searchPath) && fs.statSync(searchPath).isFile()) {
                searchPath = path.dirname(searchPath);
            }
        } catch (e) {}
        
        // 向上查找 .ask_continue_port 文件
        let currentDir = searchPath;
        while (currentDir && currentDir !== path.dirname(currentDir)) {
            const portFile = path.join(currentDir, '.ask_continue_port');
            try {
                if (fs.existsSync(portFile)) {
                    const content = fs.readFileSync(portFile, 'utf-8').trim();
                    const cleanContent = content.replace(/^\uFEFF/, '').replace(/[^\d]/g, '');
                    const port = parseInt(cleanContent);
                    if (port > 0 && port < 65536) {
                        process.stderr.write(`[ask_continue] 找到工作区端口: ${port} (${portFile})\n`);
                        return port;
                    }
                }
            } catch (e) {}
            currentDir = path.dirname(currentDir);
        }
    }
    
    // 2. 尝试当前工作目录
    const cwd = process.cwd();
    const cwdPortFile = path.join(cwd, '.ask_continue_port');
    try {
        if (fs.existsSync(cwdPortFile)) {
            const content = fs.readFileSync(cwdPortFile, 'utf-8').trim();
            const cleanContent = content.replace(/^\uFEFF/, '').replace(/[^\d]/g, '');
            const port = parseInt(cleanContent);
            if (port > 0 && port < 65536) {
                process.stderr.write(`[ask_continue] 使用 cwd 端口: ${port} (${cwdPortFile})\n`);
                return port;
            }
        }
    } catch (e) {}
    
    // 3. 回退到全局端口文件
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const globalConfigFile = path.join(homeDir, '.ask_continue_port');
    try {
        if (fs.existsSync(globalConfigFile)) {
            const content = fs.readFileSync(globalConfigFile, 'utf-8').trim();
            const cleanContent = content.replace(/^\uFEFF/, '').replace(/[^\d]/g, '');
            const port = parseInt(cleanContent);
            if (port > 0 && port < 65536) {
                process.stderr.write(`[ask_continue] 使用全局端口: ${port}\n`);
                return port;
            }
        }
    } catch (e) {}
    
    process.stderr.write(`[ask_continue] 使用默认端口: 3456\n`);
    return 3456;
}

// 服务器信息
const SERVER_INFO = {
    name: 'ask_continue',
    version: '1.0.0'
};

// 工具定义
const TOOLS = [{
    name: 'ask_continue',
    description: '当AI想要结束对话或任务时，必须调用此工具询问用户是否继续。用户可以选择继续并提供新指令，或选择结束对话。',
    inputSchema: {
        type: 'object',
        properties: {
            reason: {
                type: 'string',
                description: 'AI想要结束对话的原因，会显示给用户'
            },
            workspace: {
                type: 'string',
                description: '当前工作区或文件的路径，用于识别应该在哪个窗口显示对话框'
            }
        },
        required: ['reason']
    }
}];

// 创建 readline 接口
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

// 发送 JSON-RPC 响应
function sendResponse(id, result) {
    const response = {
        jsonrpc: '2.0',
        id,
        result
    };
    console.log(JSON.stringify(response));
}

// 发送 JSON-RPC 错误
function sendError(id, code, message) {
    const response = {
        jsonrpc: '2.0',
        id,
        error: { code, message }
    };
    console.log(JSON.stringify(response));
}

// 尝试连接单个端口
function tryConnectToPort(port, reason) {
    return new Promise((resolve) => {
        const postData = JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
                name: 'ask_continue',
                arguments: { reason }
            }
        });

        const options = {
            hostname: 'localhost',
            port: port,
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            // 不设置超时，等待用户响应
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(data);
                    const content = response.result?.content || [];
                    const text = content[0]?.text || '';
                    
                    // 解析响应
                    if (text.includes('should_continue=true') || text.includes('should_continue=True')) {
                        const instructionMatch = text.match(/用户指令: (.+?)(?:\n|$)/);
                        
                        // 提取图片内容（扩展返回的 Base64 图片）
                        const images = content.filter(c => c.type === 'image');
                        
                        resolve({
                            shouldContinue: true,
                            userInstruction: instructionMatch ? instructionMatch[1].trim() : null,
                            images: images.length > 0 ? images : null,
                            fullContent: content  // 保存完整的内容用于直接返回
                        });
                    } else {
                        resolve({
                            shouldContinue: false,
                            userInstruction: null,
                            images: null,
                            fullContent: content
                        });
                    }
                } catch (e) {
                    resolve(null);  // 解析失败，尝试下一个端口
                }
            });
        });

        req.on('error', () => {
            resolve(null);  // 连接失败，尝试下一个端口
        });

        req.write(postData);
        req.end();
    });
}

// 尝试通过 VSCode 扩展的 HTTP 服务器显示对话框
async function showDialogViaExtension(reason, workspace) {
    const port = getExtensionPort(workspace);  // 根据工作区获取端口
    process.stderr.write(`[ask_continue] 连接端口 ${port}, workspace: ${workspace || 'none'}\n`);
    return tryConnectToPort(port, reason);
}

// 检测操作系统
const isWindows = os.platform() === 'win32';
const isLinux = os.platform() === 'linux';
const isMac = os.platform() === 'darwin';

// 检查 Linux 上可用的对话框工具
function getLinuxDialogTool() {
    try {
        execSync('which zenity', { stdio: 'ignore' });
        return 'zenity';
    } catch (e) {}
    try {
        execSync('which kdialog', { stdio: 'ignore' });
        return 'kdialog';
    } catch (e) {}
    try {
        execSync('which yad', { stdio: 'ignore' });
        return 'yad';
    } catch (e) {}
    return null;
}

// 使用 zenity 显示对话框 (Linux)
async function showDialogZenity(reason) {
    return new Promise((resolve) => {
        const tempDir = os.tmpdir();
        const resultFile = path.join(tempDir, `ask_continue_result_${Date.now()}.txt`);
        
        // 转义特殊字符
        const escapedReason = reason.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
        
        // zenity 表单对话框
        const script = `
#!/bin/bash
result=$(zenity --forms --title="Ask Continue - 继续对话？" \\
    --text="AI想要结束对话的原因：\n${escapedReason}" \\
    --add-entry="如需继续，请输入新指令（可选）：" \\
    --ok-label="继续执行" \\
    --cancel-label="结束对话" \\
    --width=450 --height=200 2>/dev/null)

if [ $? -eq 0 ]; then
    echo "CONTINUE:::$result" > "${resultFile}"
else
    echo "END:::" > "${resultFile}"
fi
`;
        
        const scriptFile = path.join(tempDir, `ask_continue_${Date.now()}.sh`);
        fs.writeFileSync(scriptFile, script, { mode: 0o755 });
        
        const child = spawn('bash', [scriptFile], {
            stdio: 'ignore',
            detached: false
        });
        
        child.on('close', () => {
            try {
                fs.unlinkSync(scriptFile);
                if (fs.existsSync(resultFile)) {
                    const result = fs.readFileSync(resultFile, 'utf-8').trim();
                    fs.unlinkSync(resultFile);
                    
                    if (result.startsWith('CONTINUE:::')) {
                        const instruction = result.substring(11).trim();
                        resolve({
                            shouldContinue: true,
                            userInstruction: instruction || null,
                            imagePaths: null
                        });
                    } else {
                        resolve({ shouldContinue: false, userInstruction: null, imagePaths: null });
                    }
                } else {
                    resolve({ shouldContinue: false, userInstruction: null, imagePaths: null });
                }
            } catch (e) {
                resolve({ shouldContinue: false, userInstruction: null, imagePaths: null });
            }
        });
        
        child.on('error', () => {
            resolve({ shouldContinue: false, userInstruction: null, imagePaths: null });
        });
    });
}

// 使用 kdialog 显示对话框 (Linux KDE)
async function showDialogKdialog(reason) {
    return new Promise((resolve) => {
        const tempDir = os.tmpdir();
        const resultFile = path.join(tempDir, `ask_continue_result_${Date.now()}.txt`);
        
        const escapedReason = reason.replace(/"/g, '\\"').replace(/\$/g, '\\$');
        
        const script = `
#!/bin/bash
result=$(kdialog --title "Ask Continue - 继续对话？" \\
    --inputbox "AI想要结束对话的原因：\n${escapedReason}\n\n如需继续，请输入新指令（可选）：" "" \\
    --ok-label "继续执行" --cancel-label "结束对话" 2>/dev/null)

if [ $? -eq 0 ]; then
    echo "CONTINUE:::$result" > "${resultFile}"
else
    echo "END:::" > "${resultFile}"
fi
`;
        
        const scriptFile = path.join(tempDir, `ask_continue_${Date.now()}.sh`);
        fs.writeFileSync(scriptFile, script, { mode: 0o755 });
        
        const child = spawn('bash', [scriptFile], {
            stdio: 'ignore',
            detached: false
        });
        
        child.on('close', () => {
            try {
                fs.unlinkSync(scriptFile);
                if (fs.existsSync(resultFile)) {
                    const result = fs.readFileSync(resultFile, 'utf-8').trim();
                    fs.unlinkSync(resultFile);
                    
                    if (result.startsWith('CONTINUE:::')) {
                        const instruction = result.substring(11).trim();
                        resolve({
                            shouldContinue: true,
                            userInstruction: instruction || null,
                            imagePaths: null
                        });
                    } else {
                        resolve({ shouldContinue: false, userInstruction: null, imagePaths: null });
                    }
                } else {
                    resolve({ shouldContinue: false, userInstruction: null, imagePaths: null });
                }
            } catch (e) {
                resolve({ shouldContinue: false, userInstruction: null, imagePaths: null });
            }
        });
        
        child.on('error', () => {
            resolve({ shouldContinue: false, userInstruction: null, imagePaths: null });
        });
    });
}

// Linux 本地对话框
async function showDialogLocalLinux(reason) {
    const tool = getLinuxDialogTool();
    
    if (tool === 'zenity') {
        return showDialogZenity(reason);
    } else if (tool === 'kdialog') {
        return showDialogKdialog(reason);
    } else if (tool === 'yad') {
        // yad 与 zenity 兼容
        return showDialogZenity(reason);
    }
    
    // 没有找到 GUI 工具，返回默认结束
    process.stderr.write('[ask_continue] 未找到 zenity/kdialog/yad，无法显示对话框\n');
    return { shouldContinue: false, userInstruction: null, imagePaths: null };
}

// 使用 PowerShell 显示本地对话框 (Windows)
async function showDialogLocalWindows(reason) {
    return new Promise((resolve) => {
        // 创建临时文件保存结果
        const tempDir = os.tmpdir();
        const resultFile = path.join(tempDir, `ask_continue_result_${Date.now()}.txt`);
        
        // 转义 reason 中的特殊字符
        const escapedReason = reason.replace(/'/g, "''").replace(/`/g, "``").replace(/\$/g, "`$");
        
        // PowerShell 脚本
        const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Ask Continue'
$form.Size = New-Object System.Drawing.Size(480, 380)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$form.ShowInTaskbar = $true

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Location = New-Object System.Drawing.Point(20, 15)
$lblTitle.Size = New-Object System.Drawing.Size(420, 25)
$lblTitle.Text = 'AI想要结束对话的原因：'
$lblTitle.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($lblTitle)

$txtReason = New-Object System.Windows.Forms.TextBox
$txtReason.Location = New-Object System.Drawing.Point(20, 45)
$txtReason.Size = New-Object System.Drawing.Size(420, 70)
$txtReason.Multiline = $true
$txtReason.ReadOnly = $true
$txtReason.BackColor = [System.Drawing.Color]::FromArgb(245, 245, 245)
$txtReason.Text = '${escapedReason}'
$form.Controls.Add($txtReason)

$lblInstruction = New-Object System.Windows.Forms.Label
$lblInstruction.Location = New-Object System.Drawing.Point(20, 125)
$lblInstruction.Size = New-Object System.Drawing.Size(420, 20)
$lblInstruction.Text = '如需继续，请输入新的指令（可选）：'
$form.Controls.Add($lblInstruction)

$txtInstruction = New-Object System.Windows.Forms.TextBox
$txtInstruction.Location = New-Object System.Drawing.Point(20, 150)
$txtInstruction.Size = New-Object System.Drawing.Size(420, 120)
$txtInstruction.Multiline = $true
$txtInstruction.AcceptsReturn = $true
$txtInstruction.ScrollBars = 'Vertical'
$form.Controls.Add($txtInstruction)

$btnContinue = New-Object System.Windows.Forms.Button
$btnContinue.Location = New-Object System.Drawing.Point(100, 290)
$btnContinue.Size = New-Object System.Drawing.Size(120, 35)
$btnContinue.Text = '继续执行'
$btnContinue.BackColor = [System.Drawing.Color]::FromArgb(0, 120, 212)
$btnContinue.ForeColor = [System.Drawing.Color]::White
$btnContinue.FlatStyle = 'Flat'
$btnContinue.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.Controls.Add($btnContinue)

$btnEnd = New-Object System.Windows.Forms.Button
$btnEnd.Location = New-Object System.Drawing.Point(240, 290)
$btnEnd.Size = New-Object System.Drawing.Size(120, 35)
$btnEnd.Text = '结束对话'
$btnEnd.FlatStyle = 'Flat'
$btnEnd.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($btnEnd)

$form.AcceptButton = $btnContinue
$form.CancelButton = $btnEnd
$form.Add_Shown({ $form.Activate(); $txtInstruction.Focus() })

$dialogResult = $form.ShowDialog()

if ($dialogResult -eq [System.Windows.Forms.DialogResult]::OK) {
    $inst = $txtInstruction.Text -replace '\\r\\n', ' ' -replace '\\n', ' '
    "CONTINUE:::$inst" | Out-File -FilePath '${resultFile.replace(/\\/g, '\\\\')}' -Encoding UTF8
} else {
    "END:::" | Out-File -FilePath '${resultFile.replace(/\\/g, '\\\\')}' -Encoding UTF8
}
`;

        // 使用 cmd /c start 启动独立的 PowerShell 窗口
        const ps = spawn('cmd', ['/c', 'start', '/wait', 'powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
            stdio: 'ignore',
            detached: true,
            windowsHide: false,
            shell: false
        });

        ps.on('close', () => {
            // 读取结果文件
            try {
                if (fs.existsSync(resultFile)) {
                    const result = fs.readFileSync(resultFile, 'utf-8').trim();
                    fs.unlinkSync(resultFile);  // 删除临时文件
                    
                    if (result.startsWith('CONTINUE:::')) {
                        const instruction = result.substring(11).trim();
                        resolve({
                            shouldContinue: true,
                            userInstruction: instruction || null,
                            imagePaths: null
                        });
                    } else {
                        resolve({
                            shouldContinue: false,
                            userInstruction: null,
                            imagePaths: null
                        });
                    }
                } else {
                    resolve({ shouldContinue: false, userInstruction: null, imagePaths: null });
                }
            } catch (e) {
                resolve({ shouldContinue: false, userInstruction: null, imagePaths: null });
            }
        });

        ps.on('error', () => {
            resolve({ shouldContinue: false, userInstruction: null, imagePaths: null });
        });
    });
}

// 显示对话框
async function showDialog(reason, workspace) {
    // 首先尝试通过 VSCode 扩展显示
    const extensionResult = await showDialogViaExtension(reason, workspace);
    if (extensionResult !== null) {
        return extensionResult;
    }
    
    // 根据操作系统选择本地对话框
    if (isWindows) {
        return showDialogLocalWindows(reason);
    } else if (isLinux) {
        return showDialogLocalLinux(reason);
    } else if (isMac) {
        // macOS 可以使用 osascript，但暂时回退到 zenity（如果安装了的话）
        return showDialogLocalLinux(reason);
    }
    
    // 未知系统，返回默认结束
    process.stderr.write(`[ask_continue] 不支持的操作系统: ${os.platform()}\n`);
    return { shouldContinue: false, userInstruction: null, imagePaths: null };
}

// 处理工具调用
async function handleToolCall(name, args) {
    if (name !== 'ask_continue') {
        throw new Error(`Unknown tool: ${name}`);
    }

    const reason = args.reason || '任务已完成';
    const workspace = args.workspace;  // 可选的工作区路径
    const result = await showDialog(reason, workspace);

    // 如果有完整的内容（来自扩展），直接返回
    if (result.fullContent && result.fullContent.length > 0) {
        return { content: result.fullContent };
    }

    // 否则构建文本响应（来自本地 PowerShell 对话框）
    let responseText = `结果: should_continue=${result.shouldContinue}`;
    if (result.shouldContinue && result.userInstruction) {
        responseText += `\n用户指令: ${result.userInstruction}`;
    }

    return {
        content: [{ type: 'text', text: responseText }]
    };
}

// 处理请求
async function handleRequest(request) {
    const { method, id, params } = request;

    try {
        switch (method) {
            case 'initialize':
                sendResponse(id, {
                    protocolVersion: '2024-11-05',
                    serverInfo: SERVER_INFO,
                    capabilities: { tools: {} }
                });
                break;

            case 'initialized':
                // 通知，无需响应（通知没有 id）
                break;

            case 'notifications/cancelled':
                // 取消通知，无需响应
                break;

            case 'tools/list':
                sendResponse(id, { tools: TOOLS });
                break;

            case 'tools/call':
                const result = await handleToolCall(params.name, params.arguments || {});
                sendResponse(id, result);
                break;

            default:
                // 只对有 id 的请求发送错误响应
                if (id !== undefined) {
                    sendError(id, -32601, `Unknown method: ${method}`);
                }
        }
    } catch (error) {
        // 只对有 id 的请求发送错误响应
        if (id !== undefined) {
            sendError(id, -32603, error.message);
        }
    }
}

// 主循环
rl.on('line', async (line) => {
    if (!line.trim()) return;

    try {
        const request = JSON.parse(line);
        await handleRequest(request);
    } catch (error) {
        // 解析错误时不发送响应，只记录到 stderr
    }
});
