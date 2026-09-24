import { describe, expect, it, vi } from 'vitest';

import { logNativeUpdateFetchFailure } from './logNativeUpdateFetchFailure';

describe('logNativeUpdateFetchFailure', () => {
    it('logs background native update failures without writing to console error', () => {
        const logger = { log: vi.fn() };
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const error = new Error('Timed out waiting for server reachability');
        error.name = 'ServerFetchConnectivityTimeoutError';

        logNativeUpdateFetchFailure(error, logger);

        expect(logger.log).toHaveBeenCalledWith(
            '[fetchNativeUpdate] Error: ServerFetchConnectivityTimeoutError: Timed out waiting for server reachability',
        );
        expect(consoleError).not.toHaveBeenCalled();

        consoleError.mockRestore();
    });
});
