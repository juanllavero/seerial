import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { ChevronLeft, ChevronRight, SettingsIcon } from 'lucide-react';
import { memo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MENU_ROW_CLASS, scrollFocusedRowIntoView } from '@/shared/components/menus/menu-row';
import { NavigationButton } from '@/shared/components/navigation';
import { useKeyboardShortcut } from '@/shared/hooks/use-keyboard-shortcut';
import { NavigationFocusKeys } from '@/shared/navigation/constants';
import type {
  PlayerSettings,
  PlayerVideoQuality,
  SubtitlePosition,
  SubtitleSize,
} from '../hooks/use-player-settings';
import PlayerMenu from './player-menu';
import { SettingsPanelProvider, useSettingsPanel } from './settings-panel-context';

const ZOOM_MIN = -3;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.1;

const DELAY_STEP = 50; // ms

const VIDEO_QUALITIES: PlayerVideoQuality[] = ['low', 'normal', 'high', 'ultra', 'maximum'];
const VIDEO_QUALITY_LABEL_KEYS: Record<PlayerVideoQuality, string> = {
  low: 'qualityLow',
  normal: 'qualityNormal',
  high: 'qualityHigh',
  ultra: 'qualityUltra',
  maximum: 'qualityMaximum',
};

const SUBTITLE_SIZES: SubtitleSize[] = ['tiny', 'small', 'normal', 'big', 'large'];
const SUBTITLE_POSITIONS: SubtitlePosition[] = [
  'topRight',
  'topCenter',
  'topLeft',
  'bottomRight',
  'bottomCenter',
  'bottomLeft',
];

const BORDER_SIZES = [0, 1, 2, 3, 4, 5];
const SHADOW_OFFSETS = [0, 1, 2, 3, 4, 5];

const SUBTITLE_COLORS = [
  { key: 'white', hex: '#FFFFFF' },
  { key: 'yellow', hex: '#FFFF00FF' },
  { key: 'black', hex: '#000000FF' },
  { key: 'cyan', hex: '#00FFFFFF' },
  { key: 'blue', hex: '#0000FFFF' },
  { key: 'green', hex: '#00FF00FF' },
  { key: 'magenta', hex: '#FF00FFFF' },
  { key: 'red', hex: '#FF0000FF' },
  { key: 'gray', hex: '#808080FF' },
  { key: 'orange', hex: '#FF8000FF' },
  { key: 'gold', hex: '#FFD700FF' },
  { key: 'pink', hex: '#FF69B4FF' },
] as const;

function settingFocusKey(id: string) {
  return `player-setting-${id}`;
}

// Cycle through an array of values
function cycleValue<T>(values: T[], current: T, direction: 'left' | 'right'): T {
  const idx = values.indexOf(current);
  if (idx === -1) return values[0];
  const next =
    direction === 'right' ? (idx + 1) % values.length : (idx - 1 + values.length) % values.length;
  return values[next];
}

// Step a numeric value within a range
function stepValue(
  current: number,
  step: number,
  min: number,
  max: number,
  direction: 'left' | 'right',
): number {
  const delta = direction === 'right' ? step : -step;
  return Math.round(Math.max(min, Math.min(max, current + delta)) * 100) / 100;
}

interface SettingRowProps {
  focusKey: string;
  label: string;
  value: string;
  colorSwatch?: string;
  disabled?: boolean;
  onArrowPress: (direction: string) => boolean | undefined;
}

function SettingRow({
  focusKey,
  label,
  value,
  colorSwatch,
  disabled,
  onArrowPress,
}: SettingRowProps) {
  // The arrows can also be clicked, so the menu works with a mouse as well as with a remote
  const arrow = (direction: 'left' | 'right') => {
    const Icon = direction === 'left' ? ChevronLeft : ChevronRight;
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: the keyboard uses the arrow keys
      // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard uses the arrow keys
      <div
        className="rounded-full p-[0.4dvh] hover:bg-black/15"
        onClick={() => onArrowPress(direction)}
      >
        <Icon className="size-[2.2dvh]!" />
      </div>
    );
  };

  return (
    <NavigationButton
      variant="ghost"
      customKey={focusKey}
      disabled={disabled}
      className={`${MENU_ROW_CLASS} disabled:opacity-40`}
      onArrowPress={onArrowPress}
      onFocus={() => scrollFocusedRowIntoView(focusKey)}
    >
      <div className="flex w-full items-center justify-between gap-[1.4dvh] text-[1.9dvh]">
        <div className="font-medium">{label}</div>
        <div className="flex shrink-0 items-center gap-[0.8dvh]">
          {arrow('left')}
          <div className="flex min-w-[18dvh] items-center justify-center gap-[0.8dvh] font-semibold">
            {!!colorSwatch && (
              <div
                className="size-[2dvh] rounded-full border border-neutral-500"
                style={{ backgroundColor: colorSwatch }}
              />
            )}
            {value}
          </div>
          {arrow('right')}
        </div>
      </div>
    </NavigationButton>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div className="px-[1.8dvh] pt-[1.6dvh] pb-[0.8dvh] font-bold text-[1.4dvh] text-app-color uppercase tracking-widest">
      {children}
    </div>
  );
}

interface SettingsProps {
  onPanelChange?: (open: boolean) => void;
  settings: PlayerSettings;
  updateSetting: <K extends keyof PlayerSettings>(key: K, value: PlayerSettings[K]) => void;
}

