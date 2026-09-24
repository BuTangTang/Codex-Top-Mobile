import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

export type PiRpcJsonlLineReader = {
  close: () => void;
};

export function attachPiRpcJsonlLineReader(
  stream: Readable,
  onLine: (line: string) => void,
): PiRpcJsonlLineReader {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let closed = false;

  const emitLine = (line: string): void => {
    onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
  };

  const processText = (text: string): void => {
    buffer += text;

    for (;;) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) return;

      emitLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
    }
  };

  const onData = (chunk: string | Buffer): void => {
    if (closed) return;
    processText(typeof chunk === 'string' ? chunk : decoder.write(chunk));
  };

  const onEnd = (): void => {
    if (closed) return;
    const remainingText = decoder.end();
    if (remainingText) processText(remainingText);
    if (buffer) {
      emitLine(buffer);
      buffer = '';
    }
  };

  stream.on('data', onData);
  stream.on('end', onEnd);

  return {
    close: () => {
      if (closed) return;
      closed = true;
      buffer = '';
      stream.off('data', onData);
      stream.off('end', onEnd);
    },
  };
}
