import { init, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { seerialQueryClient, setUnauthorizedHandler } from '@seerial/api';
import { useServerStore } from '@seerial/stores';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { GlobalMusicPlayer } from '@/features/music-player';
import { UpdateDialog } from '@/features/updater';
import { useFeedbackSounds } from '@/shared/hooks/use-feedback-sounds';
import AppRoutes from './routes/routes';
import './shared/localization/i18n';
import './shared/styles/react-doctor-fixes.css';

// Clear session and redirect to login whenever the server returns 401
setUnauthorizedHandler(() => {
  useServerStore.getState().clearAuth();
  window.location.replace('/login');
});

function App() {
  useFeedbackSounds();

  // Check the persisted server at startup; if it is unreachable, Root sends us back to the login
  useEffect(() => {
    void useServerStore.getState().initializeStatusChecks();
  }, []);

  useEffect(() => {
    init({
      //debug: true, // Enable debug mode for spatial navigation
    });

    const focusFrame = window.requestAnimationFrame(() => {
      setFocus('continueWatching');
    });

    return () => window.cancelAnimationFrame(focusFrame);
  }, []);

  return (
    <BrowserRouter>
      <AppRoutes />
      <GlobalMusicPlayer />
      <UpdateDialog />
    </BrowserRouter>
  );
}

// biome-ignore lint/style/noNonNullAssertion: <Document should not be null since we control the HTML>
const root = createRoot(document.getElementById('root')!);
root.render(
  <QueryClientProvider client={seerialQueryClient}>
    <App />
  </QueryClientProvider>,
);
