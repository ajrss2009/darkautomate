/*
 * Confirmação e aviso dentro da página, no lugar de window.confirm/alert.
 * No Electron (Windows), depois de um diálogo nativo a página perde o foco do teclado:
 * inputs e textareas param de aceitar digitação até a janela perder e ganhar o foco de novo
 * (aparecia como "campos do Novo projeto desabilitados" depois de excluir algo).
 */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function open(message: string, buttons: Array<{ label: string; value: boolean; cls?: string }>): Promise<boolean> {
  return new Promise((resolve) => {
    const prev = document.activeElement as HTMLElement | null;
    const bg = el('div', 'modal-bg ff-dialog');
    const box = el('div', 'modal ff-dialog-box');
    const msg = el('div', 'ff-dialog-msg', message);
    const row = el('div', 'row actions');
    row.append(el('span', 'sp'));
    const done = (v: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      bg.remove();
      resolve(v);
      /* devolve o foco para onde estava (o campo continua editável) */
      if (prev && document.contains(prev)) prev.focus(); else window.focus();
    };
    const btns = buttons.map((b) => { const x = el('button', b.cls, b.label); x.addEventListener('click', () => done(b.value)); row.append(x); return x; });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(buttons[buttons.length - 1]!.value); }
    };
    document.addEventListener('keydown', onKey, true);
    bg.addEventListener('click', (e) => { if (e.target === bg) done(false); });
    box.append(msg, row);
    bg.append(box);
    document.body.append(bg);
    btns[btns.length - 1]!.focus();
  });
}

/** Pergunta sim/não sem diálogo nativo. Enter confirma, Esc cancela. */
export function askConfirm(message: string, o: { ok?: string; cancel?: string; danger?: boolean } = {}): Promise<boolean> {
  return open(message, [{ label: o.cancel ?? 'Cancelar', value: false }, { label: o.ok ?? 'OK', value: true, cls: o.danger === false ? 'primary' : 'danger' }]);
}

/** Aviso com um botão só, sem diálogo nativo. */
export async function showMessage(message: string): Promise<void> {
  await open(message, [{ label: 'OK', value: true, cls: 'primary' }]);
}
