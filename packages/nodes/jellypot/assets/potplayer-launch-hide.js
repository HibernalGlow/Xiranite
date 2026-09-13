// jellypot WSH 隐藏启动垫片
// 由 wscript.exe 运行（GUI 子系统，不产生控制台窗口），
// 以隐藏窗口方式调用 node 协议启动器（dist/launcher.js）。
// 注册表指向：wscript.exe "…\potplayer-launch-hide.js" "%1"
var url = WScript.Arguments(0);
var shell = new ActiveXObject("WScript.Shell");
var cmd = '"D:\\scoop\\apps\\nodejs24\\current\\node.exe" "D:\\1VSCODE\\Projects\\Xiranite\\packages\\nodes\\jellypot\\dist\\launcher.js" "' + url + '"';
shell.Run(cmd, 0, false);
