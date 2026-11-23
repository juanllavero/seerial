import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { DolbyAtmosIcon } from './icon-library';

interface DolbyAtmosBadgeProps {
  className?: string;
}

function DolbyAtmosBadge({ className = '' }: DolbyAtmosBadgeProps) {
  const { t } = useTranslation();

  return (
    <DolbyAtmosIcon
      role="img"
      aria-hidden={false}
      aria-label={t('dolbyAtmos')}
      className={`h-[1.5dvh] w-auto shrink-0 ${className}`}
    />
  );
}

export default memo(DolbyAtmosBadge);
