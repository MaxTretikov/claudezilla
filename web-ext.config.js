module.exports = {
  sourceDir: './extension',
  artifactsDir: './web-ext-artifacts',
  ignoreFiles: ['.DS_Store', '*.swp', '*.swo', 'CLAUDE.md'],
  build: {
    overwriteDest: true,
  },
};
