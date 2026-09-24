import { pathToFileURL } from 'node:url';
import { provisionPasswordAccount } from '../sources/app/auth/password/provisionPasswordAccount';
import { initDbPostgres, initDbSqlite, initDbMysql, requireDbProviderFromEnv, shutdownDbClient } from '../sources/storage/prisma';

/** 只从非交互标准输入读取一行密码，限制大小且不接受 argv 密码或终端回显。 */
export async function readProvisionPassword(input: NodeJS.ReadableStream & { isTTY?: boolean }): Promise<string> {
    if (input.isTTY) throw new Error('Password must be supplied through stdin');
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of input) {
        const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
        length += bytes.length;
        if (length > 4098) throw new Error('Password input too long');
        chunks.push(bytes);
    }
    const all = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    try {
        // 只去掉管道末尾换行，不 trim 用户密码中的有效空白。
        const password = new TextDecoder('utf-8', { fatal: true }).decode(all).replace(/\r?\n$/, '');
        if (/[\r\n]/.test(password)) throw new Error('Password must be a single line');
        return password;
    } finally {
        all.fill(0);
        for (const chunk of chunks) chunk.fill(0);
    }
}

/** 管理员显式选择目标库后预建账号；不隐式启动服务、迁移库或使用旧账号。 */
async function main(): Promise<void> {
    if (process.argv.length !== 3 || !process.env.DATABASE_URL) throw new Error('Usage: createPasswordAccount <loginName>; DATABASE_URL and stdin password required');
    const password = await readProvisionPassword(process.stdin);
    const provider = requireDbProviderFromEnv(process.env, 'postgres');
    if (provider === 'pglite') throw new Error('Use the controlled database maintenance connection for account provisioning');
    if (provider === 'postgres') initDbPostgres();
    else if (provider === 'sqlite') await initDbSqlite();
    else await initDbMysql();
    try {
        await provisionPasswordAccount({ loginName: process.argv[2], password, env: process.env });
        console.log('Password account created');
    } finally {
        await shutdownDbClient();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    // 错误对象可能含数据库参数，只输出固定错误防止秘密进入日志。
    main().catch(() => { console.error('Password account creation failed; check input, existing account, and database configuration'); process.exitCode = 1; });
}
