/** @type { import('@storybook/html-vite').StorybookConfig } */
const config = {
  stories: ['../stories/**/*.stories.@(js|jsx|ts|tsx|mdx)'],
  addons: [
    '@storybook/addon-links',
    '@storybook/addon-essentials',
    '@storybook/addon-docs',
  ],
  framework: {
    name: '@storybook/html-vite',
    options: {},
  },
  docs: {
    autodocs: false, // Disabled to prevent multiple canvas stories from rendering simultaneously (shared WASM state)
  },
  staticDirs: ['../example/public'],
  async viteFinal(config) {
    // Customize Vite config
    return {
      ...config,
      optimizeDeps: {
        ...config.optimizeDeps,
        include: ['three'],
      },
    };
  },
};
export default config;

