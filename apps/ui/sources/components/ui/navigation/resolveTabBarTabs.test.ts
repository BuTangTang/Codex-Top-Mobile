import { describe, expect, it } from 'vitest';
import { resolveTabBarTabs } from './resolveTabBarTabs';

describe('resolveTabBarTabs', () => {
    it('keeps the three mobile destinations in task order', () => {
        expect(resolveTabBarTabs()).toEqual(['sessions', 'machines', 'settings']);
    });
});
