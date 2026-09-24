import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
        translate: (key: string) => key,
    });
});

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            OS: 'ios',
            select: (options: any) => options.ios ?? options.default,
        },
        Alert: {
            alert: vi.fn(),
        },
    });
});

describe('confirmNonSteerableSend (lane P stage 3 affordance)', () => {
    beforeEach(async () => {
        const { Alert } = await import('react-native');
        (Alert as any).alert.mockClear();
    });

    async function present(reason: 'mode_change_refused' | 'special_command') {
        const { confirmNonSteerableSend } = await import('./confirmNonSteerableSend');
        const { Alert } = await import('react-native');
        const promise = confirmNonSteerableSend(reason);
        await Promise.resolve();
        const alertSpy = (Alert as any).alert as ReturnType<typeof vi.fn>;
        expect(alertSpy).toHaveBeenCalledTimes(1);
        const [title, message, buttons] = alertSpy.mock.calls[0] as [string, string, any[]];
        return { promise, title, message, buttons };
    }

    it('offers Queue / Interrupt & send / cancel and resolves queue', async () => {
        const { promise, title, message, buttons } = await present('mode_change_refused');
        expect(title).toBe('agentInput.nonSteerableSend.title');
        expect(message).toBe('agentInput.nonSteerableSend.modeChangeMessage');
        expect(buttons.map((b) => b.text)).toEqual([
            'agentInput.nonSteerableSend.queueForAfterTurn',
            'agentInput.nonSteerableSend.interruptAndSend',
            'common.cancel',
        ]);
        buttons[0].onPress();
        await expect(promise).resolves.toBe('queue');
    });

    it('resolves interrupt_and_send for the interrupt action', async () => {
        const { promise, buttons } = await present('mode_change_refused');
        buttons[1].onPress();
        await expect(promise).resolves.toBe('interrupt_and_send');
    });

    it('uses the special-command copy and resolves cancel on the cancel action', async () => {
        const { promise, message, buttons } = await present('special_command');
        expect(message).toBe('agentInput.nonSteerableSend.specialCommandMessage');
        buttons[2].onPress();
        await expect(promise).resolves.toBe('cancel');
    });

    async function presentWithApplyOffer(reason: 'mode_change_refused' | 'special_command') {
        const { confirmNonSteerableSend } = await import('./confirmNonSteerableSend');
        const { Alert } = await import('react-native');
        const promise = confirmNonSteerableSend(reason, { offerApplyAndSteer: true });
        await Promise.resolve();
        const alertSpy = (Alert as any).alert as ReturnType<typeof vi.fn>;
        const [, , buttons] = alertSpy.mock.calls[0] as [string, string, any[]];
        return { promise, buttons };
    }

    it('offers Apply setting & steer now first when the backend supports in-flight config apply (lane Q)', async () => {
        const { promise, buttons } = await presentWithApplyOffer('mode_change_refused');
        expect(buttons.map((b) => b.text)).toEqual([
            'agentInput.nonSteerableSend.applySettingAndSteer',
            'agentInput.nonSteerableSend.queueForAfterTurn',
            'agentInput.nonSteerableSend.interruptAndSend',
            'common.cancel',
        ]);
        buttons[0].onPress();
        await expect(promise).resolves.toBe('apply_and_steer');
    });

    it('never offers the apply option for special commands (lane Q)', async () => {
        const { buttons } = await presentWithApplyOffer('special_command');
        expect(buttons.map((b) => b.text)).toEqual([
            'agentInput.nonSteerableSend.queueForAfterTurn',
            'agentInput.nonSteerableSend.interruptAndSend',
            'common.cancel',
        ]);
    });

    async function presentFull(
        reason: 'mode_change_refused' | 'special_command',
        opts: Record<string, unknown>,
    ) {
        const { confirmNonSteerableSend } = await import('./confirmNonSteerableSend');
        const { Alert } = await import('react-native');
        const promise = confirmNonSteerableSend(reason, opts);
        await Promise.resolve();
        const alertSpy = (Alert as any).alert as ReturnType<typeof vi.fn>;
        const [, , buttons] = alertSpy.mock.calls[0] as [string, string, any[]];
        return { promise, buttons };
    }

    it('names the setting and value on the apply option when labels are provided (lane X, X3a)', async () => {
        const { promise, buttons } = await presentFull('mode_change_refused', {
            offerApplyAndSteer: true,
            settingLabel: 'Permission mode',
            valueLabel: 'Plan',
        });
        expect(buttons[0].text).toBe('agentInput.nonSteerableSend.applyNamedSettingAndSteer');
        buttons[0].onPress();
        await expect(promise).resolves.toBe('apply_and_steer');
    });

    it('offers "Steer now without applying" for a mode change whenever steering itself is safe (lane X, X3b)', async () => {
        const { promise, buttons } = await presentFull('mode_change_refused', {
            offerApplyAndSteer: true,
            offerSteerWithoutApplying: true,
        });
        expect(buttons.map((b) => b.text)).toEqual([
            'agentInput.nonSteerableSend.applySettingAndSteer',
            'agentInput.nonSteerableSend.steerWithoutApplying',
            'agentInput.nonSteerableSend.queueForAfterTurn',
            'agentInput.nonSteerableSend.interruptAndSend',
            'common.cancel',
        ]);
        buttons[1].onPress();
        await expect(promise).resolves.toBe('steer_without_applying');
    });

    it('offers the defer option even when in-flight apply is unsupported (its main value)', async () => {
        const { promise, buttons } = await presentFull('mode_change_refused', {
            offerSteerWithoutApplying: true,
        });
        expect(buttons.map((b) => b.text)).toEqual([
            'agentInput.nonSteerableSend.steerWithoutApplying',
            'agentInput.nonSteerableSend.queueForAfterTurn',
            'agentInput.nonSteerableSend.interruptAndSend',
            'common.cancel',
        ]);
        buttons[0].onPress();
        await expect(promise).resolves.toBe('steer_without_applying');
    });

    it('never offers the defer option for special commands (the text IS the command)', async () => {
        const { buttons } = await presentFull('special_command', {
            offerSteerWithoutApplying: true,
        });
        expect(buttons.map((b) => b.text)).toEqual([
            'agentInput.nonSteerableSend.queueForAfterTurn',
            'agentInput.nonSteerableSend.interruptAndSend',
            'common.cancel',
        ]);
    });
});
