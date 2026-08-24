# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: keep the existing Node.js static WebUI server and inline HTML/CSS/JS surface; avoid introducing a frontend framework for this pass.

## Users

工作假设：需要在本机配置模型、提交长篇创作需求并观察写作过程的创作者。

## Product Purpose

工作假设：SynChronicle 把创作者的一句话灵感交给多智能体写作引擎，并让创作者在本地持续观察、干预和恢复创作过程。

## Positioning

工作假设：作品正文、运行状态和恢复工件保存在本地，创作者可以在同一个工作台里连接模型、启动创作和查看过程。

## Operating Context

工作假设：用户从桌面浏览器、平板浏览器或手机浏览器访问本地 WebUI；首次进入需要配置模型，之后进入创作工作台。

## Capabilities and Constraints

- 已有 Node.js Host、模型配置、headless 运行、状态快照和运行事件接口。
- 当前 WebUI 需要覆盖首次配置、提交创作需求、运行中状态、空状态和错误反馈。
- 本轮不引入 TUI，不改变核心 Agent/Store 行为。
- 三端适配指桌面宽屏、平板中屏和手机窄屏浏览器。

## Brand Commitments

- 产品名：SynChronicle。
- 现有视觉识别：深色工作室基底、暖白文字、荧光黄绿强调色。

## Evidence on Hand

- 现有 WebUI：`src/web/app.ts`。
- 现有运行服务：`src/web/server.ts`。
- 用户提供的现状截图：首屏以超大标题、配置表单、运行指标和事件记录组成。

## Product Principles

- 先让用户知道下一步，再展示系统细节。
- 创作输入是主工作面，配置是连接动作，不应抢走主叙事。
- 运行状态必须持续可见，并在窄屏上保持可读。
- 本地状态与隐私边界要用清晰文案表达。

## Accessibility & Inclusion

工作假设：支持键盘操作、可见焦点、语义标签、减少动态效果偏好，并能在中文长文案下稳定换行。
