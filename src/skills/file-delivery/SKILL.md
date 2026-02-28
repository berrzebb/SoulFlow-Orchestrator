---
name: file-delivery
description: Send files (PDF, images, documents) to the current channel using send_file tool. Use when the user asks to attach, deliver, upload, or send a generated file. Do NOT use for requesting files FROM users (use request_file), text-only messages (use message), or diagram rendering (use diagram).
metadata:
  model: local
  tools:
    - send_file
    - write_file
  triggers:
    - 파일
    - 첨부
    - PDF
    - pdf
    - 이미지
    - 보내줘
    - 전송
    - 리포트
    - 보고서
    - 다운로드
    - 업로드
    - attach
    - send file
    - deliver
    - document
  aliases:
    - 파일전송
    - 파일첨부
---

# File Delivery

## Quick Reference

| Task | Tool Call |
|------|-----------|
| PDF 전송 | `send_file(file_path="report.pdf", caption="요청하신 보고서입니다.")` |
| 이미지 전송 | `send_file(file_path="chart.png", caption="분석 차트입니다.")` |
| 파일 생성 후 전송 | `write_file` → `send_file` |

## Workflow

1. 파일 생성이 필요하면 `write_file`로 먼저 작성.
2. `send_file(file_path, caption)`으로 채널에 전송.
3. caption에 간결한 설명 포함 — 파일 내용 요약.

## Guardrails

- workspace 내 파일만 전송 가능 (보안 샌드박스).
- 파일이 존재하지 않으면 에러 — 반드시 write_file로 먼저 생성.
- 대용량 파일(>25MB)은 채널 제한에 걸릴 수 있음.
- 여러 파일 전송 시 `send_file`을 반복 호출.
