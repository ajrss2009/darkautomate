# FilmForge Data & Memory System

## Estrutura de Diretórios

```
FilmForgeData/
├── memory-system/     # Sistema de memória persistente
├── appdata/          # Dados de aplicação
└── workspace/        # Workspace do usuário
```

## Sistema de Memória

O FilmForge inclui um sistema de memória integrado que permite armazenar e recuperar informações persistentes durante o uso do aplicativo.

### Estrutura de uma Memória

Cada memória é armazenada como um arquivo JSON com a seguinte estrutura:

```json
{
  "name": "identificador-unico",
  "description": "Descrição curta da memória",
  "metadata": {
    "type": "user|feedback|project|reference",
    "customField": "valor opcional"
  },
  "content": "Conteúdo principal da memória",
  "timestamp": "2024-10-29T22:00:00",
  "tags": ["tag1", "tag2"],
  "related": ["outra-memoria"]
}
```

### Tipos de Memória

- **user**: Preferências e configurações do usuário
- **feedback**: Feedback sobre operações e resultados
- **project**: Informações sobre projetos  
- **reference**: Material de referência e documentação

### API de Memória (IPC)

O sistema de memória é acessível através de handlers IPC do Electron:

#### Estatísticas

```javascript
const stats = await window.electron.invoke('memory:stats');
// Retorna: { total, byType, initialized, path }
```

#### Listar Todas as Memórias

```javascript
const memories = await window.electron.invoke('memory:list');
// Retorna: Array<MemoryEntry>
```

#### Obter Memória Específica

```javascript
const memory = await window.electron.invoke('memory:get', 'nome-da-memoria');
// Retorna: MemoryEntry | null
```

#### Buscar por Tag

```javascript
const memories = await window.electron.invoke('memory:search-tag', 'projeto');
// Retorna: Array<MemoryEntry>
```

#### Buscar por Tipo

```javascript
const memories = await window.electron.invoke('memory:search-type', 'user');
// Retorna: Array<MemoryEntry>
```

#### Salvar Memória

```javascript
const result = await window.electron.invoke('memory:save', {
  name: 'minha-memoria',
  description: 'Descrição',
  metadata: { type: 'user' },
  content: 'Conteúdo da memória',
  timestamp: new Date().toISOString(),
  tags: ['tag1'],
  related: []
});
// Retorna: { success: true } | { success: false, error: string }
```

#### Deletar Memória

```javascript
const result = await window.electron.invoke('memory:delete', 'nome-da-memoria');
// Retorna: { success: true } | { success: false, error: string }
```

#### Verificar Inicialização

```javascript
const isInit = await window.electron.invoke('memory:initialized');
// Retorna: boolean
```

### Exemplos de Uso

#### Armazenar Preferência do Usuário

```javascript
await window.electron.invoke('memory:save', {
  name: 'user-theme',
  description: 'User theme preference',
  metadata: { type: 'user' },
  content: 'dark',
  timestamp: new Date().toISOString(),
  tags: ['user', 'ui', 'theme']
});
```

#### Armazenar Informação de Projeto

```javascript
await window.electron.invoke('memory:save', {
  name: 'project-last-scene',
  description: 'Last edited scene in project',
  metadata: {
    type: 'project',
    projectId: 'my-video-project'
  },
  content: 'scene-05',
  timestamp: new Date().toISOString(),
  tags: ['project', 'scene'],
  related: ['project-last-settings']
});
```

#### Recuperar Todas as Preferências do Usuário

```javascript
const userPrefs = await window.electron.invoke('memory:search-type', 'user');
console.log('Preferências do usuário:', userPrefs);
```

#### Buscar Memórias Relacionadas a um Projeto

```javascript
const projectMemories = await window.electron.invoke('memory:search-tag', 'meu-projeto');
console.log('Memórias do projeto:', projectMemories);
```

## Localização dos Arquivos

### Durante Desenvolvimento

```
filmforge/
└── FilmForgeData/
    └── memory-system/
        ├── *.json
```

### No Aplicativo Empacotado

```
FilmForge/
└── resources/
    └── FilmForgeData/
        └── memory-system/
            ├── *.json
```

## Inicialização

O sistema de memória é inicializado automaticamente no processo principal do Electron durante o `app.whenReady()`:

```typescript
const memResult = memory.initializeMemorySystem(String(process.resourcesPath ?? ''));
if (memResult.success) {
  const stats = memory.getMemoryStats();
  console.log(`Memory system: ${stats.total} entries at ${stats.path}`);
}
```

## Memórias Padrão

O FilmForge vem com algumas memórias pré-configuradas:

### project-filmforge.json
Informações sobre o projeto FilmForge

### user-preferences.json
Preferências padrão do usuário

### system-info.json
Informação de referência sobre o sistema de memória

## Boas Práticas

1. **Nomes Únicos**: Use nomes descritivos e únicos para cada memória
2. **Tags Consistentes**: Mantenha um conjunto consistente de tags
3. **Relacionamentos**: Use o campo `related` para conectar memórias relacionadas
4. **Tipos Apropriados**: Use o tipo correto para cada memória
5. **Timestamps**: Sempre atualize o timestamp ao modificar uma memória
6. **Validação**: Sempre verifique o retorno `success` das operações de escrita

## Arquitetura

```
src/main/
├── main.ts                    # Registro dos handlers IPC
└── memory-integration.ts      # Implementação do sistema de memória

FilmForgeData/
└── memory-system/            # Armazenamento persistente (JSON)
    └── *.json
```

## Limitações Atuais

- Armazenamento em JSON (não há índice ou query avançado)
- Busca linear (adequado para < 1000 memórias)
- Sem sincronização entre instâncias
- Sem histórico/versionamento automático

## Roadmap Futuro

- [ ] Indexação para buscas mais rápidas
- [ ] Versionamento de memórias
- [ ] Backup automático
- [ ] Exportação/importação em bulk
- [ ] Query language mais avançada
- [ ] Sincronização entre dispositivos
