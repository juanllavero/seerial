import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shallow } from 'zustand/shallow';
import LabeledInputWrapper from '@/shared/forms/labeled-input-wrapper';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import FlexBox from '@/shared/ui/flex-box';
import SelectableWrapper from '@/shared/ui/selectable-wrapper';
import { useSettingsStore } from '../stores/settings-store';
import ContentWrapper from './utils/content-wrapper';

function ServerLibraries() {
  const { t } = useTranslation();
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [showMessage, setShowMessage] = useState(false);
  const { setServerSetting, serverSettings, setServerSettings } = useSettingsStore(
    (state) => ({
      setServerSetting: state.setServerSetting,
      serverSettings: state.serverSettings,
      setServerSettings: state.setServerSettings,
    }),
    shallow,
  );

  const scanOptions = [
    {
      key: 'daily',
      value: t('daily'),
    },
    {
      key: 'weekly',
      value: t('weekly'),
    },
    {
      key: 'monthly',
      value: t('monthly'),
    },
  ];

  const chapterOptions = [
    {
      key: 'never',
      value: t('never'),
    },
    {
      key: 'asTask',
      value: t('asTask'),
    },
    {
      key: 'asTaskAndFileUpdate',
      value: t('asTaskAndFileUpdate'),
    },
  ];

  // The smart scan is on by default, and daily
  const [smartScan, setSmartScan] = useState<boolean>(
    (serverSettings['smartScan'] as boolean | undefined) ?? true,
  );
  const [smartScanPeriod, setSmartScanPeriod] = useState<string>(
    scanOptions.find((option) => option.key === serverSettings['smartScanPeriod'])?.key ??
      scanOptions[0].key,
  );
  const [generateChapters, setGenerateThumbnails] = useState<string>(
    chapterOptions.find((option) => option.key === serverSettings['generateChapters'])?.key ??
      chapterOptions[0].key,
  );

  const handleSmartScanChange = (checked: boolean) => {
    setSmartScan(checked);
    setIsDirty(true);
  };

  const handleSmartScanPeriodChange = (key: string) => {
    setSmartScanPeriod(key);
    setIsDirty(true);
  };

  const handleGenerateThumbnailsChange = (key: string) => {
    setGenerateThumbnails(key);
    setIsDirty(true);
  };

  const handleSave = () => {
    setServerSetting('smartScan', smartScan);
    setServerSetting('smartScanPeriod', smartScanPeriod);
    setServerSetting('generateChapters', generateChapters);

    setServerSettings({
      ...serverSettings,
      smartScan: smartScan,
      smartScanPeriod: smartScanPeriod,
      generateChapters: generateChapters,
    });

    setIsDirty(false);

    setShowMessage(true);

    setTimeout(() => {
      setShowMessage(false);
    }, 2000);
  };

  return (
    <ContentWrapper group={t('server')} section={t('libraries')}>
      <LabeledInputWrapper direction="row" label={t('smartScan')} text={t('smartScanMessage')}>
        <Checkbox checked={smartScan} onCheckedChange={handleSmartScanChange} />
      </LabeledInputWrapper>

      {smartScan && (
        <LabeledInputWrapper direction="row" label={t('smartScanPeriod')}>
          <SelectableWrapper
            options={scanOptions}
            defaultValue={scanOptions.find((option) => option.key === smartScanPeriod)?.value}
            onValueChange={handleSmartScanPeriodChange}
          />
        </LabeledInputWrapper>
      )}

      <LabeledInputWrapper direction="row" label={t('generateThumbnailsCheck')}>
        <SelectableWrapper
          options={chapterOptions}
          defaultValue={chapterOptions.find((option) => option.key === generateChapters)?.value}
          onValueChange={handleGenerateThumbnailsChange}
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
    </ContentWrapper>
  );
}

export default ServerLibraries;
