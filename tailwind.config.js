/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: { fontFamily: { display: ['Fraunces', 'Georgia', 'serif'], sans: ['DM Sans', 'Trebuchet MS', 'sans-serif'] }, boxShadow: { soft: '0 24px 70px -30px rgba(15, 23, 42, 0.35)' } } },
  plugins: [],
};
