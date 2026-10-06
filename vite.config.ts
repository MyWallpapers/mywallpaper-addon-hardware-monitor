import { defineConfig } from 'vite'
import { myWallpaperAddon } from './scripts/addon-build.ts'

export default defineConfig({
  plugins: [myWallpaperAddon()],
  server: {
    // Native builds and CLI snapshots have their own lifecycle. Watching their
    // temporary directories can lock them during an atomic rename on Windows.
    watch: { ignored: ['**/.mywallpaper/**', '**/.preview/**', '**/native/**'] },
  },
})
