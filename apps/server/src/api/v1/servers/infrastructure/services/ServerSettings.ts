import { fileSystemService } from '@/api/v1/shared/infrastructure/adapters/di/container';

export const DEFAULT_SERVER_CONFIG = {
  smartScan: true,
  smartScanPeriod: 'daily',
  generateChapters: 'never',
  autoSelectTracks: true,
  preferAudioLan: 'es-ES',
  preferSubsLan: 'es-ES',
  subsMode: 'autoSubs',
  tempTranscodeFolder: '',
  transcodeBuffer: 60,
  transcodePreset: 'veryfast',
  maxTranscodeProcesses: 4,
  automaticUpdates: false,
};

/**
 * Reads the persisted server settings. The file is only created when it does not exist yet
 * (never overwritten), and keys missing from an older file fall back to their defaults.
 */
export function loadServerConfig(): { file: string; config: Record<string, unknown> } {
  const file = fileSystemService.getExternalPath('resources/config/serverConfig.json');

  if (!fileSystemService.existsSync(file)) {
    fileSystemService.createJSONFile(file, DEFAULT_SERVER_CONFIG);
  }

  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(fileSystemService.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    // Corrupted file: fall back to defaults instead of failing every settings request
  }

  return { file, config: { ...DEFAULT_SERVER_CONFIG, ...stored } };
}
