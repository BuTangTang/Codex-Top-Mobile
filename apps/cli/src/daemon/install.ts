import { logger } from '@/ui/logger';
import { installDaemonService } from './service/installer';

export async function install(): Promise<void> {
  logger.info('Installing Happier background service (automatic startup)...');
  await installDaemonService();
  logger.info('Background service installed');
}
