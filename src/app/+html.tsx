// HTML-обёртка веб-версии (только веб): язык страницы — русский.
// headNodes/bodyNodes обязательны: через них Expo вставляет скрипты приложения (SDK 58).
import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Ссылка команды …/#s=<команда>&k=<код>: до запуска приложения переносим её в sessionStorage
// и убираем из адресной строки (иначе роутер оставит код в адресе). Подключение — в startSync().
const TEAM_LINK_SCRIPT = `(function(){try{var h=location.hash;if(/[#&]s=/.test(h)&&/[#&]k=/.test(h)){sessionStorage.setItem('fm.link',h);history.replaceState(history.state,'',location.pathname+location.search);}}catch(e){}})();`;

// Адрес сайта (GitHub Pages, папка /forman): og:image должен быть абсолютным
const BASE = '/fixpro-sklad-app/forman/';
const SITE = `https://sorvingbel-hue.github.io${BASE}`;

export default function Root({ children }: PropsWithChildren) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return (
    <html {...htmlAttributes} lang="ru">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#FFFFFF" />
        <title>Форман — помощник бригадира HVAC</title>
        <meta name="description" content="Работа на сегодня: заказ, трак, фото, этапы и отчёт офису. Работает в браузере телефона, данные — только у вас." />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Форман — помощник бригадира HVAC" />
        <meta property="og:description" content="Заказ, трак, фото, этапы и отчёт офису — в телефоне. Без регистрации." />
        <meta property="og:image" content={`${SITE}og.png`} />
        <meta property="og:url" content={SITE} />
        <meta name="twitter:card" content="summary_large_image" />
        <link rel="manifest" href={`${BASE}manifest.webmanifest`} />
        <link rel="apple-touch-icon" href={`${BASE}apple-touch-icon.png`} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Форман" />
        <script dangerouslySetInnerHTML={{ __html: TEAM_LINK_SCRIPT }} />
        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
