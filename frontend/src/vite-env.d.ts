/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAGE_TYPE: string;
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}