import * as React from 'react';
import { StyleSheet } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';

import { Text, type AppTextProps } from './Text';

export type EyebrowProps = AppTextProps;

const stylesheet = StyleSheet.create((theme) => ({
    text: {
        ...Typography.eyebrow(),
        color: theme.colors.text.secondary,
    },
}));

export function Eyebrow({ style, ...props }: EyebrowProps): React.ReactElement {
    const styles = stylesheet;
    return (
        <Text
            {...props}
            style={[styles.text, style]}
        />
    );
}