function Settings({ onPanelChange, settings, updateSetting }: SettingsProps) {
  const { t } = useTranslation();
  const { open, setOpen } = useSettingsPanel();

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      onPanelChange?.(nextOpen);
    },
    [setOpen, onPanelChange],
  );

  const closePanel = useCallback(() => {
    handleOpenChange(false);
    setTimeout(() => setFocus(NavigationFocusKeys.player.settingsButton), 30);
  }, [handleOpenChange]);

  useEffect(() => {
    if (open) {
      const focusTimeout = window.setTimeout(() => {
        setFocus(settingFocusKey('quality'));
      }, 30);
      return () => window.clearTimeout(focusTimeout);
    }
  }, [open]);

  useKeyboardShortcut({
    key: ['Escape', 'Backspace'],
    enabled: open,
    onKeyDown: useCallback(
      (e: KeyboardEvent) => {
        e.preventDefault();
        closePanel();
      },
      [closePanel],
    ),
  });

  const handleArrow = useCallback(
    (_key: keyof PlayerSettings, handler: (dir: 'left' | 'right') => void) =>
      (direction: string) => {
        if (direction === 'left' || direction === 'right') {
          handler(direction);
          return false;
        }
        return true;
      },
    [],
  );

  const currentColor =
    SUBTITLE_COLORS.find((c) => c.hex === settings.subtitleColor) ?? SUBTITLE_COLORS[0];

  return (
    <div className="relative">
      <NavigationButton
        variant="ghost"
        customKey={NavigationFocusKeys.player.settingsButton}
        title={t('settings')}
        className={`p-2 ${open ? 'bg-white text-black' : ''}`}
        onClick={() => handleOpenChange(!open)}
      >
        <SettingsIcon size={'2dvh'} />
      </NavigationButton>

      <PlayerMenu
        open={open}
        title={t('settings')}
        hint={t('changeWithArrows')}
        onClose={closePanel}
      >
        <SectionTitle>{t('video')}</SectionTitle>
        <SettingRow
          focusKey={settingFocusKey('quality')}
          label={t('videoQuality')}
          value={t(VIDEO_QUALITY_LABEL_KEYS[settings.videoQuality])}
          onArrowPress={handleArrow('videoQuality', (dir) =>
            updateSetting('videoQuality', cycleValue(VIDEO_QUALITIES, settings.videoQuality, dir)),
          )}
        />
        <SettingRow
          focusKey={settingFocusKey('zoom')}
          label={t('zoom')}
          value={`${settings.zoom.toFixed(1)}x`}
          onArrowPress={handleArrow('zoom', (dir) =>
            updateSetting('zoom', stepValue(settings.zoom, ZOOM_STEP, ZOOM_MIN, ZOOM_MAX, dir)),
          )}
        />

        <SectionTitle>{t('audio')}</SectionTitle>
        <SettingRow
          focusKey={settingFocusKey('audio-delay')}
          label={t('delay')}
          value={`${settings.audioDelay} ms`}
          onArrowPress={handleArrow('audioDelay', (dir) =>
            updateSetting(
              'audioDelay',
              settings.audioDelay + (dir === 'right' ? DELAY_STEP : -DELAY_STEP),
            ),
          )}
        />

        <SectionTitle>{t('subs')}</SectionTitle>
        <SettingRow
          focusKey={settingFocusKey('sub-delay')}
          label={t('delay')}
          value={`${settings.subtitleDelay} ms`}
          onArrowPress={handleArrow('subtitleDelay', (dir) =>
            updateSetting(
              'subtitleDelay',
              settings.subtitleDelay + (dir === 'right' ? DELAY_STEP : -DELAY_STEP),
            ),
          )}
        />
        <SettingRow
          focusKey={settingFocusKey('sub-size')}
          label={t('size')}
          value={t(settings.subtitleSize)}
          onArrowPress={handleArrow('subtitleSize', (dir) =>
            updateSetting('subtitleSize', cycleValue(SUBTITLE_SIZES, settings.subtitleSize, dir)),
          )}
        />
        <SettingRow
          focusKey={settingFocusKey('sub-color')}
          label={t('color')}
          value={t(currentColor.key)}
          colorSwatch={currentColor.hex}
          onArrowPress={handleArrow('subtitleColor', (dir) => {
            const nextColor = cycleValue([...SUBTITLE_COLORS], currentColor, dir);
            updateSetting('subtitleColor', nextColor.hex);
          })}
        />
        <SettingRow
          focusKey={settingFocusKey('sub-border')}
          label={t('border')}
          value={`${settings.subtitleBorderSize}`}
          onArrowPress={handleArrow('subtitleBorderSize', (dir) =>
            updateSetting(
              'subtitleBorderSize',
              cycleValue(BORDER_SIZES, settings.subtitleBorderSize, dir),
            ),
          )}
        />
        <SettingRow
          focusKey={settingFocusKey('sub-shadow')}
          label={t('shadow')}
          value={`${settings.subtitleShadowOffset}`}
          onArrowPress={handleArrow('subtitleShadowOffset', (dir) =>
            updateSetting(
              'subtitleShadowOffset',
              cycleValue(SHADOW_OFFSETS, settings.subtitleShadowOffset, dir),
            ),
          )}
        />
        <SettingRow
          focusKey={settingFocusKey('sub-position')}
          label={t('position')}
          value={t(settings.subtitlePosition)}
          onArrowPress={handleArrow('subtitlePosition', (dir) =>
            updateSetting(
              'subtitlePosition',
              cycleValue(SUBTITLE_POSITIONS, settings.subtitlePosition, dir),
            ),
          )}
        />
      </PlayerMenu>
    </div>
  );
}

function SettingsWithProvider(props: SettingsProps) {
  return (
    <SettingsPanelProvider>
      <Settings {...props} />
    </SettingsPanelProvider>
  );
}

export default memo(SettingsWithProvider);
