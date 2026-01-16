const esbuild = require('esbuild');
const { readFileSync } = require('fs');

// Read package.json to get version
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

// Entry points that need to be bundled
const entryPoints = [
  'src/cli.ts',
  'src/inject-session-id.ts',
  'src/context-hook.ts',
  'src/clear-capture.ts',
  'src/post-session.ts',
];

// Shim for import.meta.url in CommonJS
const importMetaShim = `
var __import_meta_url = require('url').pathToFileURL(__filename).href;
var import_meta = { url: __import_meta_url };
`;

// Common build options
const commonOptions = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs', // Use CommonJS for better compatibility with dependencies
  sourcemap: true,
  minify: false, // Keep readable for debugging
  external: [
    // Keep protobuf files external - they're loaded at runtime
    '*.proto',
  ],
  define: {
    'import.meta': 'import_meta',
  },
};

async function build() {
  try {
    // Bundle each entry point
    for (const entry of entryPoints) {
      const outfile = entry
        .replace('src/', 'dist/')
        .replace('.ts', '.js');

      // Add import.meta shim (source files already have shebang where needed)
      const banner = { js: `// SessionHub Plugin v${pkg.version}\n${importMetaShim}` };

      await esbuild.build({
        ...commonOptions,
        entryPoints: [entry],
        outfile,
        banner,
      });

      console.log(`✓ Built ${outfile}`);
    }

    console.log('\n✅ All entry points bundled successfully!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
