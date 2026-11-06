/**
 * HTTP do processo principal.
 *
 * Em redes corporativas com inspeção de TLS (proxy com CA própria), o Windows e o
 * Chromium confiam na CA do proxy, mas o `fetch` do Node não: as chamadas morrem com
 * `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` (aparece como "fetch failed" na interface).
 *
 * `net.fetch` do Electron usa a pilha de rede do Chromium — certificados do Windows,
 * proxy do sistema e PAC — então é o padrão aqui. Fora do Electron (testes em node
 * puro) cai no `fetch` global.
 */
type FetchFn = typeof fetch;
let chosen: FetchFn | undefined;

/** Servidores locais (Ollama, LM Studio, ComfyUI) vão direto pelo Node — nunca pelo proxy. */
const isLocal = (input: Parameters<FetchFn>[0]): boolean => {
  const u = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(u);
};

export function httpFetch(): FetchFn {
  if (chosen) return chosen;
  let remote: FetchFn | undefined;
  try {
    const el = require('electron') as unknown as { net?: { fetch?: FetchFn } };
    const nf = el?.net?.fetch;
    if (typeof nf === 'function') remote = ((input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]) => nf.call(el.net, input, init)) as FetchFn;
  } catch { /* node puro (testes) */ }
  const plain: FetchFn = (input, init) => fetch(input, init);
  chosen = remote ? ((input, init) => (isLocal(input) ? plain(input, init) : remote!(input, init))) : plain;
  return chosen;
}

