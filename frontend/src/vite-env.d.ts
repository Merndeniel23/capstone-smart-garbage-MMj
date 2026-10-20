/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_MAP_CENTER_LAT?: string;
  readonly VITE_MAP_CENTER_LNG?: string;
  readonly VITE_ROUTING_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
