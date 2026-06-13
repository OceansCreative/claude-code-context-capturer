import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Claude Code Context Capturer',
  short_name: 'CCC',
  version: '0.9.0',
  description:
    'Convert any web page into Claude Code-friendly Markdown context with one click.',
  permissions: [
    'activeTab',
    'clipboardWrite',
    'storage',
    'scripting',
    'contextMenus',
    'offscreen',
  ],
  host_permissions: ['<all_urls>'],
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      '16': 'public/icons/icon-16.png',
      '32': 'public/icons/icon-32.png',
      '48': 'public/icons/icon-48.png',
      '128': 'public/icons/icon-128.png',
    },
  },
  icons: {
    '16': 'public/icons/icon-16.png',
    '32': 'public/icons/icon-32.png',
    '48': 'public/icons/icon-48.png',
    '128': 'public/icons/icon-128.png',
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  options_page: 'src/options/index.html',
  commands: {
    'capture-page': {
      suggested_key: {
        default: 'Ctrl+Shift+L',
        mac: 'Command+Shift+L',
      },
      description: 'Capture current page as Claude Code context',
    },
    'capture-selection': {
      suggested_key: {
        default: 'Ctrl+Shift+K',
        mac: 'Command+Shift+K',
      },
      description: 'Capture selected text as Claude Code context',
    },
  },
});
