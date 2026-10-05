# 发布清单

GitHub 仓库用于分发源码与插件附件。以下是每次发布的检查步骤；构建与打包脚本只生成本地产物，不会自动创建远程仓库、推送、发布 Release 或提交社区目录。

## 构建发布附件

```bash
npm run verify
npm run package
```

打包脚本输出到 `dist/<version>/`：

- `main.js`
- `manifest.json`
- `styles.css`
- `LICENSE`（附带 MIT 许可）
- `weread-pocket-<version>.zip`
- `SHA256SUMS.txt`（附件与 ZIP 的 SHA-256 校验值）

根目录生成的 `main.js` 和 `dist/` 被 Git 忽略；可读源码和构建脚本保留在仓库中。

## 发布前检查

- [ ] 在 Windows 测试仓库完成真实网页验证；在声明支持的其他平台完成验证。
- [ ] 确认 `manifest.json` 的 ID、名称、版本、最低应用版本与作者正确。
- [ ] 保持 `package.json`、锁文件和 `versions.json` 与发布版本一致。
- [ ] 更新 CHANGELOG、README 和兼容性说明，准确描述账号、网络、付费与本地数据。
- [ ] 验证构建、回归检查与打包成功；人工查看产物内容。
- [ ] 验证来源切换释放旧阅读资源、登录与阅读位置恢复，以及同来源四种窗口模式复用。
- [ ] 验证「本地正文排版」两种方式：EPUB 原书文本样式、TXT 原文行首空格与换行、自定义缩进与间距，以及文献卡片独立外观；检查主题颜色、安全样式范围与外部资源阻断。
- [ ] 检查 WeRead Pocket 设置页在宽、窄面板中的边距与控件换行，确认标题、说明、按钮及下拉文字完整显示。
- [ ] 确认仓库与附件不含 `data.json`、API Key、Cookie、登录 session、真实正文或笔记内容。
- [ ] 对照最新 Obsidian 开发政策、提交要求与自动审查结果处理问题。
- [ ] 决定公开版本是否保留默认快捷键，并验证快捷键冲突与无障碍支持。
- [ ] 验证 Electron / 私有阅读接口是否允许当前实现；需要时提供清晰技术说明。
- [ ] 发布前核对[微信读书使用协议](https://cdn.weread.qq.com/app/weread_user_agreement_android.html)对第三方插件、接入与公开传播的授权条件；本项目没有声明获得腾讯授权。
- [ ] 保持 MIT 许可与第三方商标归属说明。

## GitHub Release

在 [Antonalia/weread-pocket](https://github.com/Antonalia/weread-pocket) 提交本次发布的源码与文档。Release 标签必须与 manifest 的版本完全相同，例如首个公开版本 **1.0.0**，不要在标签前加 `v`。给该 Release 分别上传 **main.js、manifest.json、styles.css**，并附上 ZIP 与 `SHA256SUMS.txt`，方便手动安装与校验；单独上传 ZIP 不够。

提交社区目录是另一步。按[官方提交流程](https://docs.obsidian.md/plugins/releasing/submit-plugin)在 Obsidian Community 关联 GitHub 并提交项目，然后根据审查反馈修订。当前文档与本地检查没有宣称项目已被官方审核。

官方文档可能调整流程，执行发布时需重新核对。
