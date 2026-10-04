#!/usr/bin/env node
import { dispatchCodexTopCli } from '@/cli/productCommandRegistry';
import { runCliEntrypoint } from '@/cli/runtime/runCliEntrypoint';

// 产品构建用显式入口和静态能力别名，复用唯一 CLI 引导与命令工作流。
runCliEntrypoint({ dispatch: dispatchCodexTopCli, moduleUrl: import.meta.url });
