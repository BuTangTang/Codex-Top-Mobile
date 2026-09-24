import { Modal } from '@/modal';
import { t } from '@/text';
import type { NonSteerablePayloadReason } from '@/sync/domains/session/control/submitMode';

export type NonSteerableSendChoice =
    | 'apply_and_steer'
    | 'steer_without_applying'
    | 'interrupt_and_send'
    | 'queue'
    | 'cancel';

/**
 * Composer affordance for a busy send whose payload cannot steer the active turn (lane P,
 * O-design §2.2 stage 3): offers "Interrupt & send now" (reuses the existing `interrupt` delivery
 * mode — abort then send) vs "Queue for after turn" (the honest `server_pending` default).
 * Dismissal resolves as `cancel` so the caller leaves the composer untouched.
 *
 * Lane Q: when the backend publishes `inFlightConfigApplySupported` and the blocker is a mode
 * change, "Apply <setting> & steer now" lets the backend apply the mode to the RUNNING turn and
 * steer the text without interrupting. Never offered for special commands.
 *
 * Lane X (X3): honest labels only — the apply option NAMES the setting and value when the caller
 * provides labels, and "Steer now without applying" (Case B defer-and-steer) steers the TEXT only
 * while the setting stays desired-state and applies on the next message. The defer option is
 * available whenever steering itself is safe (mode-change blocker only — a special command's text
 * IS the command, so there is nothing to steer without it).
 */
export async function confirmNonSteerableSend(
    reason: NonSteerablePayloadReason,
    opts?: {
        offerApplyAndSteer?: boolean;
        offerSteerWithoutApplying?: boolean;
        /** Friendly setting name (e.g. "Permission mode") for the honest apply label. */
        settingLabel?: string;
        /** Friendly target value (e.g. "Plan") for the honest apply label. */
        valueLabel?: string;
    },
): Promise<NonSteerableSendChoice> {
    const offerApplyAndSteer = opts?.offerApplyAndSteer === true && reason === 'mode_change_refused';
    const offerSteerWithoutApplying = opts?.offerSteerWithoutApplying === true && reason === 'mode_change_refused';
    const messageKey = reason === 'special_command'
        ? 'agentInput.nonSteerableSend.specialCommandMessage'
        : reason === 'provider_config_change_refused'
            ? 'agentInput.nonSteerableSend.providerConfigMessage'
            : 'agentInput.nonSteerableSend.modeChangeMessage';
    const applyLabel = opts?.settingLabel && opts?.valueLabel
        ? t('agentInput.nonSteerableSend.applyNamedSettingAndSteer', {
            setting: opts.settingLabel,
            value: opts.valueLabel,
        })
        : t('agentInput.nonSteerableSend.applySettingAndSteer');
    return new Promise<NonSteerableSendChoice>((resolve) => {
        let settled = false;
        const choose = (choice: NonSteerableSendChoice) => {
            if (settled) return;
            settled = true;
            resolve(choice);
        };
        void Modal.alertAsync(
            t('agentInput.nonSteerableSend.title'),
            t(messageKey),
            [
                ...(offerApplyAndSteer
                    ? [{ text: applyLabel, onPress: () => choose('apply_and_steer') }]
                    : []),
                ...(offerSteerWithoutApplying
                    ? [{ text: t('agentInput.nonSteerableSend.steerWithoutApplying'), onPress: () => choose('steer_without_applying') }]
                    : []),
                { text: t('agentInput.nonSteerableSend.queueForAfterTurn'), onPress: () => choose('queue') },
                { text: t('agentInput.nonSteerableSend.interruptAndSend'), style: 'destructive', onPress: () => choose('interrupt_and_send') },
                { text: t('common.cancel'), style: 'cancel', onPress: () => choose('cancel') },
            ],
        ).then(() => choose('cancel'));
    });
}
