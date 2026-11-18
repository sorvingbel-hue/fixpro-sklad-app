// Отчёт и ссылки: в браузере — скачать .txt / открыть новую вкладку,
// на телефоне — системное меню «Поделиться» / встроенный браузер.
import * as WebBrowser from 'expo-web-browser';
import { Platform, Share } from 'react-native';

export async function exportText(text: string, fileName: string, title: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      // BOM — чтобы старые программы Windows открыли русский текст без «кракозябр»
      const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    }
    await Share.share({ message: text, title });
    return true;
  } catch {
    return false;
  }
}

export async function openLink(url: string): Promise<void> {
  try {
    if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
    else await WebBrowser.openBrowserAsync(url);
  } catch { /* не открылось — ничего не ломаем */ }
}
