import matplotlib.font_manager as fm
import os

# 列出所有可用字体
fonts = sorted(set(f.name for f in fm.fontManager.ttflist))
print('matplotlib可用字体总数:', len(fonts))
for f in fonts:
    print(f'  {f}')

# 检查系统字体目录
print('\n--- 系统字体目录 ---')
font_dirs = [r'C:\Windows\Fonts', os.path.expanduser('~') + r'\AppData\Local\Microsoft\Windows\Fonts']
for d in font_dirs:
    if os.path.exists(d):
        ttf_files = [f for f in os.listdir(d) if f.lower().endswith(('.ttf', '.ttc'))]
        chinese_like = [f for f in ttf_files if any(k in f.lower() for k in ['yahei', 'simhei', 'simsun', 'song', 'hei', 'kai', 'fang', 'ming', 'gothic', 'meiryo', 'msjh', 'deng'])]
        print(f'{d}: 共{len(ttf_files)}个字体文件')
        print(f'  中文相关: {chinese_like}')