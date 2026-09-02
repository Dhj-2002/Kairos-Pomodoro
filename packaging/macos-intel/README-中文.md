# Kairos Intel 黑苹果迁移包

本包用于 **Intel（x86_64）macOS / 黑苹果**。它包含 Kairos 1.5.0 的完整源码，以及从当前 Windows Kairos 正式数据库在线一致性备份得到的历史数据。

## 使用方法

1. 把整个 ZIP 通过 iCloud Drive 传到黑苹果并解压。
2. 在解压后的目录中打开“终端”，运行：

   ```bash
   bash Install.command
   ```

3. 第一次运行若提示安装 Xcode Command Line Tools，完成安装后再执行一次同一命令。
4. 安装器会自动准备 Bun/Rust、在本机编译 Intel 版、安装到 `~/Applications/Kairos-Pomodoro.app`，然后导入随包数据库并启动。

## 数据安全

- 随包数据库在 Windows 端通过 SQLite 在线备份生成，包含 WAL 中尚未合并的数据，并已通过完整性检查。
- 如果黑苹果上已经有 Kairos 数据，安装器不会直接销毁：旧数据库会移入 `~/Library/Application Support/com.kairos.pomodoro.app/before-migration-时间戳/`。
- 当前包的数据快照生成于 2026-08-30。详细表数量和日期范围见 `DATA-MANIFEST.txt`。

## 为什么包内不是现成 DMG

Apple 的 `.app`/`.dmg` 必须使用 macOS SDK 和 Apple 链接器构建，Windows 无法可靠地产出可运行的 macOS 二进制。因此此包在目标 Intel Mac 上进行一次本地编译，然后自动完成安装和数据迁移；不需要你手工导入历史记录。

