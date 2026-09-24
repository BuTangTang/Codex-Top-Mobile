import { Easing } from 'react-native-reanimated';

import { MOTION_STANDARD_BEZIER, motionTokens } from '@/components/ui/motion/motionTokens';

/**
 * 样板位移动效使用正式界面的同一条减速曲线，不再单独写弹跳弹簧。
 */
export const codexTopPreviewMoveEasing = Easing.bezier(
    MOTION_STANDARD_BEZIER[0],
    MOTION_STANDARD_BEZIER[1],
    MOTION_STANDARD_BEZIER[2],
    MOTION_STANDARD_BEZIER[3],
);

/**
 * 标签指示线的时长。减少动态效果时为 0，指示线直接出现在新标签下。
 */
export function codexTopPreviewMoveDuration(reducedMotion: boolean): number {
    return reducedMotion ? motionTokens.durationMs.instant : motionTokens.durationMs.base;
}

/**
 * 新消息淡入时长。减少动态效果时为 0，消息仍然立刻可见。
 */
export function codexTopPreviewFadeDuration(reducedMotion: boolean): number {
    return reducedMotion ? motionTokens.durationMs.instant : motionTokens.durationMs.fast;
}
