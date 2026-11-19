// Миниатюры фото объекта + просмотр на весь экран с кнопкой «Удалить фото».
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Muted } from '@/components/ui';
import { colors, font, radius, space } from '@/lib/theme';

import type { JobPhoto } from './jobs-model';
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
      {p.kind === 'order' ? <Text style={s.badge}>ЗАКАЗ</Text> : null}
    </Pressable>
  );
}

function Viewer({ p, onClose, onDelete }: { p: JobPhoto; onClose: () => void; onDelete: () => void }) {
  const { url, missing } = useUrl(p.id, 'full');
  return (
    <Modal visible animationType="none" onRequestClose={onClose} transparent={false}>
      <View style={s.viewer} testID="photo-viewer">
        <View style={s.viewerImgWrap}>
          {url ? <Image source={{ uri: url }} style={s.viewerImg} resizeMode="contain" /> : (
            <Text style={s.viewerText}>{missing ? 'Этого фото нет в этом браузере.' : 'Загружаю…'}</Text>
          )}
        </View>
        <Text style={s.viewerText}>{`${p.kind === 'order' ? 'Скрин заказа' : 'Фото'} · ${p.name} · ${p.addedAt.replace('T', ' ').slice(0, 16)} UTC`}</Text>
        <View style={s.viewerBtns}>
          <Button title="Закрыть" onPress={onClose} testID="viewer-close" />
          <Button title="Удалить это фото" kind="secondary" onPress={onDelete} testID="viewer-delete" />
        </View>
      </View>
    </Modal>
  );
}

export function PhotoGrid({ photos, onDelete, empty }: { photos: JobPhoto[]; onDelete: (p: JobPhoto) => void; empty: string }) {
  const [open, setOpen] = useState<JobPhoto | null>(null);
  if (!photos.length) return <Muted>{empty}</Muted>;
  return (
    <View>
      <View style={s.grid}>
        {photos.map(p => <Thumb key={p.id} p={p} onOpen={() => setOpen(p)} />)}
      </View>
      <Muted>Нажмите на фото, чтобы открыть крупно или удалить.</Muted>
      {open ? <Viewer p={open} onClose={() => setOpen(null)} onDelete={() => { const p = open; setOpen(null); onDelete(p); }} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.xs },
  thumb: { width: 100, height: 100, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  thumbImg: { width: '100%', height: '100%' },
  thumbMissing: { fontSize: 12, color: colors.muted, textAlign: 'center', padding: 4 },
  badge: { position: 'absolute', left: 4, top: 4, backgroundColor: colors.primary, color: colors.onPrimary, fontSize: 11, fontWeight: '800', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  viewer: { flex: 1, backgroundColor: '#000', padding: space.md, gap: space.md, justifyContent: 'center' },
  viewerImgWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewerImg: { width: '100%', height: '100%' },
  viewerText: { color: '#fff', fontSize: font.small, textAlign: 'center' },
  viewerBtns: { gap: space.sm },
});
