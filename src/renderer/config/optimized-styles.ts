/**
 * 优化后的样式配置
 * 统一间距、字体、圆角、阴影
 */

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const BORDER_RADIUS = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

export const FONT_SIZE = {
  xs: 10,
  sm: 11,
  md: 12,
  base: 13,
  lg: 14,
  xl: 16,
  xxl: 20,
  title: 24,
} as const;

export const FONT_WEIGHT = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export const SHADOWS = {
  sm: '0 1px 3px rgba(0, 0, 0, 0.1)',
  md: '0 4px 12px rgba(0, 0, 0, 0.1)',
  lg: '0 8px 24px rgba(0, 0, 0, 0.12)',
  xl: '0 16px 48px rgba(0, 0, 0, 0.15)',
  glow: '0 0 16px 2px var(--accent-glow)',
} as const;

export const TRANSITIONS = {
  fast: 'all 0.15s ease',
  normal: 'all 0.2s ease',
  slow: 'all 0.3s ease',
} as const;

export const COLORS = {
  // 主色调
  primary: 'var(--accent-primary)',
  secondary: 'var(--accent-secondary)',
  
  // 文本颜色
  text: {
    primary: 'var(--text-primary)',
    secondary: 'var(--text-secondary)',
    muted: 'var(--text-muted)',
    inverse: 'white',
  },
  
  // 背景颜色
  bg: {
    base: 'var(--bg-base)',
    surface: 'var(--bg-surface)',
    elevated: 'var(--bg-elevated)',
    overlay: 'var(--bg-overlay)',
    hover: 'var(--bg-hover)',
    input: 'var(--bg-input)',
  },
  
  // 边框颜色
  border: {
    default: 'var(--border-default)',
    subtle: 'var(--border-subtle)',
    strong: 'var(--border-strong)',
  },
  
  // 状态颜色
  status: {
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#3b82f6',
  },
} as const;

/**
 * 优化后的组件样式
 */
export const COMPONENT_STYLES = {
  // 按钮样式
  button: {
    base: {
      padding: `${SPACING.sm}px ${SPACING.md}px`,
      borderRadius: BORDER_RADIUS.md,
      fontSize: FONT_SIZE.base,
      fontWeight: FONT_WEIGHT.medium,
      cursor: 'pointer',
      transition: TRANSITIONS.fast,
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACING.sm,
    },
    primary: {
      background: COLORS.primary,
      color: COLORS.text.inverse,
      boxShadow: SHADOWS.md,
    },
    secondary: {
      background: COLORS.bg.overlay,
      color: COLORS.text.secondary,
      border: `1px solid ${COLORS.border.default}`,
    },
    ghost: {
      background: 'transparent',
      color: COLORS.text.muted,
    },
  },
  
  // 输入框样式
  input: {
    base: {
      padding: `${SPACING.sm}px ${SPACING.md}px`,
      borderRadius: BORDER_RADIUS.md,
      fontSize: FONT_SIZE.base,
      color: COLORS.text.primary,
      background: COLORS.bg.input,
      border: `1px solid ${COLORS.border.default}`,
      outline: 'none',
      transition: TRANSITIONS.normal,
      width: '100%',
    },
    focus: {
      borderColor: COLORS.primary,
      boxShadow: `0 0 0 3px ${COLORS.primary}20`,
    },
  },
  
  // 卡片样式
  card: {
    base: {
      padding: SPACING.lg,
      borderRadius: BORDER_RADIUS.lg,
      background: COLORS.bg.surface,
      border: `1px solid ${COLORS.border.subtle}`,
      boxShadow: SHADOWS.sm,
    },
    hover: {
      transform: 'translateY(-2px)',
      boxShadow: SHADOWS.md,
    },
  },
  
  // 标签样式
  badge: {
    base: {
      padding: `${SPACING.xs}px ${SPACING.sm}px`,
      borderRadius: BORDER_RADIUS.full,
      fontSize: FONT_SIZE.xs,
      fontWeight: FONT_WEIGHT.medium,
      display: 'inline-flex',
      alignItems: 'center',
      gap: SPACING.xs,
    },
    primary: {
      background: `${COLORS.primary}20`,
      color: COLORS.primary,
    },
    success: {
      background: `${COLORS.status.success}20`,
      color: COLORS.status.success,
    },
    warning: {
      background: `${COLORS.status.warning}20`,
      color: COLORS.status.warning,
    },
    error: {
      background: `${COLORS.status.error}20`,
      color: COLORS.status.error,
    },
  },
  
  // 工具提示样式
  tooltip: {
    base: {
      padding: `${SPACING.sm}px ${SPACING.md}px`,
      borderRadius: BORDER_RADIUS.sm,
      fontSize: FONT_SIZE.sm,
      background: COLORS.bg.elevated,
      color: COLORS.text.primary,
      boxShadow: SHADOWS.lg,
      maxWidth: 200,
      zIndex: 1000,
    },
  },
  
  // 模态框样式
  modal: {
    overlay: {
      position: 'fixed' as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.6)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      backdropFilter: 'blur(4px)',
    },
    content: {
      background: COLORS.bg.surface,
      borderRadius: BORDER_RADIUS.xl,
      border: `1px solid ${COLORS.border.subtle}`,
      boxShadow: SHADOWS.xl,
      maxHeight: '85vh',
      overflow: 'hidden',
    },
  },
} as const;

