#requires -Version 5.1
<#
.SYNOPSIS
NKUwiki 一键构建脚本：安装依赖（缺少 node_modules 时）→ 构建站点 → 选择空闲端口 → 启动预览服务器。

.EXAMPLE
./build.ps1              # 自动在 5000-60000 范围内选择空闲端口
./build.ps1 -Port 5173   # 指定端口
#>
param(
	# 预览端口；0 或省略表示自动选择空闲端口
	[int]$Port = 0
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# 在指定范围内随机挑选一个空闲 TCP 端口
function Get-FreePort {
	param(
		[int]$Min = 5000,
		[int]$Max = 60000
	)
	for ($i = 0; $i -lt 100; $i++) {
		$candidate = Get-Random -Minimum $Min -Maximum $Max
		$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
		try {
			$listener.Start()
			$listener.Stop()
			return $candidate
		}
		catch {
			continue
		}
	}
	throw "在 ${Min}-${Max} 范围内未找到空闲端口"
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
	throw '未找到 pnpm，请先安装：npm install --global pnpm@11.24.0'
}

if (-not (Test-Path -LiteralPath 'node_modules')) {
	Write-Host '==> 安装依赖' -ForegroundColor Cyan
	pnpm install --frozen-lockfile
	if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' }
}

Write-Host '==> 构建（含页面历史生成与死链校验）' -ForegroundColor Cyan
pnpm build
if ($LASTEXITCODE -ne 0) { throw '构建失败' }

if ($Port -le 0) {
	$Port = Get-FreePort
}

Write-Host "==> 预览地址：http://localhost:$Port/（Ctrl+C 退出）" -ForegroundColor Green
pnpm exec vitepress preview docs --port $Port
