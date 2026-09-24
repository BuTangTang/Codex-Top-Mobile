import { sanitizeConnectedServiceDiagnosticString } from '@/daemon/connectedServices/diagnostics/sanitizeConnectedServiceDiagnosticString';
import {
    classifyConnectedServiceSensitiveDiagnosticKey,
    CONNECTED_SERVICE_LOCAL_PATH_REDACTION_MARKER,
    CONNECTED_SERVICE_PROVIDER_RESUME_ID_REDACTION_MARKER,
    resolveConnectedServiceSensitiveDiagnosticMarker,
} from '@/daemon/connectedServices/diagnostics/sensitiveConnectedServiceDiagnosticFields';

const MAX_LOG_STRING_CHARS = 2_000;
const MAX_LOG_ARRAY_ITEMS = 20;
const MAX_LOG_OBJECT_KEYS = 40;
const MAX_LOG_DEPTH = 6;

const TRUNCATION_MARKER = true;
const PROVIDER_RESUME_ASSIGNMENT_PATTERN = /\b(CODEX_THREAD_ID|threadId|thread_id|codexSessionId|codex_session_id|vendorSessionId|vendor_session_id|remoteSessionId|remote_session_id|providerSessionId|provider_session_id|sessionId|session_id|vendorResumeId|vendor_resume_id|providerResumeId|provider_resume_id|resumeId|resume_id)(?:"?)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;,]+)/giu;
const LOCAL_PATH_ASSIGNMENT_PATTERN = /\b(cwd|cwds|filePath|file_path|filePaths|file_paths|localPath|local_path|savedPath|saved_path|path|paths|location)(?:"?)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;,]+)/giu;
const LOCAL_ABSOLUTE_PATH_PATTERN = /(^|[\s"'([{:=])(?:[A-Za-z]:[\\/][^\s"'();,]+|\\\\[^\s"'();,]+|\/(?!\/)[^\s"'();,]*)/gu;

type SanitizerState = Readonly<{
    depth: number;
    seen: WeakSet<object>;
}>;

type TruncatedStringLogValue = Readonly<{
    __happierRpcLogTruncated: true;
    originalType: 'string';
    originalLength: number;
    value: string;
}>;

type TruncatedArrayLogValue = Readonly<{
    __happierRpcLogTruncated: true;
    originalType: 'array';
    totalItems: number;
    shownItems: number;
    items: readonly unknown[];
}>;

type TruncatedObjectLogValue = Readonly<{
    __happierRpcLogTruncated: true;
    originalType: 'object';
    totalKeys?: number;
    shownKeys?: number;
    reason?: 'circular' | 'maxDepth';
    value?: Readonly<Record<string, unknown>>;
}>;

function normalizeRpcLogKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function classifyRpcLogSensitiveKey(key: string | undefined) {
    const category = classifyConnectedServiceSensitiveDiagnosticKey(key);
    if (category) return category;
    return key && normalizeRpcLogKey(key) === 'id' ? 'provider_resume_id' : null;
}

export function sanitizeCodexAppServerRpcDiagnosticString(
    value: string,
    params: Readonly<{ redactedValues?: readonly string[] }> = {},
): string {
    return sanitizeConnectedServiceDiagnosticString(value, {
        maxLength: value.length,
        redactedValues: params.redactedValues,
    })
        .replace(PROVIDER_RESUME_ASSIGNMENT_PATTERN, `$1=${CONNECTED_SERVICE_PROVIDER_RESUME_ID_REDACTION_MARKER}`)
        .replace(LOCAL_PATH_ASSIGNMENT_PATTERN, `$1=${CONNECTED_SERVICE_LOCAL_PATH_REDACTION_MARKER}`)
        .replace(LOCAL_ABSOLUTE_PATH_PATTERN, `$1${CONNECTED_SERVICE_LOCAL_PATH_REDACTION_MARKER}`);
}

function sanitizeStringForRpcLog(value: string): string | TruncatedStringLogValue {
    const sanitized = sanitizeCodexAppServerRpcDiagnosticString(value);
    if (sanitized.length <= MAX_LOG_STRING_CHARS) return sanitized;
    return {
        __happierRpcLogTruncated: TRUNCATION_MARKER,
        originalType: 'string',
        originalLength: sanitized.length,
        value: sanitized.slice(0, MAX_LOG_STRING_CHARS),
    };
}

function nextState(state: SanitizerState): SanitizerState {
    return { depth: state.depth + 1, seen: state.seen };
}

function sanitizeArrayForRpcLog(value: readonly unknown[], state: SanitizerState, key?: string): readonly unknown[] | TruncatedArrayLogValue {
    const childState = nextState(state);
    const items = value.slice(0, MAX_LOG_ARRAY_ITEMS).map((item) => sanitizeCodexAppServerRpcLogValueInternal(item, childState, key));
    if (value.length <= MAX_LOG_ARRAY_ITEMS) return items;
    return {
        __happierRpcLogTruncated: TRUNCATION_MARKER,
        originalType: 'array',
        totalItems: value.length,
        shownItems: items.length,
        items,
    };
}

function sanitizeObjectForRpcLog(value: object, state: SanitizerState): Readonly<Record<string, unknown>> | TruncatedObjectLogValue {
    if (state.seen.has(value)) {
        return {
            __happierRpcLogTruncated: TRUNCATION_MARKER,
            originalType: 'object',
            reason: 'circular',
        };
    }
    if (state.depth >= MAX_LOG_DEPTH) {
        return {
            __happierRpcLogTruncated: TRUNCATION_MARKER,
            originalType: 'object',
            reason: 'maxDepth',
        };
    }

    state.seen.add(value);
    const entries = Object.entries(value as Record<string, unknown>);
    const output: Record<string, unknown> = {};
    const childState = nextState(state);
    for (const [key, child] of entries.slice(0, MAX_LOG_OBJECT_KEYS)) {
        output[key] = sanitizeCodexAppServerRpcLogValueInternal(child, childState, key);
    }
    state.seen.delete(value);

    if (entries.length <= MAX_LOG_OBJECT_KEYS) return output;
    return {
        __happierRpcLogTruncated: TRUNCATION_MARKER,
        originalType: 'object',
        totalKeys: entries.length,
        shownKeys: Object.keys(output).length,
        value: output,
    };
}

function sanitizeCodexAppServerRpcLogValueInternal(value: unknown, state: SanitizerState, key?: string): unknown {
    if (value === null || value === undefined) return value;
    const sensitiveCategory = classifyRpcLogSensitiveKey(key);
    if (sensitiveCategory && !Array.isArray(value)) {
        return resolveConnectedServiceSensitiveDiagnosticMarker(sensitiveCategory);
    }
    if (typeof value === 'string') return sanitizeStringForRpcLog(value);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'symbol') return String(value);
    if (typeof value === 'function') return '[Function]';
    if (Array.isArray(value)) return sanitizeArrayForRpcLog(value, state, key);
    return sanitizeObjectForRpcLog(value, state);
}

export function sanitizeCodexAppServerRpcLogValue(value: unknown): unknown {
    return sanitizeCodexAppServerRpcLogValueInternal(value, { depth: 0, seen: new WeakSet<object>() });
}
