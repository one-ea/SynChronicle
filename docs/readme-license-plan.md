# README and License Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用全新的产品首页型 README 替换现有长文档，删除历史视觉资源，并统一 Apache-2.0 版权与发布包信息。

**Architecture:** README 只承担项目定位、上手、运行和安全说明，高级内容链接到现有 `docs/`。许可证保持标准 Apache-2.0 正文，通过独立 `NOTICE` 声明 SynChronicle 与 one-ea 版权，品牌契约测试锁定文档和发布包一致性。

**Tech Stack:** Markdown、Apache License 2.0、GoReleaser v2、Go 品牌契约测试

## Global Constraints

- README 为 180 至 250 行的产品首页。
- README 不引用旧 GIF、截图或已删除资源。
- 删除 `scripts/sample.gif` 和 `scripts/novel.png`。
- 许可证为 Apache License 2.0。
- 版权所有者为 `one-ea`，年份为 `2026`。
- `LICENSE` 保持标准 Apache-2.0 正文。
- `NOTICE` 内容与批准文本完全一致。
- GoReleaser archive 包含 README、LICENSE 和 NOTICE。
- 配置示例只使用占位密钥。

### Task 1: Rewrite README and License Metadata

**Files:**
- Replace: `README.md`
- Create: `NOTICE`
- Modify: `.goreleaser.yml`
- Modify: `internal/brand/brand_test.go`
- Delete: `scripts/sample.gif`
- Delete: `scripts/novel.png`

- [ ] **Step 1: Add failing documentation and license contract tests**

Assert README line count is 180-250, required sections and current commands exist, deleted visual paths are absent, License text says Apache-2.0, NOTICE matches approved content, and GoReleaser contains NOTICE.

- [ ] **Step 2: Verify RED**

Run `go test ./internal/brand -count=1` and confirm failures for README length, MIT text, missing NOTICE, old image references and missing archive file.

- [ ] **Step 3: Replace README**

Write the approved product-page structure with current installation, minimal JSONC configuration, commands, output structure, architecture, Docker, development, security and license sections.

- [ ] **Step 4: Add NOTICE and update release archive**

Create `NOTICE` with the exact approved text and add it to `.goreleaser.yml` archive files.

- [ ] **Step 5: Delete old visual resources**

Use apply_patch Delete File for `scripts/sample.gif` and `scripts/novel.png`.

- [ ] **Step 6: Verify**

Run:

```bash
go test ./internal/brand -count=1
go test ./...
go vet ./...
go build -o /tmp/opencode/synchronicle ./cmd/synchronicle
sh -n scripts/install.sh
git diff --check
```

Confirm GitHub license metadata remains Apache-2.0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: refresh SynChronicle README and license"
```
