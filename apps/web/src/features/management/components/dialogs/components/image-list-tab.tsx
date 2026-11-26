import { API, apiClient, seerialQueryClient, useGet } from '@seerial/api';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useIsTablet } from '@/shared/hooks/use-tablet';
import { ImageType } from '@/shared/lib/constants';
import { markImagesChanged } from '../../../stores/images-changed';
import { generateRandoumUUID, showToast } from '@/shared/lib/react-utils';
import { Button } from '@/shared/ui/button';
import FlexBox from '@/shared/ui/flex-box';
import { Input } from '@/shared/ui/input';
import ImageButton from './image-button';

interface LocalImage {
  name: string;
  url: string;
}

/** An image field of a content, which keeps one local file next to it */
interface ArtworkTarget {
  owner: 'movie' | 'series' | 'season' | 'collection' | 'album';
  id: string;
  field: 'coverSrc' | 'logoSrc' | 'backgroundSrc';
}

interface ImageListTabProps {
  imagesList: string[];
  /** Contents with images: only the local image of this field is listed */
  artwork?: ArtworkTarget;
  /** Otherwise, every image of this folder is listed */
  localFolder?: string;
  selectImage: (image: string) => void;
  selectedImage: string;
  type?: ImageType;
}

function ImageListTab({
  imagesList,
  artwork,
  localFolder,
  selectImage,
  selectedImage,
  type = ImageType.BACKDROP,
}: ImageListTabProps) {
  const { t } = useTranslation();
  const [pastingUrl, setPastingUrl] = useState<boolean>(false);
  const [urlToDownload, setUrlToDownload] = useState<string>('');
  const isTablet = useIsTablet();

  // Upload image
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Reference to hidden file input
  const fileInputRef = useRef<HTMLInputElement>(null);

  const folderListing = useGet<LocalImage[]>(
    !artwork && localFolder
      ? `${API.images.directoryListing}?path=${encodeURIComponent(localFolder)}`
      : null,
  );
  const artworkListing = useGet<Record<string, string>>(
    artwork ? API.artwork.list(artwork.owner, artwork.id) : null,
  );
  // The file keeps its name when replaced: the version makes the browser load it again
  const [version, setVersion] = useState(() => Date.now());

  const artworkPath = artwork ? artworkListing.data?.[artwork.field] : undefined;
  const artworkImages: LocalImage[] = artworkPath
    ? [
        {
          name: 'local',
          url: `images/local?path=${encodeURIComponent(artworkPath)}&v=${version}`,
        },
      ]
    : [];
  const localImages = artwork ? artworkImages : folderListing.data;
  const isLoading = artwork ? artworkListing.isLoading : folderListing.isLoading;

  /** After an upload or a download. For a content, the server has already selected the image */
  const showSavedImage = async (path?: string) => {
    if (!artwork) {
      folderListing.mutate();
      return;
    }

    markImagesChanged();
    setVersion(Date.now());
    await artworkListing.mutate();
    await seerialQueryClient.invalidateQueries({ queryKey: ['images', 'local'] });
    if (path) selectImage(path);
  };

  const handleImageUpload = () => {
    setImageUrl(null);
    fileInputRef.current?.click();
  };

  // Handle file selection
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file) {
      // Verify if the file is an image
      if (!file.type.startsWith('image/')) {
        showToast('error', t('invalidImageError'));
        return;
      }

      // Create URL for preview
      const imageUrl = URL.createObjectURL(file);
      setImageUrl(imageUrl);

      // Send the image to the server
      await uploadImage(file);
    }

    // Clear the input after selection
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const uploadImage = async (file: File) => {
    setIsUploading(true);
    const formData = new FormData();
    if (artwork) formData.append('field', artwork.field);
    else formData.append('destPath', localFolder ?? '');
    formData.append('image', file);

    try {
      const url = artwork ? API.artwork.upload(artwork.owner, artwork.id) : API.images.upload;
      const response = await apiClient.post(url, formData);
      await showSavedImage(response.data?.data?.path);
      showToast('success', t('imageLoaded'));
    } catch (_err) {
      showToast('error', t('errorImageUpload'));
    } finally {
      setIsUploading(false);
    }
  };

  const downloadImage = async (url: string) => {
    setIsUploading(true);

    // Extract a clean extension from the URL path, ignoring query strings
    const urlPath = (() => {
      try {
        return new URL(url).pathname;
      } catch {
        return url.split('?')[0];
      }
    })();
    const lastSegment = urlPath.split('/').pop() ?? '';
    const rawExt = lastSegment.includes('.') ? (lastSegment.split('.').pop() ?? '') : '';
    const safeExt = /^[a-zA-Z0-9]{1,10}$/.test(rawExt) ? rawExt : '';
    const fileName = `${generateRandoumUUID()}${safeExt ? `.${safeExt}` : ''}`;

    try {
      if (artwork) {
        const response = await apiClient.post(
          API.artwork.download(artwork.owner, artwork.id, artwork.field),
          { url },
        );
        await showSavedImage(response.data?.data?.path);
      } else {
        await apiClient.post(API.downloads.image, {
          url,
          downloadFolder: localFolder,
          fileName,
        });
        await showSavedImage();
      }
      showToast('success', t('imageLoaded'));
    } catch (_err) {
      showToast('error', t('errorImageUpload'));
    } finally {
      setIsUploading(false);
    }
  };

  // Clean up the object URL when the component unmounts
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  return (
    <FlexBox direction="column" gap={1} height={'100%'}>
      <FlexBox gap={1} justify="center" align="center" width={'100%'} padding="0 0.5rem">
        {/* Hidden input for file selection */}
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        {pastingUrl ? (
          <>
            <Input
              type="text"
              placeholder="Paste URL"
              value={urlToDownload}
              onChange={(e) => setUrlToDownload(e.target.value)}
            />
            <Button
              variant={'secondary'}
              onClick={() => {
                setPastingUrl(false);
              }}
            >
              {t('cancelButton')}
            </Button>
            <Button
              onClick={() => {
                setPastingUrl(false);
                downloadImage(urlToDownload);
              }}
            >
              {t('downloadButton')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={handleImageUpload} disabled={isUploading}>
              {t('loadImageButton')}
            </Button>
            <Button onClick={() => setPastingUrl(true)} disabled={isUploading}>
              {t('fromURLButton')}
            </Button>
          </>
        )}
      </FlexBox>

      <FlexBox
        gap={1}
        direction="row"
        wrap="wrap"
        scroll="vertical"
        justify="stretch"
        hideScrollbar={isTablet}
        padding="0 1rem"
      >
        {imagesList?.map((image) => (
          <ImageButton
            key={image}
            image={image}
            type={type}
            selectedImage={selectedImage}
            selectImage={selectImage}
          />
        ))}

        {!isLoading &&
          localImages &&
          localImages.map((image: { name: string; url: string }) => (
            <ImageButton
              key={`${image.name} ${image.url}`}
              image={image.url}
              type={type}
              isLocal
              selectedImage={selectedImage}
              selectImage={selectImage}
            />
          ))}
      </FlexBox>
    </FlexBox>
  );
}

export default ImageListTab;
