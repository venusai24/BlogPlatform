const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

describe('build configuration', () => {
  it('Dockerfile builds and runs the ECS image on node:24-slim, and keeps that stage last', () => {
    const froms = read('Dockerfile').split('\n').filter(l => /^FROM /.test(l));
    const named = Object.fromEntries(froms.map(l => {
      const [, image, , name] = l.match(/^FROM (\S+)( AS (\S+))?/);
      return [name || image, image];
    }));
    expect(named.builder).toBe('node:24-slim');
    expect(named.runtime).toBe('node:24-slim');
    // The last stage is the default build target, so a plain `docker build` still makes the ECS image.
    expect(froms[froms.length - 1]).toMatch(/AS runtime$/);
  });

  it('Dockerfile has a Lambda target built on the Lambda base image with its own dependency stage', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toMatch(/^FROM public\.ecr\.aws\/lambda\/nodejs:22 AS lambda-builder/m);
    expect(dockerfile).toMatch(/^FROM public\.ecr\.aws\/lambda\/nodejs:22 AS lambda$/m);
    expect(dockerfile).toContain('CMD ["src/handlers/indexingLambda.handler"]');
  });

  it('Dockerfile installs production dependencies only', () => {
    expect(read('Dockerfile')).toContain('npm ci --omit=dev');
  });

  it('.dockerignore excludes secrets, logs and tests', () => {
    const lines = read('.dockerignore').split('\n').map(l => l.trim());
    for (const entry of ['.env*', '*.log', '**/__tests__', 'test/', 'jest.setup.js', 'evaluation/', 'deploy*.sh']) {
      expect(lines).toContain(entry);
    }
  });

  it('package.json declares engines.node >=22 and has no unused deps', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.engines.node).toBe('>=22');
    for (const dep of ['mysql2', 'openai', '@pinecone-database/pinecone', 'react-scripts']) {
      expect(pkg.dependencies).not.toHaveProperty(dep);
    }
  });

  it('frontend Dockerfile builds on node:24-alpine and serves with unprivileged nginx', () => {
    const froms = read('..', 'frontend', 'Dockerfile').split('\n').filter(l => /^FROM /.test(l));
    expect(froms).toHaveLength(2);
    expect(froms[0]).toMatch(/^FROM node:24-alpine/);
    expect(froms[1]).toMatch(/^FROM nginxinc\/nginx-unprivileged:/);
  });
});
