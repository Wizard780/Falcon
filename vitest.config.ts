import { defineConfig } from 'vitest/config';
import { alias } from './vite.config';
export default defineConfig({ resolve: { alias }, test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] } });
