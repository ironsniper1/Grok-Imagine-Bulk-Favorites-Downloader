# Grok Imagine – Bulk Favorites Downloader

[中文](#中文) | [English](#english)

---

## 中文

### 简介

一个用于 [Grok](https://grok.com) 的 Tampermonkey（篡改猴）用户脚本，提供收藏夹批量下载、按标签下载、视频批量放大、以及 Imagine 配额实时监控等功能。

### 功能

- **⬇ 批量下载收藏夹** — 一键下载所有已收藏的图片和视频，支持分页获取
- **🏷 按标签下载** — 选择特定标签/文件夹，仅下载该分类下的媒体
- **🔼 批量放大视频** — 自动请求低分辨率视频的 HD 放大（调用 Grok upscale API）
- **📊 Imagine 配额监控** — 实时显示 Speed Image / Quality Image / Edit Image / 480p Video / 720p Video 的剩余配额，每 30 秒自动刷新
- **💾 下载历史去重** — 自动记录已下载 ID，避免重复下载；支持清除历史以便重新下载
- **🖼️ 媒体类型过滤** — 可按"仅图片"、"仅视频"、"全部"筛选下载
- **📄 单卡下载按钮** — 在每张媒体卡片上显示下载按钮，支持直接从页面下载（包括 base64 图片）
- **⚡ 快速同步** — 仅扫描最近 N 页并标记为已下载，无需实际下载文件

### 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击脚本文件：[Grok Imagine – Bulk Favorites Downloader v22-22.2.0.user.js](./Grok%20Imagine%20–%20Bulk%20Favorites%20Downloader%20v22-22.2.0.user.js)
3. 在 Tampermonkey 中确认安装
4. 访问 [grok.com](https://grok.com)，右下角会出现控制面板

### 使用

- 点击 **⬇ Download Favorites** → 选择操作模式 → 开始下载
- 点击 **🏷 Download by Tag** → 选择标签 → 下载该标签下的媒体
- 点击 **🔼 Bulk Upscale Videos** → 自动扫描收藏夹中的低分辨率视频并请求放大
- 查看 **📊 Imagine Quota** 面板 → 了解当前各服务的剩余配额

### 配置

脚本顶部 `CONFIG` 区域可调整：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `PAGE_SIZE` | 40 | 每页获取的条目数 |
| `CHUNK_SIZE` | 200 | 下载分块大小 |
| `CHUNK_PAUSE_MS` | 5000 | 分块间暂停毫秒 |
| `API_DELAY_MS` | 1000 | API 请求间隔 |
| `DL_DELAY_MS` | 800 | 下载间隔 |
| `QUOTA_REFRESH_MS` | 30000 | 配额刷新间隔 |

---

## English

### Overview

A Tampermonkey userscript for [Grok](https://grok.com) that enables bulk downloading favorites, tag-based downloads, batch video upscaling, and real-time Imagine quota monitoring.

### Features

- **⬇ Bulk Download Favorites** — One-click download all favorited images and videos with pagination support
- **🏷 Download by Tag** — Select a specific tag/folder to download only media within that category
- **🔼 Bulk Upscale Videos** — Automatically request HD upscaling for low-resolution videos via Grok's upscale API
- **📊 Imagine Quota Monitor** — Real-time display of remaining quotas for Speed Image / Quality Image / Edit Image / 480p Video / 720p Video, auto-refreshes every 30 seconds
- **💾 Download Deduplication** — Automatically tracks downloaded IDs to avoid duplicates; clear history to re-download
- **🖼️ Media Type Filter** — Filter downloads by "Images only", "Videos only", or "All"
- **📄 Per-Card Download Button** — Download button on each media card, supports direct page downloads including base64 images
- **⚡ Quick Sync** — Scan only the most recent N pages and mark as downloaded without fetching files

### Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Click the script file: [Grok Imagine – Bulk Favorites Downloader v22-22.2.0.user.js](./Grok%20Imagine%20–%20Bulk%20Favorites%20Downloader%20v22-22.2.0.user.js)
3. Confirm installation in Tampermonkey
4. Visit [grok.com](https://grok.com) — the control panel appears in the bottom-right corner

### Usage

- Click **⬇ Download Favorites** → choose an operation mode → start downloading
- Click **🏷 Download by Tag** → select a tag → download media under that tag
- Click **🔼 Bulk Upscale Videos** → automatically scan favorites for low-res videos and request upscaling
- Monitor the **📊 Imagine Quota** panel for real-time quota status

### Configuration

Adjustable in the `CONFIG` section at the top of the script:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `PAGE_SIZE` | 40 | Items per API page |
| `CHUNK_SIZE` | 200 | Download chunk size |
| `CHUNK_PAUSE_MS` | 5000 | Pause between chunks (ms) |
| `API_DELAY_MS` | 1000 | API request interval (ms) |
| `DL_DELAY_MS` | 800 | Download interval (ms) |
| `QUOTA_REFRESH_MS` | 30000 | Quota refresh interval (ms) |

---

## 致谢 / Acknowledgements

- 原始脚本基础来自 [ironsniper1/Grok-Imagine-Bulk-Favorites-Downloader](https://github.com/ironsniper1/Grok-Imagine-Bulk-Favorites-Downloader)，感谢其开创性工作。
- Imagine 配额 API（`grok.com/rest/media/imagine/quota_info`）的发现和初始实现来自 [mashiourcse/grok_quota_check_extension](https://github.com/mashiourcse/grok_quota_check_extension)，感谢对内部 API 的探索。

---

## License

Open source — not a commercial product. Use at your own risk. Grok APIs are undocumented and may change without notice.
