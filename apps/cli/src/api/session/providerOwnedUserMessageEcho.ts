import type { Update, UserMessage } from '../types';

export type ProviderOwnedUserMessageEchoClassifier = (
  message: UserMessage,
  update: Update,
) => boolean;
