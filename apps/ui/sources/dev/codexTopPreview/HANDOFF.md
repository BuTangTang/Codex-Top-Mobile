# Codex Top 手机预览交接

主管补充（交回后）：已用空本机配置夹具隔离 app.local.js，样板/配置合计46项通过；修正 NODE_ENV 只读类型的测试设置方式后，配置35项再次通过，完整 UI noEmit exit0。下文6项失败为修复前记录。393×852 Web视口已操作分类/搜索/对话/示例发送与拒绝/底栏/明暗主题，临时浏览器和8084预览进程已清理；原生软键盘、动画与正式业务仍未验收。

结果：隔离样板和入口门禁已接上。默认入口仍是 `sources/app`。只有显式开关、development 变体、开发运行时同时成立才进入预览。界面文案、无障碍名称和空态都是简体中文，没有语言切换。各变体显示名都是 Codex Top，包名和 scheme 未改。

已观察到的失败：`appConfig.easDefaults.test.ts` 有 6 项失败，断言的是 Android 包名和 `expo.version`。本机 ignored `app.local.js` 写入了 `EXPO_ANDROID_PACKAGE` 和 `EXPO_APP_VERSION`，配置加载时覆盖了这些值。显示名断言 `Codex Top` 和 Router 根目录断言已通过。不要为了本机覆盖去改包名预期。

## 开启

在 `apps/ui` 下，Node 使用主管给出的 Node 24。不要另装依赖。

```sh
export PATH="/Users/butang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
export EXPO_PUBLIC_CODEX_TOP_PREVIEW=1
export APP_ENV=development
export NODE_ENV=development
```

然后按主管现有方式启动 Expo。`APP_ENV=publicdev`、`preview`、`production`，或 `NODE_ENV=production`，或未设置开关时，根目录保持 `./sources/app`。

预览页只使用合成数据。横幅写着「界面预览 · 示例数据」。发送和确认/拒绝只改本页状态。

## 已运行

Node v24.19.0。

- `sources/dev/codexTopPreview/resolveCodexTopRouterRoot.test.ts`
- `sources/dev/codexTopPreview/sampleModel.test.ts`
- `sources/dev/codexTopPreview/previewImportBoundary.test.ts`

结果：3 个文件、11 项通过。

- `sources/__tests__/config/appConfig.easDefaults.test.ts`

结果：35 项里 29 项通过。Router 根目录用例通过。上面 6 项是本机 `app.local.js` 的包名和版本覆盖。

主管已在 localhost:8084 打开预览。浏览器画面和正式 `noEmit` 由主管验收。这次只改了测试里 `NODE_ENV` 的恢复方式：该字段类型上必填，改为赋值，不再 `delete`。

## 写权交回

`apps/ui/sources/dev/codexTopPreview/**`、`apps/ui/app.config.js`、`apps/ui/index.ts`、`apps/ui/appVariantConfig.cjs` 的显示名，以及 `appConfig.easDefaults.test.ts`。未改认证、SessionView、同步、RPC、服务端或依赖清单。

## 未验证

手机真机、键盘和减少动态效果的实机表现、Metro 热更新后的画面。这些由主管在已启动的预览上查看。