/**
 * 响应式断点
 */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

/**
 * 媒体查询
 */
export const MEDIA_QUERIES = {
  sm: `@media (min-width: ${BREAKPOINTS.sm}px)`,
  md: `@media (min-width: ${BREAKPOINTS.md}px)`,
  lg: `@media (min-width: ${BREAKPOINTS.lg}px)`,
  xl: `@media (min-width: ${BREAKPOINTS.xl}px)`,
} as const;

/**
 * 动画关键帧
 */
export const ANIMATIONS = {
  fadeIn: {
    from: { opacity: 0 },
    to: { opacity: 1 },
  },
  fadeInUp: {
    from: { opacity: 0, transform: 'translateY(20px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
  fadeInDown: {
    from: { opacity: 0, transform: 'translateY(-20px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
  scaleIn: {
    from: { opacity: 0, transform: 'scale(0.95)' },
    to: { opacity: 1, transform: 'scale(1)' },
  },
  slideInLeft: {
    from: { opacity: 0, transform: 'translateX(-20px)' },
    to: { opacity: 1, transform: 'translateX(0)' },
  },
  slideInRight: {
    from: { opacity: 0, transform: 'translateX(20px)' },
    to: { opacity: 1, transform: 'translateX(0)' },
  },
  pulse: {
    '0%': { opacity: 1 },
    '50%': { opacity: 0.5 },
    '100%': { opacity: 1 },
  },
  spin: {
    from: { transform: 'rotate(0deg)' },
    to: { transform: 'rotate(360deg)' },
  },
} as const;

/**
 * 工具函数
 */
export const styleUtils = {
  /**
   * 合并样式
   */
  merge: (...styles: Array<React.CSSProperties | undefined | false>): React.CSSProperties => {
    return Object.assign({}, ...styles.filter(Boolean));
  },
  
  /**
   * 条件样式
   */
  conditional: (condition: boolean, trueStyle: React.CSSProperties, falseStyle?: React.CSSProperties): React.CSSProperties => {
    return condition ? trueStyle : (falseStyle || {});
  },
  
  /**
   * 响应式样式
   */
  responsive: (base: React.CSSProperties, sm?: React.CSSProperties, md?: React.CSSProperties, lg?: React.CSSProperties): React.CSSProperties => {
    return base; // 实际实现需要媒体查询
  },
};

export default {
  SPACING,
  BORDER_RADIUS,
  FONT_SIZE,
  FONT_WEIGHT,
  SHADOWS,
  TRANSITIONS,
  COLORS,
  COMPONENT_STYLES,
  BREAKPOINTS,
  MEDIA_QUERIES,
  ANIMATIONS,
  styleUtils,
};
