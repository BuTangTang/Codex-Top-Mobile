/** 默认机器入口保留全部原能力；产品入口可直接消费同一个窄连接 core。 */
import { ApiMachineClientCore } from './apiMachineCore';
import type { Machine } from './types';
import { configuration } from '@/configuration';
import { decodeJwtPayload } from '@/cloud/decodeJwtPayload';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { registerSessionHandlers } from '@/rpc/handlers/registerSessionHandlers';
import { registerScmHandlers } from '@/rpc/handlers/scm';
import { registerFileSystemHandlers } from '@/rpc/handlers/fileSystem';
import { registerWorkspaceAnchorHandlers } from '@/rpc/handlers/workspaceAnchors/registerWorkspaceAnchorHandlers';
import { registerWorkspaceFaviconHandlers } from '@/rpc/handlers/workspaceFavicon/registerWorkspaceFaviconHandlers';
import { registerMachineFileBrowserHandlers } from '@/rpc/handlers/machineFileBrowser/registerMachineFileBrowserHandlers';
import { resolveFilesystemAccessPolicy, type FilesystemAccessPolicy } from '@/rpc/handlers/fileSystem/accessPolicy/filesystemAccessPolicy';
import type { ScmConnectedAccountCredentialResolver } from '@/scm/types';
import { registerMachineRpcHandlers, type MachineRpcHandlerDeps, type MachineRpcHandlers } from './machine/rpcHandlers';
import { registerCodexAccountUsageRpcHandlers } from './machine/rpcHandlers.codexAccountUsage';
import { resolveMachineRpcWorkingDirectory } from './machine/resolveMachineRpcWorkingDirectory';

export type {
    AccountSettingsVersionHintSource,
    AccountSettingsVersionHintNotification,
    PendingSessionActivationHintNotification,
    ConnectedServicesProjectionChangeSource,
    ConnectedServicesProjectionChangeNotification,
} from './apiMachineCore';

export type ApiMachineClientDeps = Readonly<{
    connectedAccounts?: ScmConnectedAccountCredentialResolver;
    directSessionNotifications?: MachineRpcHandlerDeps['directSessionNotifications'];
}>;

const REQUIRED_MACHINE_CONTROL_RPC_METHODS = Object.freeze([
    RPC_METHODS.SPAWN_HAPPY_SESSION,
    RPC_METHODS.SPAWN_HAPPY_SESSION_PROVIDER_SAFE,
    RPC_METHODS.DAEMON_SPAWN_SESSION_RESOLVE,
    RPC_METHODS.STOP_SESSION,
    RPC_METHODS.DAEMON_SESSION_HANDOFF_CAPABILITY_V2_GET,
]);

export class ApiMachineClient extends ApiMachineClientCore {
    private readonly directSessionNotifications: MachineRpcHandlerDeps['directSessionNotifications'];
    private readonly machineRpcWorkingDirectory: string;
    private readonly filesystemAccessPolicy: FilesystemAccessPolicy;
    private readonly attachmentUploadMaxBytes?: number;

