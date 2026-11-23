import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';

interface LocalSourceErrorAlertProps {
  descriptionKey: string;
  onClose: () => void;
}

/**
 * Informs the user that an item comes from a local folder/file and
 * can only be removed from the file system.
 */
function LocalSourceErrorAlert({ descriptionKey, onClose }: LocalSourceErrorAlertProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={true}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('localSourceDeleteErrorTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t(descriptionKey)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>{t('ok')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default LocalSourceErrorAlert;
