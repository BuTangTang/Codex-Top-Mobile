#!/usr/bin/env node
const http = require('http');

const port = Number.parseInt(process.argv[2], 10);
const knownHookEvents = new Set(['PermissionRequest', 'PreToolUse']);

// Args after the port: an optional hook event name, then either `--secret-file <path>` (current —
// keeps the secret off the world-visible command line) or a legacy inline secret value.
let hookEventName = '';
let secretFilePath = '';
let inlineSecret = '';
const restArgs = process.argv.slice(3);
for (let i = 0; i < restArgs.length; i += 1) {
    const arg = typeof restArgs[i] === 'string' ? restArgs[i] : '';
    if (arg === '--secret-file') {
        secretFilePath = typeof restArgs[i + 1] === 'string' ? restArgs[i + 1] : '';
        i += 1;
        continue;
    }
    if (!hookEventName && knownHookEvents.has(arg)) {
        hookEventName = arg;
        continue;
    }
    if (!inlineSecret && arg.length > 0) {
        inlineSecret = arg;
    }
}

let secret = inlineSecret;
if (secretFilePath) {
    try {
        secret = require('fs').readFileSync(secretFilePath, 'utf8').trim();
    } catch {
        // Unreadable secret file: fall through with whatever inline secret (if any) was provided;
        // the hook server rejects the request and the forwarder prints the safe fallback.
    }
}

function buildFallback() {
    return JSON.stringify({
        continue: true,
        suppressOutput: true,
        hookSpecificOutput: {
            hookEventName: hookEventName || 'PermissionRequest',
        },
    });
}

if (!port || Number.isNaN(port)) {
    process.stdout.write(buildFallback());
    process.exit(0);
}

const chunks = [];
process.stdin.on('data', (chunk) => {
    chunks.push(chunk);
});

process.stdin.on('end', () => {
    let body = Buffer.concat(chunks);
    if (hookEventName) {
        try {
            const parsed = JSON.parse(body.toString('utf8'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.hook_event_name !== 'string') {
                parsed.hook_event_name = hookEventName;
                body = Buffer.from(JSON.stringify(parsed), 'utf8');
            }
        } catch {
            // Preserve original payload if Claude sends unexpected data.
        }
    }

    const headers = {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
    };
    if (secret.length > 0) {
        headers['x-happier-hook-secret'] = secret;
    }

    const req = http.request(
        {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: '/hook/permission-request',
            headers,
        },
        (res) => {
            const responseChunks = [];
            res.on('data', (chunk) => {
                responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            res.on('end', () => {
                const statusCode = res.statusCode ?? 0;
                if (statusCode < 200 || statusCode >= 300) {
                    process.stdout.write(buildFallback());
                    return;
                }
                const payload = Buffer.concat(responseChunks).toString('utf8').trim();
                process.stdout.write(payload || buildFallback());
            });
        },
    );

    req.on('error', () => {
        process.stdout.write(buildFallback());
    });

    req.end(body);
});

process.stdin.resume();
