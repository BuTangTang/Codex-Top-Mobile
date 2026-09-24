import { Stack } from 'expo-router';

const SETUP_INDEX_SCREEN_OPTIONS = {
    headerShown: false,
} as const;

export default function SetupLayout() {
    return (
        <Stack>
            <Stack.Screen
                name="index"
                options={SETUP_INDEX_SCREEN_OPTIONS}
            />
        </Stack>
    );
}
