/** @type { import('@storybook/html').Preview } */
const preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    docs: {
      toc: true,
    },
    backgrounds: {
      default: 'dark',
      values: [
        {
          name: 'dark',
          value: '#111111',
        },
        {
          name: 'light',
          value: '#F8F8F8',
        },
      ],
    },
    layout: 'fullscreen',
  },
  decorators: [
    (Story, context) => {
      // Get the story container
      const container = Story();
      
      // Ensure container has cleanup method attached
      if (container && typeof container === 'object') {
        // Store cleanup for later
        const originalCleanup = container.cleanup;
        
        // Return a wrapper that cleans up properly
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'width: 100%; height: 100%; position: relative;';
        wrapper.appendChild(container);
        
        // Attach cleanup to wrapper as well
        wrapper.cleanup = () => {
          console.log('[Storybook Decorator] Cleaning up story');
          if (originalCleanup && typeof originalCleanup === 'function') {
            originalCleanup();
          }
        };
        
        return wrapper;
      }
      
      return container;
    }
  ],
};

export default preview;

