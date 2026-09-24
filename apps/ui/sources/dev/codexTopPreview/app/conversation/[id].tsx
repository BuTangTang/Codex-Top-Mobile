import { useLocalSearchParams, useRouter } from 'expo-router';

import { CodexTopConversationPane } from '../../ui/CodexTopConversationPane';

/**
 * 把路由参数收成一条会话 id。数组或空值都不当成有效会话。
 */
function readConversationId(raw: unknown): string {
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
    return '';
}

/**
 * 对话路由。返回能回到上一页时直接返回，否则回到会话首页。
 */
export default function CodexTopPreviewConversationRoute() {
    const params = useLocalSearchParams();
    const router = useRouter();

    function goBack(): void {
        if (router.canGoBack()) router.back();
        else router.replace('/');
    }

    return <CodexTopConversationPane sessionId={readConversationId(params.id)} onBack={goBack} />;
}
