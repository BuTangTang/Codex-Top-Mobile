import { Platform } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Passive settled keyboard-height signal for chrome visibility and non-frame-critical layout.
 *
 * Do not use this hook for chat/session composer positioning or keyboard animation.
 * Composer surfaces should consume the session keyboard scaffold so Reanimated/RNKC
 * can own frame-accurate movement without React renders during the keyboard transition.
 */
export function useKeyboardHeight(): number {
    const safeArea = useSafeAreaInsets();
    const keyboard = useKeyboardState();

    if (!keyboard.isVisible) return 0;

    // On iOS, `react-native-keyboard-controller`'s `height` includes the bottom safe area inset.
    // On Android (edge-to-edge mode), it does not — subtracting it would under-report the height.
    const deduction = Platform.OS === 'ios' ? safeArea.bottom : 0;
    return Math.max(0, keyboard.height - deduction);
}
