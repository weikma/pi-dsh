# 随包辅助资源

`prepare-auxiliary.mjs` 准备目标运行时目录中的 Python 和 Office 部分。`prepareAuxiliary({ target, output, cache })` 返回主 `pi-dsh-runtime-v1` 清单的 `auxiliary` 字段；所有清单路径都相对于 `output`。Node、官方 Pi、pnpm 和可执行搜索工具由主运行时构建方准备。

`auxiliary-lock.json` 锁定 python-build-standalone 20260901 发布中的 Python 3.12.14，以及完整的 numpy、pandas、python-docx、python-pptx、openpyxl、Pillow、lxml 和 XlsxWriter 依赖集合。平台特定 wheel 覆盖 macOS arm64/x64、Windows x64 和 Linux arm64/x64。下载必须匹配记录的 SHA-256 字节；Python wheel 保留 distribution 元数据和辅助脚本，不生成命令包装脚本。

准备后的目录包含 `python/`、`office/skills/`、`office/scripts/check_office.py` 和 `pi/pi-dsh-runtime.ts`。最后一个文件是公共 Pi 扩展，从官方 CLI 的包目录加载，使其公共导入使用该运行时的包解析。它注册 `load_workspace_dependencies`，并通过 `resources_discover` 发现三个 Office skill。工具结果包含解释器、pnpm、库和检查脚本的绝对路径。Pi 将工具输出记录在自己的文本记录中；扩展不修改其执行循环、认证或会话文件。

`smokeAuxiliary(runtimeRoot, auxiliaryManifest)` 执行原生 Python 版本、distribution 版本检查、`pip check`、导入、Office 文档创建／重开和结构检查脚本。跨平台准备不会执行其他平台的解释器。原生执行结果、签名和安装器验证必须分别记录。

`pnpm runtime:prepare` 组装原生目标；`pnpm test:runtime` 检查其可执行文件和库。`pnpm test` 的真实公共扩展流程发现 `.pi-dsh-build/runtime/<native-target>`，`PI_DSH_TEST_RUNTIME` 可显式覆盖。只有默认资源缺失时跳过此流程；显式资源无效时失败。macOS arm64 流程已执行返回的 Node／pnpm／Python 路径、创建并重开 XLSX 文件、发现 Office skill，并检查 Pi 自己的 JSONL 工具记录。

Office 检查脚本验证 OOXML ZIP/XML 结构和指定内容。Python 库和检查脚本不渲染文档，也不重新计算电子表格公式。渲染和 Desktop 查看器是独立功能；这些 skill 只使用明确可用的渲染操作。
