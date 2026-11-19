// Страховка экрана объекта: если данные объекта испорчены и экран упал, вместо белого экрана —
// понятное сообщение, «К списку» и «Удалить объект» (иначе удалить такой объект было бы нечем).
import { Component, type ReactNode } from 'react';

import { Button, Card, Notice } from '@/components/ui';

import { confirmAction } from './job-screen';

type Props = { title: string; onBack: () => void; onDelete: () => void; children: ReactNode };

export class JobGuard extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // ошибку уже показали человеку; остальные объекты и список не задеты
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { title, onBack, onDelete } = this.props;
    return (
      <Card title="Объект не открылся">
        <Notice kind="warn" text={`Объект «${title}» не удалось открыть: его данные повреждены. Остальные объекты в порядке.`} testID="job-guard" />
        <Button title="← Все объекты" onPress={onBack} testID="job-guard-back" />
        <Button
          title="Удалить этот объект"
          kind="secondary"
          onPress={() => confirmAction(`Удалить объект «${title}» вместе с фото? Вернуть будет нельзя.`, onDelete)}
          testID="job-guard-delete"
        />
      </Card>
    );
  }
}
