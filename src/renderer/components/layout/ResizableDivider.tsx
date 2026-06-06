import React, { useRef } from 'react';

interface ResizableDividerProps {
  orientation: 'left-to-right' | 'right-to-left';
  onResize: (width: number) => void;
  currentWidth: number;
  minWidth: number;
  maxWidth: number;
  zIndex?: number;
}

export const ResizableDivider: React.FC<ResizableDividerProps> = ({
  orientation,
  onResize,
  currentWidth,
  minWidth,
  maxWidth,
  zIndex = 10,
}) => {
  const isResizingRef = useRef(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = currentWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      const deltaX = moveEvent.clientX - startX;
      const delta = orientation === 'left-to-right' ? deltaX : -deltaX;
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + delta));
      onResize(newWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.background = 'var(--accent-primary)';
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isResizingRef.current) {
      e.currentTarget.style.background = 'var(--border-subtle)';
    }
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        width: 4,
        cursor: 'col-resize',
        background: 'var(--border-subtle)',
        flexShrink: 0,
        transition: 'background 0.15s',
        position: 'relative',
        zIndex,
      }}
    />
  );
};

export default ResizableDivider;
