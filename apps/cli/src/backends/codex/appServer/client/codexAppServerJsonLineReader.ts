type JsonLineHandler = (rawLine: string) => void;

export type CodexAppServerJsonLineReaderOptions = Readonly<{
    maxBufferedChars?: number | null;
    onOversizedLine?: (sample: string, maxBufferedChars: number) => void;
}>;

export function createCodexAppServerJsonLineReader(
    onLine: JsonLineHandler,
    options: CodexAppServerJsonLineReaderOptions = {},
): Readonly<{
    push: (chunk: string) => void;
}> {
    let chunks: string[] = [];
    let bufferedChars = 0;
    let discardingOversizedLine = false;
    let lineStartSample = '';
    const maxLineStartSampleChars = 4096;
    const maxBufferedChars = typeof options.maxBufferedChars === 'number'
        && Number.isFinite(options.maxBufferedChars)
        && options.maxBufferedChars > 0
        ? Math.trunc(options.maxBufferedChars)
        : null;

    const clearBufferedLine = (): void => {
        chunks = [];
        bufferedChars = 0;
        lineStartSample = '';
    };

    const appendSegment = (segment: string): void => {
        if (segment.length === 0) return;
        if (discardingOversizedLine) return;
        if (lineStartSample.length < maxLineStartSampleChars) {
            lineStartSample += segment.slice(0, maxLineStartSampleChars - lineStartSample.length);
        }
        if (maxBufferedChars !== null && bufferedChars + segment.length > maxBufferedChars) {
            const sample = lineStartSample;
            clearBufferedLine();
            discardingOversizedLine = true;
            options.onOversizedLine?.(sample, maxBufferedChars);
            return;
        }
        chunks.push(segment);
        bufferedChars += segment.length;
    };

    const consumeBufferedLine = (): string => {
        if (chunks.length === 0) return '';
        if (chunks.length === 1) {
            const only = chunks[0] ?? '';
            clearBufferedLine();
            return only;
        }
        const line = chunks.join('');
        clearBufferedLine();
        return line;
    };

    const emitLine = (): void => {
        const rawLine = consumeBufferedLine();
        if (rawLine.length === 0) return;
        if (rawLine.length <= 256 && rawLine.trim().length === 0) return;
        onLine(rawLine);
    };

    return {
        push: (chunk: string): void => {
            let startIndex = 0;
            for (;;) {
                const newlineIndex = chunk.indexOf('\n', startIndex);
                if (newlineIndex === -1) {
                    appendSegment(chunk.slice(startIndex));
                    return;
                }

                appendSegment(chunk.slice(startIndex, newlineIndex));
                if (discardingOversizedLine) {
                    discardingOversizedLine = false;
                    clearBufferedLine();
                } else {
                    emitLine();
                }
                startIndex = newlineIndex + 1;
                if (startIndex >= chunk.length) {
                    return;
                }
            }
        },
    };
}
