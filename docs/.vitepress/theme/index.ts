import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import LiveCard from './LiveCard.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('LiveCard', LiveCard);
  },
} satisfies Theme;
