import ISO6391 from 'iso-639-1';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';
import LabeledInputWrapper from '@/shared/forms/labeled-input-wrapper';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import FlexBox from '@/shared/ui/flex-box';
import Loading from '@/shared/ui/loading';
import SelectableWrapper from '@/shared/ui/selectable-wrapper';
import { useSettingsStore } from '../stores/settings-store';
import ContentWrapper from './utils/content-wrapper';

function ServerLanguages() {
  const { t, i18n } = useTranslation();
  const { setServerSetting, serverSettings, setServerSettings } = useSettingsStore(
    (state) => ({
      setServerSetting: state.setServerSetting,
      serverSettings: state.serverSettings,
      setServerSettings: state.setServerSettings,
    }),
    shallow,
  );
  const currentLanguage = i18n.language?.split('-')[0] ?? 'en';
  const [isDirty, setIsDirty] = useState(false);

  const [showMessage, setShowMessage] = useState(false);

  const subtitleModeOptions = [
    {
      key: 'manualSubs',
      value: t('manualSubs'),
    },
    {
      key: 'autoSubs',
      value: t('autoSubs'),
    },
    {
      key: 'alwaysSubs',
      value: t('alwaysSubs'),
    },
  ];

  const [autoSelectTracks, setAutoSelectTracks] = useState<boolean>(
    (serverSettings['autoSelectTracks'] as boolean) ?? true,
  );
  // The state keeps option keys (language codes / mode keys), which is what the selectors report
  // when changed and what the server stores. Labels are only used to display the selection.
  const [preferAudioLan, setPreferAudioLan] = useState<string>(
    ((serverSettings['preferAudioLan'] as string) ?? '').split('-')[0] || currentLanguage,
  );
  const [subsMode, setSubsMode] = useState<string>(
    subtitleModeOptions.find((option) => option.key === serverSettings['subsMode'])?.key ??
      subtitleModeOptions[0].key,
  );
  const [preferSubLan, setPreferSubLan] = useState<string>(
    ((serverSettings['preferSubsLan'] as string) ?? '').split('-')[0] || currentLanguage,
  );

  const languageCodes = ISO6391.getAllCodes();

  const languagesOptions = languageCodes.map((code) => ({
    key: code,
    value: ISO6391.getNativeName(code),
  }));

  const handleSave = () => {
    setServerSetting('autoSelectTracks', autoSelectTracks);
    setServerSetting('preferAudioLan', preferAudioLan);
    setServerSetting('subsMode', subsMode);
    setServerSetting('preferSubsLan', preferSubLan);

    setServerSettings({
      ...serverSettings,
      autoSelectTracks: autoSelectTracks,
      preferAudioLan: preferAudioLan,
      subsMode: subsMode,
      preferSubsLan: preferSubLan,
    });

    setIsDirty(false);

    setShowMessage(true);

    setTimeout(() => {
      setShowMessage(false);
    }, 2000);
  };

  const handleAutoSelectTracksChange = (value: boolean) => {
    setAutoSelectTracks(value);
    setIsDirty(true);
  };

  const handlePreferAudioLanChange = (key: string) => {
    setPreferAudioLan(key);
    setIsDirty(true);
  };

  const handleSubsModeChange = (key: string) => {
    setSubsMode(key);
    setIsDirty(true);
  };

  const handlePreferSubLanChange = (key: string) => {
    setPreferSubLan(key);
    setIsDirty(true);
  };

  return (
    <ContentWrapper group={t('server')} section={t('languages')}>
      {preferAudioLan === '' || subsMode === '' || preferSubLan === '' ? (
        <Loading />
      ) : (
        <>
          <LabeledInputWrapper direction="row" label={t('autoSelectTracks')}>
            <Checkbox checked={autoSelectTracks} onCheckedChange={handleAutoSelectTracksChange} />
          </LabeledInputWrapper>

          <LabeledInputWrapper direction="row" label={t('preferAudio')}>
            <SelectableWrapper
              options={languagesOptions}
              defaultValue={ISO6391.getNativeName(preferAudioLan)}
              onValueChange={handlePreferAudioLanChange}
            />
          </LabeledInputWrapper>

          <LabeledInputWrapper direction="row" label={t('subsMode')}>
            <SelectableWrapper
              options={subtitleModeOptions}
              defaultValue={subtitleModeOptions.find((option) => option.key === subsMode)?.value}
              onValueChange={handleSubsModeChange}
            />
          </LabeledInputWrapper>

          <LabeledInputWrapper direction="row" label={t('preferSubs')}>
            <SelectableWrapper
              options={languagesOptions}
              defaultValue={ISO6391.getNativeName(preferSubLan)}
              onValueChange={handlePreferSubLanChange}
            />
          </LabeledInputWrapper>

          <FlexBox gap={1} justify="center" align="center">
            <Button disabled={!isDirty} onClick={handleSave}>
              {t('saveButton')}
            </Button>
            {showMessage && (
              <span className="text-muted-foreground text-sm">✔ {t('changesSaved')}</span>
            )}
          </FlexBox>
        </>
      )}
    </ContentWrapper>
  );
}

export default ServerLanguages;
