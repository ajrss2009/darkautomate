// Gerado pelo FilmForge: @napi-rs/canvas → canvas do navegador (cenas HTML).
export function createCanvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
export const Path2D = globalThis.Path2D;
export const DOMMatrix = globalThis.DOMMatrix;
export const ImageData = globalThis.ImageData;
export const Image = globalThis.Image;
export async function loadImage(src) { const i = new Image(); i.src = typeof src === "string" ? src : URL.createObjectURL(new Blob([src])); await i.decode(); return i; }
export const GlobalFonts = { registerFromPath() { return true; }, register() { return true; }, families: [] };
export default { createCanvas, Path2D, DOMMatrix, ImageData, Image, loadImage, GlobalFonts };