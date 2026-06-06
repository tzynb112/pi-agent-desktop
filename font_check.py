import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm

fonts = [f.name for f in fm.fontManager.ttflist]
chinese_fonts = sorted(set(f for f in fonts if any(c > '\u4e00' for c in f)))
print("可用中文字体:")
for f in chinese_fonts:
    print(f"  {f}")

# 测试各字符渲染
fig, ax = plt.subplots(figsize=(10, 2))
test_strs = [
    'm3/(s*万亩)',
    'm3/(s·万亩)',
    '灌水率图（修正前）',
    '灌水率图(修正前)',
    '总灌水率',
    '设计灌水率',
]
for i, s in enumerate(test_strs):
    ax.text(0.1, 0.8 - i*0.15, s, fontsize=14, transform=ax.transAxes)
ax.set_xlim(0, 1)
ax.set_ylim(0, 1)
plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei']
plt.rcParams['axes.unicode_minus'] = False
plt.savefig(r'd:\灌排第四次\font_test.png', dpi=100)
plt.close()
print("\n字体测试图已保存")