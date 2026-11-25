import { useServerStore } from '@seerial/stores';
import { type JSX, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { shallow } from 'zustand/shallow';
import LogoIntro from '@/features/home/components/logo-intro';

const PUBLIC_PATHS = ['/login', '/link'];

function Root() {
  const location = useLocation();
  const { user, server, serverOnline } = useServerStore(
    (state) => ({
      user: state.currentUser,
      server: state.selectedServer,
      serverOnline: state.serverOnline,
    }),
    shallow,
  );

  const isPublic = PUBLIC_PATHS.includes(location.pathname);
  const serverDown = serverOnline === false;

  // Unreachable server: drop the session and the selection so the login page shows the server
  // list again (otherwise it would redirect straight back to /home with the dead server)
  useEffect(() => {
    if (serverDown && user && server) {
      const { clearAuth, setSelectedServer } = useServerStore.getState();
      clearAuth();
      setSelectedServer(null);
    }
  }, [serverDown, user, server]);

  let routeContent: JSX.Element;

  if (!user || !server) {
    routeContent = isPublic ? <Outlet /> : <Navigate to="/login" replace />;
  } else if (serverDown) {
    routeContent = <Navigate to="/login" replace />;
  } else {
    routeContent = <Outlet />;
  }

  return (
    <>
      <LogoIntro />
      {routeContent}
    </>
  );
}

export default Root;
