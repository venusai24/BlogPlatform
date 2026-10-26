const fs = require('fs');
const path = require('path');

// Source files log through pino (src/utils/logger). console.* output is unstructured, unredacted and
// invisible to log queries. scripts/ are CLI tools and keep console output.
const SKIP_DIRS = new Set(['node_modules', 'scripts', 'evaluation', '__tests__', 'test', 'coverage']);
const SKIP_FILES = new Set(['jest.setup.js']);
const PATTERN = /console\.(log|error|warn|info)\(/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith('.js') && !SKIP_FILES.has(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

describe('logging', () => {
  it('no source file uses console.log/error/warn/info', () => {
    const root = path.join(__dirname, '..');
    const offenders = walk(root)
      .filter(file => PATTERN.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.relative(root, file));

    expect(offenders).toEqual([]);
  });
});
