import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'monaco-patched-sanitizer',
      enforce: 'pre',
      resolveId(source, importer) {
        // Monaco vendors a second copy; an npm override alone cannot patch it.
        if (source === './dompurify/dompurify.js'
          && importer?.replaceAll('\\', '/').endsWith('/monaco-editor/esm/vs/base/browser/domSanitize.js')) {
          return this.resolve('dompurify', importer, { skipSelf: true });
        }
        return null;
      },
    },
  ],
});
