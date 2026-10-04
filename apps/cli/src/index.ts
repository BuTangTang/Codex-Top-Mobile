#!/usr/bin/env node
import { dispatchCli } from '@/cli/dispatch';
import { runCliEntrypoint } from '@/cli/runtime/runCliEntrypoint';

// 默认发布入口复用唯一引导 owner，模块位置仍由入口自身提供。
runCliEntrypoint({ dispatch: dispatchCli, moduleUrl: import.meta.url });
