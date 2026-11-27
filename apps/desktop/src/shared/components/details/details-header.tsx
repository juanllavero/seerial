import type { DetailsData } from '@seerial/domain';
import { useTranslation } from 'react-i18next';
import Subtitle from '../text/subtitle';
import Title from '../text/title';
import AlignedImage from './aligned-image';

interface DetailsHeaderProps {
  details: DetailsData | undefined;
  subtitle?: string;
}

function DetailsHeader({ details, subtitle }: DetailsHeaderProps) {
  const { t } = useTranslation();

  return (
    <>
      <span className="text-[1.5vh] italic">
        {details?.tagline && details.tagline !== '' ? details.tagline : ''}
      </span>

      {details?.logoSrc && details.logoSrc !== '' ? (
        <AlignedImage className="my-3" imageUrl={details.logoSrc} />
      ) : (
        <Title className={`leading-none ${subtitle || details?.subtitle ? '' : 'mb-5'}`}>
          {details?.title}
        </Title>
      )}

      {(subtitle || details?.subtitle) && <Subtitle>{subtitle || details?.subtitle}</Subtitle>}

      {details?.createdBy ? (
        <span className="text-[1.5vh] italic mb-5">{`${t('createdBy')} ${details.createdBy}`}</span>
      ) : details?.directedBy ? (
        <span className="text-[1.5vh] italic mb-5">{`${t('directedBy')} ${details.directedBy}`}</span>
      ) : null}
    </>
  );
}

export default DetailsHeader;
