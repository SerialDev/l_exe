/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Custom color palette inspired by ChatGPT/Claude
        surface: {
          DEFAULT: '#ffffff',
          dark: '#212121',
        },
        sidebar: {
          DEFAULT: '#f9fafb',
          dark: '#171717',
        },
        border: {
          DEFAULT: '#e5e7eb',
          dark: '#2f2f2f',
        },
        accent: {
          DEFAULT: '#10a37f',
          hover: '#0d8c6d',
        },
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: 'none',
            code: {
              backgroundColor: '#f3f4f6',
              padding: '0.25rem 0.375rem',
              borderRadius: '0.25rem',
              fontWeight: '400',
            },
            'code::before': {
              content: '""',
            },
            'code::after': {
              content: '""',
            },
          },
        },
      },
    },
  },
  plugins: [],
}
