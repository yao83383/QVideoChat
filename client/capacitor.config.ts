import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.qvideochat.app',
  appName: 'QVideoChat',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
};

export default config;
