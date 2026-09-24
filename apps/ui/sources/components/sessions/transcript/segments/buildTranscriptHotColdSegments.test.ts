import { describe, expect, it } from 'vitest';

import { buildTranscriptHotColdSegments, NATIVE_LIVE_TAIL_SAFETY_CEILING_ITEMS } from './buildTranscriptHotColdSegments';

describe('buildTranscriptHotColdSegments', () => {
    it('keeps the newest tail items hot and older items cold', () => {
        const result = buildTranscriptHotColdSegments({
            enabled: true,
            hotTailItemCount: 2,
            items: [
                { kind: 'message', id: 'm1', messageId: 'm1' },
                { kind: 'message', id: 'm2', messageId: 'm2' },
                { kind: 'message', id: 'm3', messageId: 'm3' },
                { kind: 'message', id: 'm4', messageId: 'm4' },
            ],
            activeThinkingMessageId: null,
            expandedToolCallsAnchorMessageIds: new Set<string>(),
        });

        expect(result.coldItems.map((item) => item.id)).toEqual(['m1', 'm2']);
        expect(result.hotItems.map((item) => item.id)).toEqual(['m3', 'm4']);
    });

    it('widens the hot segment to keep an active thinking row in the live tail', () => {
        const result = buildTranscriptHotColdSegments({
            enabled: true,
            hotTailItemCount: 1,
            items: [
                { kind: 'message', id: 'm1', messageId: 'm1' },
                { kind: 'message', id: 'm2', messageId: 'm2' },
                { kind: 'message', id: 'm3', messageId: 'm3' },
            ],
            activeThinkingMessageId: 'm2',
            expandedToolCallsAnchorMessageIds: new Set<string>(),
        });

        expect(result.coldItems.map((item) => item.id)).toEqual(['m1']);
        expect(result.hotItems.map((item) => item.id)).toEqual(['m2', 'm3']);
    });

    it('widens the hot segment to keep expanded tool groups in the live tail', () => {
        const result = buildTranscriptHotColdSegments({
            enabled: true,
            hotTailItemCount: 1,
            items: [
                { kind: 'message', id: 'm1', messageId: 'm1' },
                { kind: 'tool-calls-group', id: 'tools-1', toolMessageIds: ['tool-1', 'tool-2'] },
                { kind: 'message', id: 'm2', messageId: 'm2' },
            ],
            activeThinkingMessageId: null,
            expandedToolCallsAnchorMessageIds: new Set<string>(['tool-2']),
        });

        expect(result.coldItems.map((item) => item.id)).toEqual(['m1']);
        expect(result.hotItems.map((item) => item.id)).toEqual(['tools-1', 'm2']);
    });

    it('widens the hot segment to keep expanded tool-group unit rows in the live tail (N2c)', () => {
        const groupId = 'toolCalls:turn:x:tool-1';
        const toolMessageIds = ['tool-1', 'tool-2'];
        const result = buildTranscriptHotColdSegments({
            enabled: true,
            hotTailItemCount: 1,
            items: [
                { kind: 'message', id: 'm1', messageId: 'm1' },
                { kind: 'tool-group-header', id: `${groupId}#header`, toolMessageIds },
                { kind: 'tool-group-tool', id: `${groupId}#tool:tool-1`, toolMessageId: 'tool-1', toolMessageIds },
                { kind: 'tool-group-tool', id: `${groupId}#tool:tool-2`, toolMessageId: 'tool-2', toolMessageIds },
                { kind: 'tool-group-footer', id: `${groupId}#footer`, toolMessageIds },
                { kind: 'message', id: 'm2', messageId: 'm2' },
            ],
            activeThinkingMessageId: null,
            expandedToolCallsAnchorMessageIds: new Set<string>(['tool-2']),
        });

        expect(result.coldItems.map((item) => item.id)).toEqual(['m1']);
        expect(result.hotItems.map((item) => item.id)).toEqual([
            `${groupId}#header`,
            `${groupId}#tool:tool-1`,
            `${groupId}#tool:tool-2`,
            `${groupId}#footer`,
            'm2',
        ]);
    });

    it('leaves collapsed tool-group unit rows in the cold segment (N2c)', () => {
        const groupId = 'toolCalls:turn:x:tool-1';
        const toolMessageIds = ['tool-1', 'tool-2'];
        const result = buildTranscriptHotColdSegments({
            enabled: true,
            hotTailItemCount: 1,
            items: [
                { kind: 'tool-group-header', id: `${groupId}#header`, toolMessageIds },
                { kind: 'tool-group-expand', id: `${groupId}#expand`, toolMessageIds },
                { kind: 'tool-group-tool', id: `${groupId}#tool:tool-2`, toolMessageId: 'tool-2', toolMessageIds },
                { kind: 'tool-group-footer', id: `${groupId}#footer`, toolMessageIds },
                { kind: 'message', id: 'm2', messageId: 'm2' },
            ],
            activeThinkingMessageId: null,
            expandedToolCallsAnchorMessageIds: new Set<string>(),
        });

        expect(result.hotItems.map((item) => item.id)).toEqual(['m2']);
    });

    it('keeps pending queues and action drafts in the hot tail even when the tail window is small', () => {
        const result = buildTranscriptHotColdSegments({
            enabled: true,
            hotTailItemCount: 1,
            items: [
                { kind: 'message', id: 'm1', messageId: 'm1' },
                { kind: 'pending-queue', id: 'pending-queue' },
                { kind: 'action-draft', id: 'draft:1' },
            ],
            activeThinkingMessageId: null,
            expandedToolCallsAnchorMessageIds: new Set<string>(),
        });

        expect(result.coldItems.map((item) => item.id)).toEqual(['m1']);
        expect(result.hotItems.map((item) => item.id)).toEqual(['pending-queue', 'draft:1']);
    });

    it('keeps fork dividers with the hot child transcript items', () => {
        const result = buildTranscriptHotColdSegments({
            enabled: true,
            hotTailItemCount: 1,
            items: [
                { kind: 'message', id: 'parent-message', messageId: 'parent-message' },
                { kind: 'fork-divider', id: 'fork-divider:parent:child' },
                { kind: 'message', id: 'child-message', messageId: 'child-message' },
            ],
            activeThinkingMessageId: null,
            expandedToolCallsAnchorMessageIds: new Set<string>(),
        });

        expect(result.coldItems.map((item) => item.id)).toEqual(['parent-message']);
        expect(result.hotItems.map((item) => item.id)).toEqual(['fork-divider:parent:child', 'child-message']);
    });

    it('carves only the single live-tail item when hotTailItemCount is 1 (native Phase-1 scope)', () => {
        const result = buildTranscriptHotColdSegments({
            enabled: true,
            hotTailItemCount: 1,
            items: [
                { kind: 'message', id: 'm1', messageId: 'm1' },
                { kind: 'message', id: 'm2', messageId: 'm2' },
                { kind: 'message', id: 'm3', messageId: 'm3' },
            ],
            activeThinkingMessageId: null,
            expandedToolCallsAnchorMessageIds: new Set<string>(),
        });

        expect(result.coldItems.map((item) => item.id)).toEqual(['m1', 'm2']);
        expect(result.hotItems.map((item) => item.id)).toEqual(['m3']);
        expect(result.splitIndex).toBe(2);
    });

    it('is platform-agnostic: the same canonical oldest-first input yields the same split for web and native', () => {
        // Web and native now both segment in canonical oldest-first space (then orient per platform).
        // The policy is a pure function of the input, so identical input MUST give identical output —
        // the property both adapters rely on.
        const items = [
            { kind: 'message', id: 'm1', messageId: 'm1' },
            { kind: 'message', id: 'm2', messageId: 'm2' },
            { kind: 'message', id: 'm3', messageId: 'm3' },
            { kind: 'message', id: 'm4', messageId: 'm4' },
        ] as const;
        const common = {
            enabled: true as const,
            hotTailItemCount: 1,
            items,
            activeThinkingMessageId: null,
            expandedToolCallsAnchorMessageIds: new Set<string>(),
        };

        const first = buildTranscriptHotColdSegments(common);
        const second = buildTranscriptHotColdSegments(common);

        expect(first.coldItems.map((item) => item.id)).toEqual(second.coldItems.map((item) => item.id));
        expect(first.hotItems.map((item) => item.id)).toEqual(second.hotItems.map((item) => item.id));
        expect(first.splitIndex).toBe(second.splitIndex);
        expect(first.hotItems.map((item) => item.id)).toEqual(['m4']);
    });

    it('leaves the transcript unsplit when disabled', () => {
        const result = buildTranscriptHotColdSegments({
            enabled: false,
            hotTailItemCount: 2,
            items: [
                { kind: 'message', id: 'm1', messageId: 'm1' },
                { kind: 'message', id: 'm2', messageId: 'm2' },
            ],
            activeThinkingMessageId: null,
            expandedToolCallsAnchorMessageIds: new Set<string>(),
        });

        expect(result.coldItems.map((item) => item.id)).toEqual(['m1', 'm2']);
        expect(result.hotItems).toEqual([]);
    });

    it('keeps at least one item cold when segmentation is enabled', () => {
        const result = buildTranscriptHotColdSegments({
            enabled: true,
            hotTailItemCount: 999,
            items: [
                { kind: 'message', id: 'm1', messageId: 'm1' },
                { kind: 'message', id: 'm2', messageId: 'm2' },
            ],
            activeThinkingMessageId: null,
            expandedToolCallsAnchorMessageIds: new Set<string>(),
        });

        expect(result.coldItems.length).toBe(1);
        expect(result.hotItems.map((item) => item.id)).toEqual(['m2']);
    });

    it('bounds the native hot tail to maxHotTailItems even when an early active item would pull the split', () => {
        // An early pending-queue (index 1) normally pulls the split to index 1, ballooning the hot
        // tail to nearly the whole transcript — the device-proven native un-virtualization bug
        // (~46 screens rendered outside the recycler → blank/jank). maxHotTailItems caps the hot
        // tail to the trailing window regardless of pullers.
        const items = [
            { kind: 'message', id: 'm1', messageId: 'm1' },
            { kind: 'pending-queue', id: 'pending-queue' },
            { kind: 'message', id: 'm2', messageId: 'm2' },
            { kind: 'message', id: 'm3', messageId: 'm3' },
            { kind: 'message', id: 'm4', messageId: 'm4' },
        ] as const;

        // Web path (no cap): the early pending-queue pulls the split, ballooning the hot tail.
        const uncapped = buildTranscriptHotColdSegments({
            enabled: true,
            hotTailItemCount: 1,
            items,
            activeThinkingMessageId: null,
            expandedToolCallsAnchorMessageIds: new Set<string>(),
        });
        expect(uncapped.hotItems.map((item) => item.id)).toEqual(['pending-queue', 'm2', 'm3', 'm4']);

        // Native path (cap=2): the hot tail is bounded to the trailing 2 rows; the early pending
        // stays cold.
        const capped = buildTranscriptHotColdSegments({
            enabled: true,
            hotTailItemCount: 1,
            maxHotTailItems: 2,
            items,
            activeThinkingMessageId: null,
            expandedToolCallsAnchorMessageIds: new Set<string>(),
        });
        expect(capped.hotItems.map((item) => item.id)).toEqual(['m3', 'm4']);
        expect(capped.coldItems.map((item) => item.id)).toEqual(['m1', 'pending-queue', 'm2']);
        expect(capped.splitIndex).toBe(3);
    });

    it('treats maxHotTailItems as a ceiling, not a floor: pullers still apply within the bound', () => {
        // cap=10 is larger than anything the pullers want, so the expanded tool group is still hot.
        const result = buildTranscriptHotColdSegments({
            enabled: true,
            hotTailItemCount: 1,
            maxHotTailItems: 10,
            items: [
                { kind: 'message', id: 'm1', messageId: 'm1' },
                { kind: 'tool-calls-group', id: 'tools-1', toolMessageIds: ['tool-2'] },
                { kind: 'message', id: 'm2', messageId: 'm2' },
            ],
            activeThinkingMessageId: null,
            expandedToolCallsAnchorMessageIds: new Set<string>(['tool-2']),
        });

        expect(result.hotItems.map((item) => item.id)).toEqual(['tools-1', 'm2']);
    });

    describe('liveTailOnly (native edge-slot carve)', () => {
        it('carves NOTHING when no row is streaming — idle sessions get an empty hot tail', () => {
            // The device repro: an idle session ending in tool rows must NOT carve them into the edge
            // slot (they orphaned/persisted at the bottom). liveTailOnly + no activeThinkingMessageId
            // = empty hot, everything cold (normal rendering).
            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 4,
                maxHotTailItems: 4,
                liveTailOnly: true,
                items: [
                    { kind: 'message', id: 'm1', messageId: 'm1' },
                    { kind: 'message', id: 'm2', messageId: 'm2' },
                    { kind: 'tool-calls-group', id: 'tools-1', toolMessageIds: ['t1'] },
                    { kind: 'tool-calls-group', id: 'tools-2', toolMessageIds: ['t2'] },
                ],
                activeThinkingMessageId: null,
                expandedToolCallsAnchorMessageIds: new Set<string>(),
            });

            expect(result.hotItems).toEqual([]);
            expect(result.coldItems.map((item) => item.id)).toEqual(['m1', 'm2', 'tools-1', 'tools-2']);
            expect(result.splitIndex).toBe(4);
        });

        it('carves only the streaming row to the end — older completed rows stay cold', () => {
            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 1,
                maxHotTailItems: 4,
                liveTailOnly: true,
                liveTailAnchorMessageId: 'm2',
                items: [
                    { kind: 'message', id: 'm1', messageId: 'm1' },
                    { kind: 'tool-calls-group', id: 'tools-1', toolMessageIds: ['t1'] },
                    { kind: 'message', id: 'm2', messageId: 'm2' }, // actively streaming
                    { kind: 'pending-queue', id: 'pending' },
                ],
                activeThinkingMessageId: null,
                expandedToolCallsAnchorMessageIds: new Set<string>(),
            });

            // The completed tool group above the streaming row stays in the recycler (cold);
            // the streaming row and what follows it are the live tail (hot, in real layout).
            expect(result.coldItems.map((item) => item.id)).toEqual(['m1', 'tools-1']);
            expect(result.hotItems.map((item) => item.id)).toEqual(['m2', 'pending']);
        });

        it('uses running tool-call rows as native live-tail anchors without requiring thinking pulse', () => {
            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 1,
                maxHotTailItems: 4,
                liveTailOnly: true,
                liveTailAnchorMessageId: 'tool-2',
                items: [
                    { kind: 'message', id: 'm1', messageId: 'm1' },
                    { kind: 'tool-group-header', id: 'tools#header', toolMessageIds: ['tool-1', 'tool-2'] },
                    { kind: 'tool-group-tool', id: 'tools#tool:tool-1', toolMessageId: 'tool-1', toolMessageIds: ['tool-1', 'tool-2'] },
                    { kind: 'tool-group-tool', id: 'tools#tool:tool-2', toolMessageId: 'tool-2', toolMessageIds: ['tool-1', 'tool-2'] },
                    { kind: 'tool-group-footer', id: 'tools#footer', toolMessageIds: ['tool-1', 'tool-2'] },
                ],
                activeThinkingMessageId: null,
                expandedToolCallsAnchorMessageIds: new Set<string>(),
            });

            expect(result.coldItems.map((item) => item.id)).toEqual(['m1']);
            expect(result.hotItems.map((item) => item.id)).toEqual([
                'tools#header',
                'tools#tool:tool-1',
                'tools#tool:tool-2',
                'tools#footer',
            ]);
        });

        it('finds the streaming row inside a turn item', () => {
            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 1,
                maxHotTailItems: 4,
                liveTailOnly: true,
                liveTailAnchorMessageId: 'stream-msg',
                items: [
                    { kind: 'message', id: 'm1', messageId: 'm1' },
                    { kind: 'turn', id: 'turn-live', turn: { userMessageId: 'u1', content: [{ kind: 'message', messageId: 'stream-msg' }] } },
                ],
                activeThinkingMessageId: null,
                expandedToolCallsAnchorMessageIds: new Set<string>(),
            });

            expect(result.coldItems.map((item) => item.id)).toEqual(['m1']);
            expect(result.hotItems.map((item) => item.id)).toEqual(['turn-live']);
        });

        it('falls back to the active thinking message id when no explicit live-tail anchor is given', () => {
            // THINKING coverage: during a thinking pulse there is no streaming agent-text/tool row,
            // but activeThinkingMessageId points at the live thinking row. The carve must engage there.
            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 1,
                maxHotTailItems: 4,
                liveTailOnly: true,
                items: [
                    { kind: 'message', id: 'm1', messageId: 'm1' },
                    { kind: 'message', id: 'm2', messageId: 'm2' }, // thinking row (last committed)
                ],
                activeThinkingMessageId: 'm2',
                expandedToolCallsAnchorMessageIds: new Set<string>(),
            });

            expect(result.coldItems.map((item) => item.id)).toEqual(['m1']);
            expect(result.hotItems.map((item) => item.id)).toEqual(['m2']);
        });

        it('includes a trailing pending-queue and action-draft in the live tail when a row is streaming', () => {
            // PENDING / DRAFT coverage: pending/draft do not open the carve on their own (next test),
            // but once a row streams the carve runs anchor→end, so a trailing pending-queue and an
            // action-draft below the streaming row must render with it in real layout.
            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 1,
                maxHotTailItems: 4,
                liveTailOnly: true,
                liveTailAnchorMessageId: 'm2',
                items: [
                    { kind: 'message', id: 'm1', messageId: 'm1' },
                    { kind: 'message', id: 'm2', messageId: 'm2' }, // actively streaming
                    { kind: 'pending-queue', id: 'pending' },
                    { kind: 'action-draft', id: 'draft:1' },
                ],
                activeThinkingMessageId: null,
                expandedToolCallsAnchorMessageIds: new Set<string>(),
            });

            expect(result.coldItems.map((item) => item.id)).toEqual(['m1']);
            expect(result.hotItems.map((item) => item.id)).toEqual(['m2', 'pending', 'draft:1']);
        });

        it('does NOT pull expanded/pending/fork rows hot on its own (only the streaming row does)', () => {
            // Without an active stream, an expanded tool group / pending must NOT open the carve.
            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 1,
                maxHotTailItems: 4,
                liveTailOnly: true,
                items: [
                    { kind: 'message', id: 'm1', messageId: 'm1' },
                    { kind: 'tool-calls-group', id: 'tools-1', toolMessageIds: ['t1'] },
                    { kind: 'pending-queue', id: 'pending' },
                ],
                activeThinkingMessageId: null,
                expandedToolCallsAnchorMessageIds: new Set<string>(['t1']),
            });

            expect(result.hotItems).toEqual([]);
        });

        it('keeps the WHOLE live region hot when it exceeds maxHotTailItems — the cap never clips the growing run (R3)', () => {
            // The live region [anchor, end] is the genuinely-active turn: the per-token-growing
            // row(s) plus their trailing rows. When that region is LARGER than the native cap, the
            // old `Math.max(activeIndex, length - cap)` pushed the split PAST the anchor and dropped
            // the EARLIEST growing rows (including the streaming anchor) into the cold recycler —
            // re-exposing the exact overlap the carve exists to kill. The cap must only bound a
            // PATHOLOGICAL tail (next test); it must NEVER clip the live region itself.
            const items = [
                { kind: 'message', id: 'settled', messageId: 'settled' },
                { kind: 'message', id: 's1', messageId: 's1' }, // anchor = oldest streaming row of the turn
                { kind: 'message', id: 's2', messageId: 's2' },
                { kind: 'message', id: 's3', messageId: 's3' },
                { kind: 'message', id: 's4', messageId: 's4' },
                { kind: 'message', id: 's5', messageId: 's5' }, // newest, actively growing
            ];

            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 1,
                maxHotTailItems: 4, // live region (s1..s5 = 5) > cap 4
                liveTailOnly: true,
                liveTailAnchorMessageId: 's1',
                items,
                activeThinkingMessageId: null,
                expandedToolCallsAnchorMessageIds: new Set<string>(),
            });

            // The growing anchor s1 AND the newest growing s5 are both hot; only the settled older row is cold.
            expect(result.hotItems.map((item) => item.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
            expect(result.coldItems.map((item) => item.id)).toEqual(['settled']);
            expect(result.splitIndex).toBe(1);
        });

        it('bounds a PATHOLOGICAL huge live region by the safety ceiling, keeping the newest growing tail hot (device-jank guard)', () => {
            // A stale anchor detected far up a huge transcript (e.g. an interrupted turn left flagged
            // streaming) must NOT un-virtualize dozens of screens in the edge slot (the ~46-screen
            // device jank). The safety ceiling clips the OLDEST part of the live region while the
            // newest growing rows — always at the tail — stay hot.
            const items = Array.from({ length: 80 }, (_, index) => ({
                kind: 'message' as const,
                id: `m${index}`,
                messageId: `m${index}`,
            }));

            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 1,
                maxHotTailItems: 4,
                liveTailOnly: true,
                liveTailAnchorMessageId: 'm0', // pathological: anchor at the very top
                items,
                activeThinkingMessageId: null,
                expandedToolCallsAnchorMessageIds: new Set<string>(),
            });

            // Hot tail bounded to the safety ceiling (not all 80 rows); the newest row is always hot.
            expect(result.hotItems.length).toBe(NATIVE_LIVE_TAIL_SAFETY_CEILING_ITEMS);
            expect(result.hotItems[result.hotItems.length - 1]!.id).toBe('m79');
            expect(result.coldItems.length).toBe(80 - NATIVE_LIVE_TAIL_SAFETY_CEILING_ITEMS);
        });

        it('honors a user-raised maxHotTailItems above the safety ceiling as the live-region bound', () => {
            // When a user configures a native hot-tail count LARGER than the default safety ceiling,
            // that explicit choice becomes the bound — the ceiling is only a generous floor.
            const length = NATIVE_LIVE_TAIL_SAFETY_CEILING_ITEMS + 40;
            const items = Array.from({ length }, (_, index) => ({
                kind: 'message' as const,
                id: `m${index}`,
                messageId: `m${index}`,
            }));
            const largeCap = NATIVE_LIVE_TAIL_SAFETY_CEILING_ITEMS + 20;

            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 1,
                maxHotTailItems: largeCap,
                liveTailOnly: true,
                liveTailAnchorMessageId: 'm0',
                items,
                activeThinkingMessageId: null,
                expandedToolCallsAnchorMessageIds: new Set<string>(),
            });

            expect(result.hotItems.length).toBe(largeCap);
            expect(result.hotItems[result.hotItems.length - 1]!.id).toBe(`m${length - 1}`);
        });

        it('does NOT carve when the anchor is the FIRST row and the whole window is the live region (activeIndex==0 degenerate)', () => {
            // FIX 3: the anchor is the oldest matching row of the live region (the first streaming /
            // running / thinking / floor row). When it lands at index 0 the whole window [0, end] is
            // the live region. The never-empty-cold clamp would push index 0 — the GROWING anchor —
            // into the cold recycler (here the trailing pending bubble does not grow, so the only
            // growing row IS the index-0 anchor), re-exposing the exact overlap the carve exists to
            // kill. There is no settled cold body below the anchor to protect, so the carve provides no
            // value here; the safe behavior is to NOT carve and leave the growing row in the recycler
            // under C1's monotonic height floor.
            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 1,
                maxHotTailItems: 4,
                liveTailOnly: true,
                liveTailAnchorMessageId: 'm0', // anchor at index 0 (the growing streaming row)
                items: [
                    { kind: 'message', id: 'm0', messageId: 'm0' }, // actively streaming, at index 0
                    { kind: 'pending-queue', id: 'pending' }, // static trailing bubble (does not grow)
                ],
                activeThinkingMessageId: null,
                expandedToolCallsAnchorMessageIds: new Set<string>(),
            });

            // No carve: the growing anchor is never clamped into cold. Everything stays in the recycler.
            expect(result.hotItems).toEqual([]);
            expect(result.coldItems.map((item) => item.id)).toEqual(['m0', 'pending']);
            expect(result.splitIndex).toBe(2);
        });

        it('does NOT carve when the streaming anchor is the only/first row of a multi-row window (activeIndex==0)', () => {
            // FIX 3: even a multi-row live region rooted at index 0 (a growing answer immediately
            // followed by its action draft) must not clamp the growing anchor into cold. The carve only
            // engages when a genuine settled cold body precedes the anchor (activeIndex > 0).
            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 1,
                maxHotTailItems: 4,
                liveTailOnly: true,
                liveTailAnchorMessageId: 'm0',
                items: [
                    { kind: 'message', id: 'm0', messageId: 'm0' }, // streaming, index 0
                    { kind: 'pending-queue', id: 'pending' },
                    { kind: 'action-draft', id: 'draft:1' },
                ],
                activeThinkingMessageId: null,
                expandedToolCallsAnchorMessageIds: new Set<string>(),
            });

            expect(result.hotItems).toEqual([]);
            expect(result.coldItems.map((item) => item.id)).toEqual(['m0', 'pending', 'draft:1']);
            expect(result.splitIndex).toBe(3);
        });

        it('leaves the growing newest row uncarved in a fresh/short window where it is the oldest item (Finding 4 — documented narrow edge)', () => {
            // FRESH-FIRST-ROW GAP (audit Finding 4). The narrowest exposure of activeIndex==0: a fresh
            // or short native session whose OLDEST WINDOWED item is itself the (per-token growing) live
            // anchor — e.g. the first agent turn of a new session, before any older page has loaded.
            //
            // Two independently-correct behaviors compose into a 1-frame edge:
            //   (1) the carve does NOT engage here (activeIndex==0, no settled cold body to protect):
            //       carving would clamp the growing anchor into cold and re-expose the exact overlap the
            //       carve exists to kill — this assertion pins that.
            //   (2) the C1 measurement reconciler reserves NOTHING for a never-measured row (a deliberate
            //       contract — seeding a per-type/median first-paint height is the REVERTED
            //       over-reservation regression, TRACKING.md §17). So on the VERY FIRST paint the growing
            //       row has neither a carve nor a height floor; the per-item floor only protects frame 2+.
            //
            // DECISION (LEFT ALONE, documented narrow edge — like the web jiggle): there is no
            // high-confidence safe fix. Carving here is unsafe (clamps the growing anchor → overlap), and
            // the only other lever — seeding a synthetic first-paint height — is exactly the forbidden
            // median/global-seed path. The first frame has no prior measurement to floor against by
            // definition; subsequent frames are protected by C1's per-item monotonic floor. This test is
            // the boundary marker: if a future change makes the builder carve (or otherwise alter) this
            // shape, it must be a deliberate, separately-validated decision.
            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 1,
                maxHotTailItems: 4,
                liveTailOnly: true,
                liveTailAnchorMessageId: 'm0', // the growing newest row, also the oldest windowed item
                items: [
                    { kind: 'message', id: 'm0', messageId: 'm0' }, // streaming + newest + oldest (index 0)
                ],
                activeThinkingMessageId: null,
                expandedToolCallsAnchorMessageIds: new Set<string>(),
            });

            // No carve: the lone growing row stays in the recycler (single-item window short-circuit and
            // the activeIndex==0 guard both forbid clamping it into cold). Protection for its first paint
            // is delegated to FlashList's natural onLayout; subsequent frames to C1's per-item floor.
            expect(result.hotItems).toEqual([]);
            expect(result.coldItems.map((item) => item.id)).toEqual(['m0']);
            expect(result.splitIndex).toBe(1);
        });

        it('does not carve when a growing newest anchor at index 0 is followed by a second growing row (fresh two-row window)', () => {
            // Finding 4 (multi-row variant): a fresh session whose window is [growing-answer,
            // growing-answer-continuation] with the anchor at index 0 still must not clamp the growing
            // anchor into cold. Documents that the edge is not specific to a single-row window — any
            // window rooted at a growing index-0 anchor stays uncarved (no first-frame floor either).
            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 1,
                maxHotTailItems: 4,
                liveTailOnly: true,
                liveTailAnchorMessageId: 'm0',
                items: [
                    { kind: 'message', id: 'm0', messageId: 'm0' }, // streaming anchor, index 0
                    { kind: 'message', id: 'm1', messageId: 'm1' }, // newest growing continuation
                ],
                activeThinkingMessageId: null,
                expandedToolCallsAnchorMessageIds: new Set<string>(),
            });

            expect(result.hotItems).toEqual([]);
            expect(result.coldItems.map((item) => item.id)).toEqual(['m0', 'm1']);
            expect(result.splitIndex).toBe(2);
        });

        it('still carves with index 0 cold when a settled row precedes the anchor (activeIndex==1 positive control)', () => {
            // The complement of the activeIndex==0 case: a settled older row at index 0 gives the carve
            // a real cold body to protect, so the growing anchor at index 1 onward is carved hot while
            // the settled row stays cold. This is the value case the carve exists for.
            const result = buildTranscriptHotColdSegments({
                enabled: true,
                hotTailItemCount: 1,
                maxHotTailItems: 4,
                liveTailOnly: true,
                liveTailAnchorMessageId: 'm1',
                items: [
                    { kind: 'message', id: 'm0', messageId: 'm0' }, // settled, index 0
                    { kind: 'message', id: 'm1', messageId: 'm1' }, // streaming, index 1
                    { kind: 'pending-queue', id: 'pending' },
                ],
                activeThinkingMessageId: null,
                expandedToolCallsAnchorMessageIds: new Set<string>(),
            });

            expect(result.coldItems.map((item) => item.id)).toEqual(['m0']);
            expect(result.hotItems.map((item) => item.id)).toEqual(['m1', 'pending']);
            expect(result.splitIndex).toBe(1);
        });
    });
});
