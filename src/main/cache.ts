/**
 * 轻量级内存缓存模块
 * 提供 TTL、LRU 驱逐、最大条目限制，用于减少重复 I/O 和网络请求
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  hitCount: number;
  size: number; // 近似字节大小
}

interface CacheOptions {
  /** 默认过期时间（毫秒） */
  defaultTTL: number;
  /** 最大条目数，超出后驱逐最久未使用的 */
  maxEntries: number;
  /** 单个条目最大大小（字节），超出则拒绝缓存 */
  maxEntrySize: number;
}

type CacheKey = string;

type CacheStats = {
  entries: number;
  hits: number;
  misses: number;
  totalSize: number;
  maxEntries: number;
  defaultTTL: number;
};

const DEFAULT_OPTIONS: CacheOptions = {
  defaultTTL: 60_000, // 1 分钟
  maxEntries: 500,
  maxEntrySize: 10 * 1024 * 1024, // 10MB
};

export class MemoryCache {
  private store = new Map<CacheKey, CacheEntry<unknown>>();
  private accessOrder: CacheKey[] = [];
  private hits = 0;
  private misses = 0;
  private totalSize = 0;

  constructor(private options: CacheOptions = DEFAULT_OPTIONS) {}

  /**
   * 获取缓存值。如果不存在或已过期返回 undefined
   */
  get<T>(key: CacheKey): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // 检查是否过期
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.totalSize -= entry.size;
      this.misses++;
      // 从访问顺序中移除
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) this.accessOrder.splice(idx, 1);
      return undefined;
    }

    // 命中，更新访问顺序和计数
    this.hits++;
    entry.hitCount++;
    this.touchAccessOrder(key);
    return entry.value;
  }

  /**
   * 设置缓存值
   */
  set<T>(key: CacheKey, value: T, ttl?: number): boolean {
    const size = this.approximateSize(value);
    if (size > this.options.maxEntrySize) {
      console.warn(`[Cache] Skipping large entry (${size} bytes) for key "${key}"`);
      return false;
    }

    // 如果 key 已存在，先移除旧的
    if (this.store.has(key)) {
      const oldEntry = this.store.get(key)!;
      this.totalSize -= oldEntry.size;
    }

    const expiresAt = Date.now() + (ttl ?? this.options.defaultTTL);
    const entry: CacheEntry<unknown> = {
      value,
      expiresAt,
      createdAt: Date.now(),
      hitCount: 0,
      size,
    };

    this.store.set(key, entry);
    this.totalSize += size;
    this.touchAccessOrder(key);

    // 超过最大条目数，驱逐最久未使用的
    this.evictIfNeeded();

    return true;
  }

  /**
   * 删除指定缓存
   */
  delete(key: CacheKey): boolean {
    const entry = this.store.get(key);
    if (entry) {
      this.totalSize -= entry.size;
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) this.accessOrder.splice(idx, 1);
    }
    return this.store.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.store.clear();
    this.accessOrder = [];
    this.totalSize = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * 清理所有过期的缓存条目
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        this.totalSize -= entry.size;
        const idx = this.accessOrder.indexOf(key);
        if (idx !== -1) this.accessOrder.splice(idx, 1);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    return {
      entries: this.store.size,
      hits: this.hits,
      misses: this.misses,
      totalSize: this.totalSize,
      maxEntries: this.options.maxEntries,
      defaultTTL: this.options.defaultTTL,
    };
  }

  /**
   * 更新默认 TTL
   */
  setDefaultTTL(ttl: number): void {
    this.options.defaultTTL = ttl;
  }

  /**
   * 包装一个异步函数，添加缓存层
   */
  wrapAsync<T>(
    key: CacheKey,
    fetcher: () => Promise<T>,
    ttl?: number,
    shouldCache?: (result: T) => boolean,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    return fetcher().then((result) => {
      if (!shouldCache || shouldCache(result)) {
        this.set(key, result, ttl);
      }
      return result;
    });
  }

  // ---- 内部辅助方法 ----

  /** 近似计算值的字节大小 */
  private approximateSize(value: unknown): number {
    try {
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      return Buffer.byteLength(str, 'utf-8');
    } catch {
      return 0;
    }
  }

  /** 将 key 移到访问顺序列表末尾（表示最近使用） */
  private touchAccessOrder(key: CacheKey): void {
    const idx = this.accessOrder.indexOf(key);
    if (idx !== -1) {
      this.accessOrder.splice(idx, 1);
    }
    this.accessOrder.push(key);
  }

  /** 如果超出最大条目数，驱逐最久未使用的条目 */
  private evictIfNeeded(): void {
    while (this.store.size > this.options.maxEntries && this.accessOrder.length > 0) {
      const oldestKey = this.accessOrder.shift();
      if (oldestKey && this.store.has(oldestKey)) {
        const entry = this.store.get(oldestKey)!;
        this.totalSize -= entry.size;
        this.store.delete(oldestKey);
      }
    }
  }
}

// ---- 单例/导出 ----

/**
 * 默认全局缓存实例，用于文件读取、目录列表等通用缓存
 */
export const defaultCache = new MemoryCache({
  defaultTTL: 30_000, // 30 秒
  maxEntries: 500,
  maxEntrySize: 10 * 1024 * 1024, // 10MB
});

/**
 * API 响应缓存实例，用于 HTTP GET 请求缓存
 */
export const apiCache = new MemoryCache({
  defaultTTL: 15_000, // 15 秒
  maxEntries: 200,
  maxEntrySize: 5 * 1024 * 1024, // 5MB
});

/**
 * 应用状态缓存实例，用于 app-state-read 的频繁读取
 */
export const appStateCache = new MemoryCache({
  defaultTTL: 5_000, // 5 秒（状态需要相对实时）
  maxEntries: 100,
  maxEntrySize: 1 * 1024 * 1024, // 1MB
});

/**
 * MCP 工具列表缓存（长期缓存）
 */
export const mcpToolsCache = new MemoryCache({
  defaultTTL: 5 * 60 * 1000, // 5 分钟
  maxEntries: 50,
  maxEntrySize: 500 * 1024, // 500KB
});

/**
 * 文件内容缓存（基于文件路径 + mtime）
 * 注意：文件缓存需要配合文件修改时间使用，这里设计 key 为 `filepath:mtime`
 */
export const fileContentCache = new MemoryCache({
  defaultTTL: 10_000, // 10 秒
  maxEntries: 300,
  maxEntrySize: 5 * 1024 * 1024, // 5MB
});

/**
 * 目录列表缓存
 */
export const directoryCache = new MemoryCache({
  defaultTTL: 5_000, // 5 秒
  maxEntries: 100,
  maxEntrySize: 1 * 1024 * 1024, // 1MB
});