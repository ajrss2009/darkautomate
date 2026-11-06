# Guia Rápido - Sistema de Memória do FilmForge

## 🚀 Início Rápido

### 1. Build do Projeto

```bash
# Opção mais simples
.\Package-Complete.ps1

# Ou manualmente
npm run build
npm run dist
```

### 2. Executar

```
release/win-unpacked/FilmForge.exe
```

### 3. Verificar Memória (Console DevTools)

```javascript
// Abra o DevTools (Ctrl+Shift+I) e execute:

// Ver estatísticas
const stats = await window.electron.invoke('memory:stats');
console.log(stats);
// Output: { total: 3, byType: {...}, initialized: true, path: "..." }

// Listar todas
const all = await window.electron.invoke('memory:list');
console.log(all);

// Buscar por tipo
const projects = await window.electron.invoke('memory:search-type', 'project');
console.log(projects);
```

## 📝 Exemplos de Uso

### Salvar Preferência do Usuário

```javascript
await window.electron.invoke('memory:save', {
  name: 'user-theme',
  description: 'User theme preference',
  metadata: { type: 'user' },
  content: 'dark',
  timestamp: new Date().toISOString(),
  tags: ['user', 'ui', 'theme'],
  related: []
});
```

### Recuperar Memória Específica

```javascript
const theme = await window.electron.invoke('memory:get', 'user-theme');
console.log(theme.content); // "dark"
```

### Buscar por Tags

```javascript
const userStuff = await window.electron.invoke('memory:search-tag', 'user');
console.log(`Found ${userStuff.length} user-related memories`);
```

### Deletar Memória

```javascript
await window.electron.invoke('memory:delete', 'user-theme');
```

## 📁 Estrutura de Arquivos

```
FilmForge.exe (raiz do executável)
└── resources/
    └── FilmForgeData/
        ├── memory-system/       ← Memórias aqui (JSON)
        │   ├── project-filmforge.json
        │   ├── user-preferences.json
        │   └── system-info.json
        ├── appdata/            ← Dados de app
        └── workspace/          ← Workspace do usuário
```

## 🔧 Estrutura de uma Memória

```json
{
  "name": "minha-memoria",
  "description": "Descrição curta",
  "metadata": {
    "type": "user|feedback|project|reference"
  },
  "content": "Conteúdo principal",
  "timestamp": "2024-10-29T22:00:00",
  "tags": ["tag1", "tag2"],
  "related": ["outra-memoria"]
}
```

## 🎯 API Completa

| Comando | Função |
|---------|--------|
| `memory:stats` | Estatísticas do sistema |
| `memory:list` | Lista todas as memórias |
| `memory:get` | Obtém uma memória específica |
| `memory:search-tag` | Busca por tag |
| `memory:search-type` | Busca por tipo |
| `memory:save` | Salva/atualiza memória |
| `memory:delete` | Remove memória |
| `memory:initialized` | Verifica se inicializou |

## ✅ Checklist de Verificação

Após o build, verifique:

- [ ] `release/win-unpacked/resources/FilmForgeData` existe
- [ ] `release/win-unpacked/resources/FilmForgeData/memory-system` existe
- [ ] Há pelo menos 3 arquivos `.json` em `memory-system/`
- [ ] O app inicia sem erros
- [ ] Console mostra: `[MemorySystem] Inicializado em: ...`
- [ ] `memory:stats` retorna `total >= 3`

## 🐛 Troubleshooting

**Problema**: `memory:stats` retorna `{ total: 0, initialized: false }`

**Soluções**:
1. Verificar se `FilmForgeData/memory-system` existe em `resources/`
2. Verificar permissões do diretório
3. Verificar logs do console para erros

**Problema**: Memórias não persistem

**Solução**: Verificar permissões de escrita no diretório

## 📚 Documentação Completa

- `FilmForgeData-README.md` - Documentação completa da API
- `MEMORY-SYSTEM-IMPLEMENTATION.md` - Detalhes da implementação

## 🎉 Pronto!

O sistema de memória está funcionando quando você vê no console:

```
[MemorySystem] Inicializado em: C:\...\resources\FilmForgeData\memory-system
Memory system: 3 entries at C:\...\resources\FilmForgeData\memory-system
```

---

**Próximos Passos**: Integrar UI para gerenciar memórias visualmente
