---
name: file-maker
description: Generate structured files (PDF, PPTX, DOCX, XLSX, ZIP) using Python inside a container sandbox. Use when the user asks to create, export, or generate a document, report, spreadsheet, presentation, or archive. After creation, use file-delivery skill to send the file. When explicitly requested, can also package multiple files into a ZIP archive before delivery. Do NOT use for plain text/markdown/CSV (use write_file directly), diagrams (use diagram skill), or viewing/reading existing files. Do NOT create ZIP unless user explicitly asks for it.
metadata:
  model: remote
  tools:
    - exec
    - Bash
    - write_file
  triggers:
    - PDF 만들어
    - PPT 만들어
    - 워드 파일
    - 엑셀 만들어
    - 보고서 만들어
    - 문서 생성
    - 프레젠테이션
    - 압축
    - create pdf
    - generate report
    - make pptx
    - export excel
  aliases:
    - 문서생성
    - 파일생성
  intents:
    - generate_document
  file_patterns:
    - "*.pdf"
    - "*.docx"
    - "*.pptx"
    - "*.xlsx"
    - "*.zip"
  checks:
    - 생성된 파일이 workspace에 존재하나요?
    - 파일 내용이 요청과 일치하나요?
    - 한글 폰트 깨짐 없이 정상적으로 표시되나요?
---

# file-maker

## 상황별 레퍼런스

| 상황 | 읽을 파일 |
|------|-----------|
| PPTX — 구조화 슬라이드 (템플릿/테마 사용) | [pptx.md](references/pptx.md) |
| PPTX — 직접 코딩, 특수 레이아웃, 기존 파일 편집 | [pptx-api.md](references/pptx-api.md) |
| DOCX — 보고서/메모/제안서/서신 (템플릿 사용) | [docx.md](references/docx.md) |
| DOCX — 직접 코딩, 헤더·푸터, 기존 파일 편집 | [docx-api.md](references/docx-api.md) |
| PDF — HTML/Markdown 기반 (레이아웃·표·이미지) | [pdf.md](references/pdf.md) |
| PDF — 좌표 제어, 차트 내장, 한글 폰트 | [pdf-reportlab.md](references/pdf-reportlab.md) |
| XLSX — 데이터/서식/차트 | [xlsx.md](references/xlsx.md) |
| ZIP / TAR.GZ — **명시적 요청 시에만** | [archive.md](references/archive.md) |

## Workflow

1. 상황 파악 → 위 테이블에서 레퍼런스 1개 선택해 읽기.
2. `write_file`로 Python 스크립트(또는 JSON 입력 파일)를 workspace에 작성.
3. `python-sandbox` 패턴으로 컨테이너에서 실행.
4. 생성된 파일 확인 후 `file-delivery` 스킬로 전송.

## Guardrails

- 항상 컨테이너 내 실행 — 호스트에 직접 `python`/`pip` 금지.
- 출력 파일은 `/workspace` 마운트 경로에 저장.
- 대용량 데이터(>10MB) 처리 시 청크 분할 고려.
- 생성 실패 시 에러 메시지를 사용자에게 명확히 전달.
