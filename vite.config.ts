import { defineConfig } from 'vite'
import { myWallpaperAddon } from './scripts/addon-build.ts'

export default defineConfig({ plugins: [myWallpaperAddon()] })
