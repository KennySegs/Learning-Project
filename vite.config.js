import { defineConfig } from 'vite';

export default defineConfig({
  // Allow NEXT_PUBLIC_* (common in tutorials) as well as VITE_* for client env.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  server: {
    // Stable URL: use 5174 so bookmarks match (5173 may be taken by another Vite app).
    port: 5174,
    strictPort: true,
    open: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        portal: 'portal.html',
        doctorApplication: 'doctor-application.html',
      },
    },
  },
});
