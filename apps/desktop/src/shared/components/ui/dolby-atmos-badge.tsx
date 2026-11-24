import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { DolbyAtmosIcon } from './icon-library';

interface DolbyAtmosBadgeProps {
  className?: string;
  /** Logo height. Set inline: a utility class ended up at half its value in the rendered UI. */
  height?: string;
}

function DolbyAtmosBadge({ className = '', height = '2.2dvh' }: DolbyAtmosBadgeProps) {
  const { t } = useTranslation();

  return (
    <DolbyAtmosIcon
      role="img"
      aria-hidden={false}
      aria-label={t('dolbyAtmos')}
      className={`shrink-0 ${className}`}
      style={{ height, width: 'auto' }}
    />
  );
}

export default memo(DolbyAtmosBadge);
