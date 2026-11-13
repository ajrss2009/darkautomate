/**
 * Fontes oferecidas para a legenda (as mesmas no editor, no formulário de projeto e no .ass da montagem).
 * São famílias que existem no Windows e são resolvidas pelo libass no ffmpeg; "id" é o nome da família
 * (vai para o ASS/force_style) e "css" é a lista com reservas para a prévia no editor.
 */
export const SUBTITLE_FONTS: Array<{ id: string; label: string; css: string }> = [
  { id: '', label: 'Padrão do tipo', css: '' },
  { id: 'Arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { id: 'Arial Black', label: 'Arial Black (grossa)', css: '"Arial Black", Arial, sans-serif' },
  { id: 'Impact', label: 'Impact (título)', css: 'Impact, "Arial Black", sans-serif' },
  { id: 'Verdana', label: 'Verdana (larga)', css: 'Verdana, Geneva, sans-serif' },
  { id: 'Tahoma', label: 'Tahoma', css: 'Tahoma, Geneva, sans-serif' },
  { id: 'Trebuchet MS', label: 'Trebuchet MS', css: '"Trebuchet MS", Tahoma, sans-serif' },
  { id: 'Segoe UI', label: 'Segoe UI (Windows)', css: '"Segoe UI", Tahoma, sans-serif' },
  { id: 'Calibri', label: 'Calibri', css: 'Calibri, Candara, sans-serif' },
  { id: 'Candara', label: 'Candara', css: 'Candara, Calibri, sans-serif' },
  { id: 'Franklin Gothic Medium', label: 'Franklin Gothic', css: '"Franklin Gothic Medium", "Arial Narrow", sans-serif' },
  { id: 'Bahnschrift', label: 'Bahnschrift (condensada)', css: 'Bahnschrift, "Arial Narrow", sans-serif' },
  { id: 'Georgia', label: 'Georgia (serifa)', css: 'Georgia, "Times New Roman", serif' },
  { id: 'Times New Roman', label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { id: 'Courier New', label: 'Courier New (máquina)', css: '"Courier New", Courier, monospace' },
  { id: 'Consolas', label: 'Consolas (código)', css: 'Consolas, "Courier New", monospace' },
  { id: 'Comic Sans MS', label: 'Comic Sans (cartoon)', css: '"Comic Sans MS", "Comic Sans", cursive' },
];

/** Nome da família para o ASS/force_style (só o id, sem vírgulas nem chaves). */
export const subtitleFontName = (font?: string): string => (font ?? '').replace(/[{}\\,;\r\n]/g, '').trim().slice(0, 64);

/** font-family da prévia no editor (com reservas). */
export const subtitleFontCss = (font?: string): string => SUBTITLE_FONTS.find((f) => f.id === (font ?? ''))?.css ?? '';
