// Прокрутка экрана к нужному блоку (одинаково на телефоне и в браузере).
// Меряем окно прокрутки, содержимое и блок через measureInWindow (в один момент) и сдвигаем ScrollView.
// Текущая прокрутка = верх окна − верх содержимого, поэтому не зависим от запаздывающих событий onScroll.
import { useCallback, useRef } from 'react';
import type { ScrollViewInstance, ViewInstance } from 'react-native';

type Box = { y: number; h: number };
const MARGIN = 12;

function measure(v: ViewInstance | null): Promise<Box | null> {
  return new Promise(resolve => {
    if (!v || typeof v.measureInWindow !== 'function') { resolve(null); return; }
    const timer = setTimeout(() => resolve(null), 400);
    try {
      v.measureInWindow((_x, y, _w, h) => { clearTimeout(timer); resolve({ y, h }); });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

export type RevealMode = 'span' | 'top';

export function useRevealScroll() {
  const viewport = useRef<ViewInstance>(null);   // обёртка ScrollView: её размер = видимая область
  const scroll = useRef<ScrollViewInstance>(null);
  const content = useRef<ViewInstance>(null);    // первый блок внутри ScrollView (без отступа сверху)
  const seq = useRef(0);                         // работает только последний запрос

  // 'span': показать низ блока bottom (главное — кнопка) и по возможности верх блока top.
  // 'top': поставить верх блока к верху экрана, если он не виден в верхней половине.
  const reveal = useCallback(async (top: ViewInstance | null, bottom: ViewInstance | null, mode: RevealMode) => {
    const my = ++seq.current;
    const [vp, ct, a, b] = await Promise.all([measure(viewport.current), measure(content.current), measure(top), measure(bottom ?? top)]);
    if (my !== seq.current || !vp || !ct || !a || !b || !scroll.current) return;
    const current = vp.y - ct.y;
    const topY = a.y - vp.y;
    const bottomY = b.y + b.h - vp.y;
    let delta = 0;
    if (mode === 'top') {
      if (topY < MARGIN || topY > vp.h / 2) delta = topY - MARGIN;
    } else {
      const needDown = bottomY - (vp.h - MARGIN); // > 0: низ ушёл под край
      const needUp = topY - MARGIN;               // < 0: верх ушёл над краем
      if (needDown > 0) delta = needDown;
      else if (needUp < 0) delta = Math.max(needUp, needDown);
    }
    // Блок уже виден — всё равно «закрепить» текущую позицию: это останавливает прежнюю анимацию прокрутки
    if (Math.abs(delta) < 2) scroll.current.scrollTo({ y: Math.max(0, current), animated: false });
    else scroll.current.scrollTo({ y: Math.max(0, current + delta), animated: true });
  }, []);

  return { viewport, scroll, content, reveal };
}
