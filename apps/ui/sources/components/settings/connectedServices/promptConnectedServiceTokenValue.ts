import { Modal } from '@/modal';
import { t } from '@/text';

export type ConnectedServiceTokenKind = 'setup-token' | 'access-token' | 'api-key' | null;

export async function promptConnectedServiceTokenValue(tokenKind: ConnectedServiceTokenKind): Promise<string | null> {
  const token = await Modal.prompt(
    tokenKind === 'setup-token'
      ? t('connectedServices.detail.prompts.setupTokenTitle')
      : tokenKind === 'access-token'
        ? t('connectedServices.detail.prompts.accessTokenTitle')
        : t('connectedServices.detail.prompts.apiKeyTitle'),
    tokenKind === 'setup-token'
      ? t('connectedServices.detail.prompts.setupTokenBody')
      : tokenKind === 'access-token'
        ? t('connectedServices.detail.prompts.accessTokenBody')
        : t('connectedServices.detail.prompts.apiKeyBody'),
    {
      placeholder: tokenKind === 'setup-token'
        ? t('connectedServices.detail.prompts.setupTokenPlaceholder')
        : tokenKind === 'access-token'
          ? t('connectedServices.detail.prompts.accessTokenPlaceholder')
          : t('connectedServices.detail.prompts.apiKeyPlaceholder'),
      confirmText: t('common.save'),
      cancelText: t('common.cancel'),
    },
  );
  const value = typeof token === 'string' ? token.trim() : '';
  return value || null;
}
