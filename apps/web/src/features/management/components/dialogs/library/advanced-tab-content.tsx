import ISO6391 from 'iso-639-1';
import { useTranslation } from 'react-i18next';
import LabeledInputWrapper from '@/shared/forms/labeled-input-wrapper';
import { Button } from '@/shared/ui/button';
import FlexBox from '@/shared/ui/flex-box';
import SelectableWrapper from '@/shared/ui/selectable-wrapper';

interface AdvancedTabContentProps {
  /** Language code (ISO 639-1) of the preferred audio. */
  preferAudioLan: string;
  setPreferAudioLan: (language: string) => void;
  /** Language code (ISO 639-1) of the preferred subtitles. */
  preferSubLan: string;
  setPreferSubLan: (language: string) => void;
  /** Key of the subtitle mode: `alwaysSubs`, `autoSubs` (foreign audio) or `manualSubs` (never). */
  subsMode: string;
  setSubsMode: (mode: string) => void;
  buttonDisabled: boolean;
  handleAddLibrary: () => void;
  close: () => void;
  edit?: boolean;
}

const languagesOptions = ISO6391.getAllCodes().map((code) => ({
  key: code,
  value: ISO6391.getNativeName(code),
}));

function AdvancedTabContent({
  preferAudioLan,
  setPreferAudioLan,
  preferSubLan,
  setPreferSubLan,
  subsMode,
  setSubsMode,
  buttonDisabled,
  handleAddLibrary,
  close,
  edit,
}: AdvancedTabContentProps) {
  const { t } = useTranslation();

  const subtitleModeOptions = [
    { key: 'alwaysSubs', value: t('alwaysSubs') },
    { key: 'autoSubs', value: t('autoSubs') },
    { key: 'manualSubs', value: t('manualSubs') },
  ];

  // The form keeps keys (language codes, mode keys), the selectors show and report labels
  const labelOf = (options: { key: string; value: string }[], key: string) =>
    options.find((option) => option.key === key)?.value;

  return (
    <FlexBox
      direction="column"
      gap={1}
      align="stretch"
      justify="space-between"
      height={'27rem'}
      width={'100%'}
    >
      <FlexBox direction="column" gap={1}>
        <LabeledInputWrapper direction="row" label={t('preferAudio')}>
          <SelectableWrapper
            options={languagesOptions}
            value={labelOf(languagesOptions, preferAudioLan)}
            onValueChange={(key: string) => setPreferAudioLan(key)}
          />
        </LabeledInputWrapper>

        <LabeledInputWrapper direction="row" label={t('subsMode')}>
          <SelectableWrapper
            options={subtitleModeOptions}
            value={labelOf(subtitleModeOptions, subsMode)}
            onValueChange={(key: string) => setSubsMode(key)}
          />
        </LabeledInputWrapper>

        <LabeledInputWrapper direction="row" label={t('preferSubs')}>
          <SelectableWrapper
            options={languagesOptions}
            value={labelOf(languagesOptions, preferSubLan)}
            onValueChange={(key: string) => setPreferSubLan(key)}
          />
        </LabeledInputWrapper>
      </FlexBox>

      <FlexBox width={'100%'} justify="end" gap={1}>
        <Button variant={'secondary'} onClick={close}>
          {t('cancelButton')}
        </Button>
        <Button onClick={handleAddLibrary} disabled={buttonDisabled}>
          {t(edit ? 'saveButton' : 'addButton')}
        </Button>
      </FlexBox>
    </FlexBox>
  );
}

export default AdvancedTabContent;
