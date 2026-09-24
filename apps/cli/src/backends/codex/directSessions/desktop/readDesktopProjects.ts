import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import type { DesktopProjectV1 } from '@happier-dev/protocol';
import { DirectSessionsProviderUnavailableError } from '@/backends/directSessions/providerOps';

const savedProject = z.object({ id: z.string().min(1), name: z.string(), rootPaths: z.array(z.string().min(1)), createdAt: z.number(), updatedAt: z.number() });
const savedState = z.object({ 'local-projects': z.record(z.string(), savedProject), 'project-order': z.array(z.string()).optional() });

/** 只读取桌面保存的真实项目，不从历史任务目录推导项目。 */
export async function readDesktopProjects(codexHome: string): Promise<DesktopProjectV1[]> {
    let text: string;
    try {
        const file = join(codexHome, '.codex-global-state.json');
        const info = await stat(file);
        if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error('invalid_file');
        text = await readFile(file, 'utf8');
    } catch { throw new DirectSessionsProviderUnavailableError('desktop_projects_unavailable'); }
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new DirectSessionsProviderUnavailableError('desktop_projects_invalid'); }
    const parsed = savedState.safeParse(value);
    if (!parsed.success) throw new DirectSessionsProviderUnavailableError('desktop_projects_invalid');
    const projects = parsed.data['local-projects'];
    if (Object.entries(projects).some(([key, value]) => key !== value.id)) throw new DirectSessionsProviderUnavailableError('desktop_projects_invalid');
    const order = [...new Set([...(parsed.data['project-order'] ?? []), ...Object.keys(projects)])];
    const result: DesktopProjectV1[] = [];
    for (const id of order) {
        const project = projects[id];
        if (!project) continue;
        let available = project.rootPaths.length > 0;
        for (const path of project.rootPaths) {
            try { if (!isAbsolute(path) || !(await stat(path)).isDirectory()) available = false; }
            catch { available = false; }
        }
        result.push({ id, name: project.name, rootPaths: project.rootPaths, available,
            ...(!available ? { unavailableReason: 'project_root_unavailable' } : {}) });
    }
    return result;
}
