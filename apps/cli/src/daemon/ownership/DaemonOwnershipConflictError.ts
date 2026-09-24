import type { CurrentDaemonOwner } from '@/daemon/ownership/evaluateCurrentDaemonOwner';
import { renderDaemonOwnerConflict } from '@/daemon/ownership/renderDaemonOwnerConflict';

type DaemonOwnershipConflictIntent =
    | 'session-autostart'
    | 'daemon-start'
    | 'daemon-stop'
    | 'daemon-restart';

export class DaemonOwnershipConflictError extends Error {
    public readonly title: string;
    public readonly lines: readonly string[];
    public readonly owner: CurrentDaemonOwner;

    public constructor(params: Readonly<{
        intent: DaemonOwnershipConflictIntent;
        owner: CurrentDaemonOwner;
    }>) {
        const message = renderDaemonOwnerConflict(params);
        super([message.title, ...message.lines].join(' '));
        this.name = 'DaemonOwnershipConflictError';
        this.title = message.title;
        this.lines = message.lines;
        this.owner = params.owner;
    }
}
