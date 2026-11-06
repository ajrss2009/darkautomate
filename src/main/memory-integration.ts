/**
 * Integração do sistema de memória do FilmForge
 *
 * Este módulo inicializa e expõe o sistema de memória para o processo principal.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

interface MemoryEntry {
  name: string;
  description: string;
  metadata: {
    type: 'user' | 'feedback' | 'project' | 'reference';
    [key: string]: unknown;
  };
  content: string;
  timestamp?: string;
  tags?: string[];
  related?: string[];
}

let memorySystemPath: string | null = null;
let initialized = false;

/**
 * Inicializa o sistema de memória
 */
export function initializeMemorySystem(resourcesPath: string): { success: boolean; path?: string; error?: string } {
  try {
    // Caminho do sistema de memória nos resources
    const systemPath = path.join(resourcesPath, 'FilmForgeData', 'memory-system');

    if (!fs.existsSync(systemPath)) {
      return {
        success: false,
        error: `Sistema de memória não encontrado em: ${systemPath}`
      };
    }

    memorySystemPath = systemPath;
    initialized = true;

    console.log('[MemorySystem] Inicializado em:', memorySystemPath);

    return {
      success: true,
      path: memorySystemPath
    };
  } catch (error) {
    return {
      success: false,
      error: `Erro ao inicializar sistema de memória: ${error}`
    };
  }
}

/**
 * Lê todas as memórias disponíveis
 */
export function readMemories(): MemoryEntry[] {
  if (!initialized || !memorySystemPath) {
    throw new Error('Sistema de memória não inicializado');
  }

  try {
    const memories: MemoryEntry[] = [];
    const files = fs.readdirSync(memorySystemPath);

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(memorySystemPath, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const memory = JSON.parse(content) as MemoryEntry;
        memories.push(memory);
      }
    }

    return memories;
  } catch (error) {
    console.error('[MemorySystem] Erro ao ler memórias:', error);
    return [];
  }
}

/**
 * Busca memórias por tags
 */
export function searchMemoriesByTag(tag: string): MemoryEntry[] {
  const allMemories = readMemories();
  return allMemories.filter(m => m.tags?.includes(tag));
}

/**
 * Busca memórias por tipo
 */
export function searchMemoriesByType(type: MemoryEntry['metadata']['type']): MemoryEntry[] {
  const allMemories = readMemories();
  return allMemories.filter(m => m.metadata.type === type);
}

/**
 * Busca uma memória específica por nome
 */
export function getMemory(name: string): MemoryEntry | null {
  if (!initialized || !memorySystemPath) {
    return null;
  }

  try {
    const filePath = path.join(memorySystemPath, `${name}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as MemoryEntry;
  } catch (error) {
    console.error(`[MemorySystem] Erro ao ler memória "${name}":`, error);
    return null;
  }
}

/**
 * Salva ou atualiza uma memória
 */
export function saveMemory(memory: MemoryEntry): { success: boolean; error?: string } {
  if (!initialized || !memorySystemPath) {
    return { success: false, error: 'Sistema de memória não inicializado' };
  }

  try {
    const filePath = path.join(memorySystemPath, `${memory.name}.json`);
    const content = JSON.stringify(memory, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');

    console.log('[MemorySystem] Memória salva:', memory.name);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Erro ao salvar memória: ${error}`
    };
  }
}

/**
 * Remove uma memória
 */
export function deleteMemory(name: string): { success: boolean; error?: string } {
  if (!initialized || !memorySystemPath) {
    return { success: false, error: 'Sistema de memória não inicializado' };
  }

  try {
    const filePath = path.join(memorySystemPath, `${name}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('[MemorySystem] Memória removida:', name);
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Erro ao remover memória: ${error}`
    };
  }
}

/**
 * Retorna estatísticas do sistema de memória
 */
export function getMemoryStats(): {
  total: number;
  byType: Record<string, number>;
  initialized: boolean;
  path: string | null;
} {
  if (!initialized || !memorySystemPath) {
    return {
      total: 0,
      byType: {},
      initialized: false,
      path: null
    };
  }

  const memories = readMemories();
  const byType: Record<string, number> = {};

  for (const memory of memories) {
    const type = memory.metadata.type;
    byType[type] = (byType[type] || 0) + 1;
  }

  return {
    total: memories.length,
    byType,
    initialized: true,
    path: memorySystemPath
  };
}

/**
 * Verifica se o sistema está inicializado
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Retorna o caminho do sistema de memória
 */
export function getMemorySystemPath(): string | null {
  return memorySystemPath;
}