    /** 兼容原公开构造参数，按原顺序注册额度、会话、文件、工作区和 SCM。 */
    constructor(
        token: string,
        machine: Machine,
        ownershipMetadata?: Readonly<{
            runtimeId?: string;
            cliVersion?: string;
            publicReleaseChannel?: string;
            startupSource?: string;
            serviceManaged?: boolean;
            serviceLabel?: string;
        }>,
        deps?: ApiMachineClientDeps,
    ) {
        super(token, machine, ownershipMetadata, { requiredRpcMethods: REQUIRED_MACHINE_CONTROL_RPC_METHODS });
        this.directSessionNotifications = deps?.directSessionNotifications;
        // 当前机器额度仅通过已认证的机器RPC开放，实际读取仍由Codex来源owner负责。
        const quotaAccountId = decodeJwtPayload(token)?.sub;
        registerCodexAccountUsageRpcHandlers({
            rpcHandlerManager: this.rpcHandlerManager,
            machineId: machine.id,
            accountId: typeof quotaAccountId === 'string' ? quotaAccountId : null,
            activeServerDir: configuration.activeServerDir,
        });

        const machineRpcWorkingDirectory = resolveMachineRpcWorkingDirectory();
        const filesystemAccessPolicy = resolveFilesystemAccessPolicy();
        this.machineRpcWorkingDirectory = machineRpcWorkingDirectory;
        this.filesystemAccessPolicy = filesystemAccessPolicy;
        let additionalAllowedReadDirs: string[] = [];
        let additionalAllowedWriteDirs: string[] = [];
        this.rpcLifecycleRegistrations.push(registerSessionHandlers(this.rpcHandlerManager, machineRpcWorkingDirectory, {
            accessPolicy: filesystemAccessPolicy,
            setAdditionalAllowedReadDirs: (dirs) => {
                additionalAllowedReadDirs = dirs;
            },
            setAdditionalAllowedWriteDirs: (dirs) => {
                additionalAllowedWriteDirs = dirs;
            },
        }));
        const fileSystemRegistration = registerFileSystemHandlers(this.rpcHandlerManager, machineRpcWorkingDirectory, {
            accessPolicy: filesystemAccessPolicy,
            getAdditionalAllowedReadDirs: () => additionalAllowedReadDirs,
            getAdditionalAllowedWriteDirs: () => additionalAllowedWriteDirs,
        });
        this.rpcLifecycleRegistrations.push(fileSystemRegistration);
        // 只保留实际文件传输注册的容量；候选列表不得用外部 deps 或默认值替代。
        this.attachmentUploadMaxBytes = fileSystemRegistration.attachmentUploadMaxBytes;
        registerWorkspaceAnchorHandlers(this.rpcHandlerManager, {
            defaultDirectory: machineRpcWorkingDirectory,
            accessPolicy: filesystemAccessPolicy,
        });
        registerWorkspaceFaviconHandlers(this.rpcHandlerManager, {
            defaultDirectory: machineRpcWorkingDirectory,
            accessPolicy: filesystemAccessPolicy,
        });
        registerMachineFileBrowserHandlers({
            rpcHandlerManager: this.rpcHandlerManager,
            accessPolicy: filesystemAccessPolicy,
        });
        // SCM must be machine-scoped so the UI can view diffs/logs and perform staging/commit operations
        // even when no session is currently active.
        registerScmHandlers(this.rpcHandlerManager, machineRpcWorkingDirectory, {
            accessPolicy: filesystemAccessPolicy,
            connectedAccounts: deps?.connectedAccounts,
        });
    }

    /** 默认注册保持原 deps 优先级和实际上传上限，通过共享 core 绑定生命周期。 */
    setRPCHandlers({
        spawnSession,
        spawnSessionForHandoff,
        resolveSpawnSessionByNonce,
        abandonSpawnSessionByNonce,
        stopSession,
        isSessionActive,
        loadLocalSessionMetadata,
        requestShutdown,
        memory,
        daemonServerWorkScheduler,
        machineTransferChannel,
        directPeerTransfer,
    }: MachineRpcHandlers, deps?: MachineRpcHandlerDeps) {
        this.registerRpcHandlers((runtime) => registerMachineRpcHandlers({
            rpcHandlerManager: runtime.rpcHandlerManager,
            handlers: {
                spawnSession,
                ...(spawnSessionForHandoff ? { spawnSessionForHandoff } : {}),
                ...(resolveSpawnSessionByNonce ? { resolveSpawnSessionByNonce } : {}),
                ...(abandonSpawnSessionByNonce ? { abandonSpawnSessionByNonce } : {}),
                stopSession,
                ...(isSessionActive ? { isSessionActive } : {}),
                ...(loadLocalSessionMetadata ? { loadLocalSessionMetadata } : {}),
                requestShutdown,
                ...(memory ? { memory } : {}),
                ...(daemonServerWorkScheduler ? { daemonServerWorkScheduler } : {}),
                ...(machineTransferChannel ? { machineTransferChannel } : {}),
                ...(directPeerTransfer ? { directPeerTransfer } : {}),
            },
            deps: {
                ...deps,
                directSessionNotifications: deps?.directSessionNotifications ?? this.directSessionNotifications,
                machineRpcWorkingDirectory: this.machineRpcWorkingDirectory,
                filesystemAccessPolicy: this.filesystemAccessPolicy,
                attachmentUploadMaxBytes: this.attachmentUploadMaxBytes,
                emitDirectSessionTranscriptUpdate:
                    deps?.emitDirectSessionTranscriptUpdate
                    ?? runtime.emitDirectSessionTranscriptUpdate,
                emitActionOperationRevision: runtime.emitActionOperationRevision,
                getActionOperationScope: runtime.getActionOperationScope,
            },
        }), {
            reconcileDirectSessions: Boolean(deps?.directSessionNotifications ?? this.directSessionNotifications),
        });
    }
}
