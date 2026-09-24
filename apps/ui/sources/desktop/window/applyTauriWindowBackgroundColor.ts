import { isTauriDesktop } from '@/utils/platform/tauri';

let lastAppliedColor: string | null = null;

function normalizeTauriWindowBackgroundColor(color: string): string | null {
    const trimmed = color.trim();
    if (/^#?([A-Fa-f0-9]{3}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/.test(trimmed)) {
        return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    }
    return null;
}

export async function applyTauriWindowBackgroundColor(color: string): Promise<boolean> {
    const normalized = normalizeTauriWindowBackgroundColor(color);
    if (!normalized || !isTauriDesktop()) {
        return false;
    }
    if (normalized === lastAppliedColor) {
        return true;
    }

    try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().setBackgroundColor(normalized);
        lastAppliedColor = normalized;
        return true;
    } catch {
        return false;
    }
}

