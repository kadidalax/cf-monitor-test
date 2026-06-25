import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';

import {
  buildThemeCss,
  parseThemeZip,
  validateThemeConfig,
} from '../src/utils/theme-package.ts';

function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(
    Object.entries(files).map(([name, value]) => [
      name,
      typeof value === 'string' ? strToU8(value) : value,
    ]),
  ));
}

const manifest = {
  name: 'Aurora',
  short: 'aurora',
  description: 'Compact glass theme',
  version: '1.0.0',
  author: 'User',
  preview: 'preview.png',
  style: 'style.css',
  configuration: {
    type: 'managed',
    data: [
      { key: 'accentColor', name: '强调色', type: 'string', default: '#3b82f6' },
      { key: 'showDecorations', name: '显示装饰', type: 'switch', default: true },
      { key: 'density', name: '密度', type: 'select', options: 'compact,normal', default: 'normal' },
      { key: 'brandColor', name: '品牌色', type: 'color', default: '#22c55e' },
      { key: 'heroImage', name: '背景图', type: 'image', default: '/api/theme/assets/aurora/bg.webp' },
      { key: 'cardRadius', name: '圆角', type: 'range', min: 0, max: 32, step: 1, default: 12 },
    ],
  },
};

test('parseThemeZip accepts a CSS theme package and stores allowed assets', () => {
  const parsed = parseThemeZip(zip({
    'cf-monitor-theme.json': JSON.stringify(manifest),
    'style.css': '.node-card { color: var(--cf-theme-accentColor); }',
    'preview.png': new Uint8Array([137, 80, 78, 71]),
    'fonts/inter.woff2': new Uint8Array([119, 79, 70, 50]),
  }));

  assert.equal(parsed.theme.short, 'aurora');
  assert.equal(parsed.theme.name, 'Aurora');
  assert.equal(parsed.theme.style_path, 'style.css');
  assert.equal(parsed.theme.preview_path, 'preview.png');
  assert.equal(parsed.assets.length, 3);
  assert.equal(parsed.assets.find(asset => asset.path === 'style.css')?.content_type, 'text/css; charset=utf-8');
  assert.equal(parsed.assets.find(asset => asset.path === 'preview.png')?.content_type, 'image/png');
  assert.equal(parsed.assets.find(asset => asset.path === 'fonts/inter.woff2')?.content_type, 'font/woff2');
});

test('parseThemeZip rejects unsafe theme packages', () => {
  assert.throws(() => parseThemeZip(zip({
    'cf-monitor-theme.json': JSON.stringify({ ...manifest, short: 'default' }),
    'style.css': '',
  })), /short/i);

  assert.throws(() => parseThemeZip(zip({
    'cf-monitor-theme.json': JSON.stringify({ ...manifest, style: '../style.css' }),
    'style.css': '',
  })), /path/i);

  assert.throws(() => parseThemeZip(zip({
    'cf-monitor-theme.json': JSON.stringify(manifest),
    'style.css': '',
    'theme.js': 'alert(1)',
  })), /extension/i);
});

test('validateThemeConfig accepts declared keys and rejects unknown keys', () => {
  assert.deepEqual(validateThemeConfig(manifest, {
    accentColor: '#22c55e',
    showDecorations: false,
    density: 'compact',
    brandColor: '#0ea5e9',
    heroImage: 'https://example.com/bg.webp',
    cardRadius: 18,
  }), {
    ok: true,
    config: {
      accentColor: '#22c55e',
      showDecorations: false,
      density: 'compact',
      brandColor: '#0ea5e9',
      heroImage: 'https://example.com/bg.webp',
      cardRadius: 18,
    },
  });

  assert.deepEqual(validateThemeConfig(manifest, { unknown: true }), {
    ok: false,
    error: '未知主题配置: unknown',
  });

  assert.deepEqual(validateThemeConfig(manifest, { brandColor: 'red' }), {
    ok: false,
    error: 'brandColor 必须是十六进制颜色',
  });

  assert.deepEqual(validateThemeConfig(manifest, { cardRadius: 33 }), {
    ok: false,
    error: 'cardRadius 不在可选范围内',
  });

  assert.deepEqual(validateThemeConfig(manifest, { heroImage: 'javascript:alert(1)' }), {
    ok: false,
    error: 'heroImage 必须是 HTTPS 图片 URL 或同源路径',
  });
});

test('parseThemeZip rejects invalid advanced config defaults and range metadata', () => {
  assert.throws(() => parseThemeZip(zip({
    'cf-monitor-theme.json': JSON.stringify({
      ...manifest,
      preview: '',
      configuration: {
        type: 'managed',
        data: [{ key: 'brandColor', name: '品牌色', type: 'color', default: 'red' }],
      },
    }),
    'style.css': '',
  })), /十六进制颜色/);

  assert.throws(() => parseThemeZip(zip({
    'cf-monitor-theme.json': JSON.stringify({
      ...manifest,
      preview: '',
      configuration: {
        type: 'managed',
        data: [{ key: 'radius', name: '圆角', type: 'range', min: 20, max: 10, default: 12 }],
      },
    }),
    'style.css': '',
  })), /range/i);
});

test('buildThemeCss combines variables, theme CSS, and custom CSS', () => {
  const css = buildThemeCss({
    styleCss: '.node-card { border-color: var(--cf-theme-accentColor); }',
    config: { accentColor: '#22c55e', showDecorations: true, density: 'compact', cardRadius: 18 },
    customCss: '.node-card { border-radius: 6px; }',
  });

  assert.match(css, /--cf-theme-accentColor: #22c55e;/);
  assert.match(css, /--cf-theme-showDecorations: 1;/);
  assert.match(css, /--cf-theme-density: compact;/);
  assert.match(css, /--cf-theme-cardRadius: 18;/);
  assert.match(css, /\.node-card \{ border-color/);
  assert.match(css, /\.node-card \{ border-radius: 6px; \}/);
});
