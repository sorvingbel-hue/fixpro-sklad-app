// Миниатюры фото объекта + просмотр на весь экран с кнопкой «Удалить фото».
// Под миниатюрой — «⇄»: фото объекта ↔ скрин заказа, если добавили не той кнопкой (пример скрина — без неё).
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Muted } from '@/components/ui';
import { colors, font, radius, space } from '@/lib/theme';

import { localTime, type JobPhoto, type PhotoKind } from './jobs-model';
import { photoUrl } from './photo-store';

function useUrl(id: string, size: 'thumb' | 'full') {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    photoUrl(id, size).then(u => { if (alive) { setUrl(u); setMissing(!u); } });
    return () => { alive = false; };
  }, [id, size]);
  return { url, missing };
}

function Thumb({ p, onOpen }: { p: JobPhoto; onOpen: () => void }) {
  const { url, missing } = useUrl(p.id, 'thumb');
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Открыть ${p.kind === 'order' ? 'скрин заказа' : 'фото'}`} style={s.thumb} testID={`thumb-${p.id}`}>
      {url ? <Image source={{ uri: url }} style={s.thumbImg} resizeMode="cover" /> : (
        <Text style={s.thumbMissing}>{missing ? 'нет на этом устройстве' : '…'}</Text>
      )}
      {p.kind === 'order' ? <Text style={s.badge}>{p.sample ? 'ПРИМЕР' : 'ЗАКАЗ'}</Text> : null}
    </Pressable>
  );
}

const other = (k: PhotoKind): PhotoKind => (k === 'order' ? 'photo' : 'order');
const kindShort = (k: PhotoKind) => (k === 'order' ? '⇄ Это фото объекта' : '⇄ Это скрин заказа');
const kindLong = (k: PhotoKind) => (k === 'order' ? '⇄  Это фото объекта — перенести в «Фото объекта»' : '⇄  Это скрин заказа — перенести в «Скрин заказа»');

function Viewer({ p, onClose, onDelete, onKind }: { p: JobPhoto; onClose: () => void; onDelete: () => void; onKind?: () => void }) {
  const { url, missing } = useUrl(p.id, 'full');
  return (
    <Modal visible animationType="none" onRequestClose={onClose} transparent={false}>
      <View style={s.viewer} testID="photo-viewer">
        <View style={s.viewerImgWrap}>
          {url ? <Image source={{ uri: url }} style={s.viewerImg} resizeMode="contain" /> : (
            <Text style={s.viewerText}>{missing ? 'Этого фото нет в этом браузере.' : 'Загружаю…'}</Text>
          )}
        </View>
        <Text style={s.viewerText}>{`${p.kind === 'order' ? 'Скрин заказа' : 'Фото'} · ${p.name} · ${localTime(p.addedAt)}`}</Text>
        <View style={s.viewerBtns}>
          <Button title="Закрыть" onPress={onClose} testID="viewer-close" />
          {onKind ? <Button title={kindLong(p.kind)} kind="secondary" onPress={onKind} testID="viewer-kind" /> : null}
          <Button title="Удалить это фото" kind="secondary" onPress={onDelete} testID="viewer-delete" />
        </View>
      </View>
    </Modal>
  );
}

type GridProps = { photos: JobPhoto[]; onDelete: (p: JobPhoto) => void; onKind?: (p: JobPhoto, kind: PhotoKind) => void; empty: string };

export function PhotoGrid({ photos, onDelete, onKind, empty }: GridProps) {
  const [open, setOpen] = useState<JobPhoto | null>(null);
  if (!photos.length) return <Muted>{empty}</Muted>;
  const canKind = (p: JobPhoto) => !!onKind && !p.sample;
  return (
    <View>
      <View style={s.grid}>
        {photos.map(p => (
          <View key={p.id} style={s.cell}>
            <Thumb p={p} onOpen={() => setOpen(p)} />
            {canKind(p) ? (
              <Pressable
                onPress={() => onKind!(p, other(p.kind))}
                accessibilityRole="button"
                accessibilityLabel={p.kind === 'order' ? 'Это фото объекта: перенести в «Фото объекта»' : 'Это скрин заказа: перенести в «Скрин заказа»'}
                style={({ pressed }) => [s.kindBtn, pressed && { opacity: 0.6 }]}
                testID={`kind-${p.id}`}>
                <Text style={s.kindText}>{kindShort(p.kind)}</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
      <Muted>{onKind ? 'Нажмите на миниатюру — откроется крупно (там же «Удалить»). «⇄» — если добавили не той кнопкой.' : 'Нажмите на фото, чтобы открыть крупно или удалить.'}</Muted>
      {open ? (
        <Viewer
          p={open}
          onClose={() => setOpen(null)}
          onDelete={() => { const p = open; setOpen(null); onDelete(p); }}
          onKind={canKind(open) ? () => { const p = open; setOpen(null); onKind!(p, other(p.kind)); } : undefined}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.xs },
  cell: { width: 112, gap: space.xs },
  kindBtn: { minHeight: 52, borderRadius: radius.sm, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, paddingVertical: 2 },
  kindText: { fontSize: 15, fontWeight: '800', color: colors.primary, textAlign: 'center', lineHeight: 18 },
  thumb: { width: 112, height: 112, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  thumbImg: { width: '100%', height: '100%' },
  thumbMissing: { fontSize: 12, color: colors.muted, textAlign: 'center', padding: 4 },
  badge: { position: 'absolute', left: 4, top: 4, backgroundColor: colors.primary, color: colors.onPrimary, fontSize: 11, fontWeight: '800', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  viewer: { flex: 1, backgroundColor: '#000', padding: space.md, gap: space.md, justifyContent: 'center' },
  viewerImgWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewerImg: { width: '100%', height: '100%' },
  viewerText: { color: '#fff', fontSize: font.small, textAlign: 'center' },
  viewerBtns: { gap: space.sm },
});
