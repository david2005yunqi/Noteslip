# Noteslip

Noteslip 是一款基于 Rust + Tauri 开发的本地笔记与日志工具。它融合了原有的每日日志管理功能以及从 Noteseye 合并而来的通用笔记与白板（Excalidraw）功能。

## 目录
- [功能特性](#功能特性)
- [核心模块](#核心模块)
- [项目结构](#项目结构)
- [开发与构建](#开发与构建)
- [数据存储](#数据存储)
- [许可证](#许可证)

---

## 功能特性

- **每日日志 (Daily Logs)**：按日期（YYYY-MM-DD）管理日记，支持 Markdown 格式。
- **通用笔记 (General Notes)**：自由命名的 Markdown 笔记，支持元数据 (Frontmatter)。
- **白板功能 (Whiteboards)**：集成 Excalidraw，支持手绘、流程图等可视化记录，保存为 `.excalidraw.json`。
- **全局搜索**：一键搜索所有日志和笔记内容，按行匹配并支持点击跳转。
- **实时预览**：内置 Markdown 实时预览，支持分栏显示。
- **本地优先**：所有数据均存储在本地，不上传云端，确保隐私安全。
- **自动保存**：输入即保存，支持 `Ctrl+S` 手动强制保存。
- **导出与备份**：支持将日志/笔记导出为单个文件，或一键备份整个数据库。

## 核心模块

### 1. 日志与笔记 (Rust Backend)
后端采用 Rust 编写，利用 `tauri` 实现高性能的文件系统访问 and 数据处理。核心功能包括：
- 文件的读写与校验。
- 简单的 Frontmatter 解析。
- 基于内容的文本搜索算法。

### 2. 白板 (Excalidraw)
通过在前端集成 Excalidraw Bundle，实现了强大的手绘功能。通过 `tauri-bridge.js` 建立了白板与 Rust 后端之间的持久化通信。

---

## 项目结构

本项目的文件夹作用如下：

| 文件夹/文件 | 作用描述 |
| :--- | :--- |
| **`src-tauri/`** | **Rust 后端核心目录**。包含 Tauri 配置、Rust 源代码及依赖声明。 |
| ├── `src/main.rs` | 应用的入口逻辑。处理所有来自前端的指令（Invoke Commands），负责文件读写、搜索、设置管理等。 |
| ├── `Cargo.toml` | Rust 项目的依赖管理文件。 |
| └── `tauri.conf.json` | Tauri 配置文件。定义了窗口属性、权限控制（Allowlist）、构建命令等。 |
| **`renderer/`** | **前端界面目录**。负责 UI 渲染与用户交互。 |
| ├── `index.html` | 应用的主 HTML 结构。 |
| ├── `renderer.js` | 前端逻辑核心。处理标签切换、调用 Rust 命令、更新 UI 状态及自动保存。 |
| ├── `styles.css` | 现代化的 CSS 样式表，支持深浅色模式切换。 |
| ├── `excalidraw.html/js/css` | Excalidraw 白板的相关静态资源包。 |
| └── `tauri-bridge.js` | 专门为白板提供的桥接脚本，用于适配 Tauri 指令。 |
| **`node_modules/`** | (自动生成) Node.js 依赖包，用于开发阶段的脚本运行。 |
| **`dist/`** | (构建产物) 编译后的前端资源，最终会被打包进可执行文件中。 |
| **`.gitignore`** | Git 忽略规则，防止将临时文件或构建产物提交到仓库。 |
| **`README.md`** | 本文档，项目的说明与指南。 |

---

## 开发与构建

### 运行开发环境
确保已安装 Node.js 和 Rust 环境，然后运行：
```bash
npm install
npm start
```

### 打包应用
```bash
npm run dist
```
产物将生成在 `src-tauri/target/release/bundle/` 下。

---

## 数据存储

默认情况下，Noteslip 会在系统的应用数据目录下创建以下结构：
- `daily-logs/`：存放每日日志文件。
- `general-notes/`：存放通用 Markdown 笔记。
- `whiteboards/`：存放白板数据。
- `settings.json`：存放用户的个性化配置。

---

## 许可证
本项目采用 **GNU General Public License v3.0 (GPL-3.0)** 开源。详情请参阅 [LICENSE](./LICENSE) 文件。
