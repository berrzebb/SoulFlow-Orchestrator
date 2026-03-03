# 아카이브 생성 레퍼런스

## ZIP (zipfile — Python 내장)

```python
# script.py
import zipfile
import os

output = "output.zip"
targets = ["report.pdf", "data.xlsx", "summary.docx"]   # 포함할 파일 목록

with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for filepath in targets:
        if os.path.exists(filepath):
            zf.write(filepath, arcname=os.path.basename(filepath))
            print(f"  added: {filepath}")
        else:
            print(f"  skip (not found): {filepath}")

print(f"saved: {output}")
```

```powershell
$R = if (Get-Command podman -EA 0) { "podman" } else { "docker" }
& $R run --rm -v "${PWD}:/workspace:rw" -w /workspace python:3.12-slim sh -lc "
  python script.py
"
```

## 디렉토리 전체 압축

```python
import zipfile, os

def zip_dir(src_dir: str, output: str) -> None:
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(src_dir):
            for file in files:
                abs_path = os.path.join(root, file)
                arc_path = os.path.relpath(abs_path, start=os.path.dirname(src_dir))
                zf.write(abs_path, arcname=arc_path)

zip_dir("reports/", "reports.zip")
print("saved: reports.zip")
```

## TAR.GZ

```python
import tarfile

with tarfile.open("output.tar.gz", "w:gz") as tar:
    tar.add("reports/", arcname="reports")

print("saved: output.tar.gz")
```

## 압축 해제

```python
# ZIP 해제
with zipfile.ZipFile("input.zip") as zf:
    zf.extractall("extracted/")

# TAR.GZ 해제
with tarfile.open("input.tar.gz") as tar:
    tar.extractall("extracted/")
```

## 형식 선택 기준

| 형식 | 언제 |
|------|------|
| `.zip` | 범용, Windows 호환, 파일 개별 접근 |
| `.tar.gz` | Linux/Mac 서버 전달, 대용량 압축률 중요 |
| `.tar` | 압축 없이 묶기만 (이미 압축된 파일들) |
