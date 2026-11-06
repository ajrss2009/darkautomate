const norm = (p) => { const abs = p.startsWith("/"); const out = []; for (const s of p.split("/")) { if (!s || s === ".") continue; if (s === "..") out.pop(); else out.push(s); } return (abs ? "/" : "") + out.join("/"); };
export const join = (...a) => norm(a.filter((x) => x != null && x !== "").join("/"));
export const resolve = (...a) => { let r = ""; for (const x of a) r = String(x).startsWith("/") ? String(x) : r + "/" + x; return norm(r || "/"); };
export const dirname = (p) => { const n = norm(p); const i = n.lastIndexOf("/"); return i <= 0 ? (n.startsWith("/") ? "/" : ".") : n.slice(0, i); };
export const basename = (p, ext) => { const b = norm(p).split("/").pop() || ""; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; };
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf("."); return i > 0 ? b.slice(i) : ""; };
export const sep = "/"; export const relative = (a, b) => b; export const isAbsolute = (p) => String(p).startsWith("/");
export default { join, resolve, dirname, basename, extname, sep, relative, isAbsolute };