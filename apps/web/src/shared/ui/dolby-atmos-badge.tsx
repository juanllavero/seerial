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
      aria-label={t('dolbyAtmos')}
      className={`h-3 w-auto shrink-0 text-white/70 ${className}`}
    />
  );
}

export default DolbyAtmosBadge;
