import type { SessionListViewItem } from './sessionListViewData';
import { projectSessionListPlacement } from './placement/sessionListPlacementProjection';

export type SessionListStatusFilter = 'all' | 'working' | 'attention';

/** 在已按来源投影的列表上筛选，保留原行对象及命中行的分组祖先。 */
export function filterSessionListViewDataByStatus(source: ReadonlyArray<SessionListViewItem>, filter: SessionListStatusFilter, nowMs: number): SessionListViewItem[] {
    if (filter === 'all') return source as SessionListViewItem[];
    type Header = Extract<SessionListViewItem, { type: 'header' }>;
    let server: Header | null = null;
    let section: Header | null = null;
    let group: Header | null = null;
    let folders: Header[] = [];
    const included = new Set<SessionListViewItem>();
    for (const item of source) {
        if (item.type === 'header') {
            if (item.headerKind === 'server') {
                server = item; section = null; group = null; folders = [];
            } else if (['active', 'inactive', 'sessions'].includes(item.headerKind ?? '')) {
                section = item; group = null; folders = [];
            } else if (item.headerKind === 'folder') {
                folders = folders.filter((parent) => (parent.depth ?? 0) < (item.depth ?? 0));
                folders.push(item);
            } else {
                group = item; folders = [];
            }
            continue;
        }
        // 不传运行保留提示，过期工作只能留在“全部”，状态仍由原投影判断。
        const placement = projectSessionListPlacement({ session: item.session, nowMs });
        const matches = filter === 'working'
            ? placement.kind === 'working' && !placement.retainedWorking
            : placement.kind === 'permission_required' || placement.kind === 'action_required';
        if (!matches) continue;
        // 文件夹先输出子树再输出自身会话；按行深度回退，不能误带最后一个子目录。
        const rowFolders = item.folderId === null ? []
            : typeof item.folderDepth === 'number'
                ? folders.filter((folder) => (folder.depth ?? 0) < item.folderDepth!)
                : folders;
        if (server) included.add(server);
        if (section) included.add(section);
        if (group) included.add(group);
        for (const folder of rowFolders) included.add(folder);
        included.add(item);
    }
    if (included.size === source.length) return source as SessionListViewItem[];
    return source.filter((item) => included.has(item));
}
