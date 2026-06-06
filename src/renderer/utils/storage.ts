/**
 * safeStorage - 安全的 localStorage 封装包装器
 * 防止在 quota 已满、禁用 cookie/storage 或普通网页沙箱环境中抛出运行时错误。
 */
export const safeStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn(`[SafeStorage] Failed to getItem for key "${key}":`, e);
      return null;
    }
  },

  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.error(`[SafeStorage] Failed to setItem for key "${key}":`, e);
    }
  },

  removeItem(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error(`[SafeStorage] Failed to removeItem for key "${key}":`, e);
    }
  }
};
