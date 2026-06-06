import PyPDF2

reader = PyPDF2.PdfReader(r'd:\灌排第四次\任务四  渠道流量推算.pdf')
for i, page in enumerate(reader.pages):
    text = page.extract_text()
    print(f'--- Page {i+1} ---')
    print(text)