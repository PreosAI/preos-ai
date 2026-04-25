/**
 * fix-mobile-ux.js
 * Applies FIX 2 (nav scroll shadow) and FIX 3 (hamburger tap target) to all HTML files.
 *
 * FIX 2: adds transition to nav box-shadow, adds nav.scrolled CSS rule, adds scroll JS listener
 * FIX 3: adds min-width/min-height 44px, align-items center, -webkit-tap-highlight-color, padding 8px
 *
 * Files already with their own scroll nav implementation (transparent→opaque) are skipped for FIX 2:
 *   agentes.html, vender.html, por-que-preos.html
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', 'src', 'frontend');

// Files that already have a working scroll nav → skip FIX 2 entirely
const SKIP_SCROLL_NAV = new Set(['agentes.html', 'vender.html', 'por-que-preos.html']);

// Files without a hamburger menu → skip FIX 3
const SKIP_HAMBURGER = new Set(['agente-dashboard.html', 'dashboard.html', 'ingresar.html', 'tour.html']);

const files = fs.readdirSync(FRONTEND).filter(f => f.endsWith('.html'));

let changed = 0;
let skipped = 0;

for (const file of files) {
  const fp = path.join(FRONTEND, file);
  // Normalize CRLF → LF so all string ops use \n
  let html = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n');
  let original = html;

  // ── FIX 2: Nav scroll shadow ─────────────────────────────────────────────

  if (!SKIP_SCROLL_NAV.has(file)) {
    // 2a. Add transition: box-shadow to nav block (only where static box-shadow exists)
    // Handle both "box-shadow: 0" and "box-shadow:0" (with/without space after colon)
    if (/box-shadow:\s*0 1px 0 rgba\(0,0,0,\.08\)/.test(html) && !html.includes('transition: box-shadow')) {
      html = html.replace(
        /(box-shadow:\s*0 1px 0 rgba\(0,0,0,\.08\);)/g,
        '$1\n      transition: box-shadow 0.2s ease;'
      );
    }

    // 2b. Add nav.scrolled CSS rule (if not already present)
    if (!html.includes('nav.scrolled')) {
      // Try to insert after the nav { ... } block — find the closing brace of nav block
      // After transition line if it's a multiline nav
      if (html.includes('transition: box-shadow 0.2s ease;\n      }')) {
        html = html.replace(
          'transition: box-shadow 0.2s ease;\n      }',
          'transition: box-shadow 0.2s ease;\n    }\n\n    nav.scrolled { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }'
        );
      } else if (html.includes('transition: box-shadow 0.2s ease;\n    }')) {
        html = html.replace(
          'transition: box-shadow 0.2s ease;\n    }',
          'transition: box-shadow 0.2s ease;\n    }\n\n    nav.scrolled { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }'
        );
      } else if (html.includes('transition: box-shadow 0.2s ease;\n  }')) {
        // Compact 2-space indent pages
        html = html.replace(
          'transition: box-shadow 0.2s ease;\n  }',
          'transition: box-shadow 0.2s ease;\n  }\n\n    nav.scrolled { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }'
        );
      } else {
        // Single-line nav — match "nav { ... }" on one line and insert after it
        const singleLineNav = html.match(/([ \t]*nav\s*\{[^\n]+\}\n)/);
        if (singleLineNav && singleLineNav[1].includes('box-shadow')) {
          const indent = singleLineNav[1].match(/^([ \t]*)/)[1];
          html = html.replace(singleLineNav[1],
            singleLineNav[1] + indent + 'nav.scrolled { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }\n'
          );
        } else {
          // Transparent nav or other — insert before .nav-brand / .navbar-brand rule
          const navBrandMatch = html.match(/\n(\s*)\.(navbar?-brand)\s*\{/);
          if (navBrandMatch) {
            const indent = navBrandMatch[1];
            html = html.replace(
              /(\n\s*\.navbar?-brand\s*\{)/,
              '\n\n' + indent + 'nav.scrolled { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }$1'
            );
          }
        }
      }
    }

    // 2c. Add scroll JS listener before </body> (only if not already present)
    if (!html.includes("classList.toggle('scrolled'") && !html.includes("classList.add('scrolled')")) {
      const scrollScript = `\n<script>\n  window.addEventListener('scroll', function() {\n    document.querySelector('nav').classList.toggle('scrolled', window.scrollY > 10);\n  }, { passive: true });\n</script>`;
      html = html.replace('</body>', scrollScript + '\n</body>');
    }
  }

  // ── FIX 3: Hamburger tap target ──────────────────────────────────────────

  if (!SKIP_HAMBURGER.has(file) && html.includes('.hamburger {')) {
    // Replace padding: 4px with padding: 8px inside .hamburger block
    html = html.replace(
      /(\.hamburger\s*\{[^}]*?)padding:\s*4px/,
      '$1padding: 8px'
    );

    // Add min-width, min-height, align-items, tap-highlight if not present
    if (!html.includes('min-width: 44px')) {
      html = html.replace(
        /(\.hamburger\s*\{[^}]*?)(})/,
        function(match, block, closingBrace) {
          let additions = '';
          if (!block.includes('min-width')) additions += '\n      min-width: 44px;';
          if (!block.includes('min-height')) additions += '\n      min-height: 44px;';
          if (!block.includes('align-items')) additions += '\n      align-items: center;';
          if (!block.includes('-webkit-tap-highlight-color')) additions += '\n      -webkit-tap-highlight-color: transparent;';
          return block + additions + '\n    ' + closingBrace;
        }
      );
    }
  }

  if (html !== original) {
    fs.writeFileSync(fp, html, 'utf8');
    console.log('✓ updated:', file);
    changed++;
  } else {
    console.log('– unchanged:', file);
    skipped++;
  }
}

console.log(`\nDone. ${changed} files updated, ${skipped} unchanged.`);
