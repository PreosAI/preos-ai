const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', 'src', 'frontend');
const files = fs.readdirSync(FRONTEND).filter(f => f.endsWith('.html'));

const TARGET_ICON = '<link rel="icon" type="image/png" href="/favicon.png">';
const TARGET_APPLE_192 = '<link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192.png">';
const TARGET_APPLE_512 = '<link rel="apple-touch-icon" sizes="512x512" href="/icons/icon-512.png">';

for (const file of files) {
  const fp = path.join(FRONTEND, file);
  let html = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n');
  let original = html;

  // 1. Replace old favicon link (with or without leading slash)
  html = html.replace(
    /<link rel="icon" type="image\/png" href="[^"]*favicon\.png">/g,
    TARGET_ICON
  );

  // 2. Remove old unsized apple-touch-icon lines
  html = html.replace(/\s*<link rel="apple-touch-icon" href="[^"]*favicon\.png">\n?/g, '\n');

  // 3. Remove old sized apple-touch-icon lines (will re-add in correct form)
  html = html.replace(/\s*<link rel="apple-touch-icon" sizes="192x192" href="[^"]*icon-192\.png">\n?/g, '\n');
  html = html.replace(/\s*<link rel="apple-touch-icon" sizes="512x512" href="[^"]*icon-512\.png">\n?/g, '\n');

  // 4. Clean up any resulting double blank lines
  html = html.replace(/\n{3,}/g, '\n\n');

  // 5. Insert the two apple-touch-icon lines right after the favicon link
  if (!html.includes('apple-touch-icon')) {
    html = html.replace(
      TARGET_ICON,
      TARGET_ICON + '\n  ' + TARGET_APPLE_192 + '\n  ' + TARGET_APPLE_512
    );
  }

  if (html !== original) {
    fs.writeFileSync(fp, html, 'utf8');
    console.log('✓', file);
  } else {
    console.log('–', file);
  }
}
console.log('Done.');
