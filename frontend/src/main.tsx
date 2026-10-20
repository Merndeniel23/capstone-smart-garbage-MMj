import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

import App from './App';
import PasswordSetup from './components/PasswordSetup';
import './index.css';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icons when bundled with Vite/Railway.
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(window.location.hash.slice(1)).has('setup-password') ? <PasswordSetup /> : googleClientId ? (
      <GoogleOAuthProvider clientId={googleClientId}>
        <App />
      </GoogleOAuthProvider>
    ) : (
      <App />
    )}
  </StrictMode>,
);
