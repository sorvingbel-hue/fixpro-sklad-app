// HTML-обёртка веб-версии (только веб): язык страницы — русский.
// headNodes/bodyNodes обязательны: через них Expo вставляет скрипты приложения (SDK 58).
import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Ссылка команды …/#s=<команда>&k=<код>: до запуска приложения переносим её в sessionStorage
// и убираем из адресной строки (иначе роутер оставит код в адресе). Подключение — в startSync().
const TEAM_LINK_SCRIPT = `(function(){try{var h=location.hash;if(/[#&]s=/.test(h)&&/[#&]k=/.test(h)){sessionStorage.setItem('fm.link',h);history.replaceState(history.state,'',location.pathname+location.search);}}catch(e){}})();`;

export default function Root({ children }: PropsWithChildren) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return (
    <html {...htmlAttributes} lang="ru">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#FFFFFF" />
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
