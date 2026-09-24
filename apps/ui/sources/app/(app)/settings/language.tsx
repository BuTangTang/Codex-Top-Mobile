import React from 'react';
import { Redirect } from 'expo-router';

/** 兼容旧语言页深链，返回外观设置；不写账号偏好，也不触发重启。 */
export default function LanguageSettingsScreen() {
    return <Redirect href="/settings/appearance" />;
}
