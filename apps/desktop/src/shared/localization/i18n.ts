import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { useSettingsStore } from '../stores/settings.store';
import { en } from './languages/en';
import { es } from './languages/es-ES';

const { language } = useSettingsStore.getState().settings;
document.documentElement.lang = language;

i18n.use(initReactI18next).init({
  lng: language,
  fallbackLng: 'en',
  resources: {
    en,
    'es-ES': es,
  },
});
