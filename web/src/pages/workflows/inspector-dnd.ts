/**
 * Drag-and-drop helpers for inspector field references.
 * Shared between inspector-params and node-inspector.
 */

import type { DragEvent } from "react";

/** 출력 필드를 드래그 시작: `{{node_id.field_name}}` 텍스트를 전달. */
export function handleOutputFieldDragStart(e: DragEvent, node_id: string, field_name: string) {
  const ref = `{{${node_id}.${field_name}}}`;
  e.dataTransfer.setData("text/plain", ref);
  e.dataTransfer.setData("application/x-field-ref", JSON.stringify({ node_id, field_name, ref }));
  e.dataTransfer.effectAllowed = "copy";
}

/** 드롭 타겟에서 필드 참조 수신. */
export function handleFieldDrop(e: DragEvent<HTMLTextAreaElement | HTMLInputElement>, onInsert: (ref: string) => void) {
  e.preventDefault();
  const refData = e.dataTransfer.getData("application/x-field-ref");
  if (refData) {
    try {
      const { ref } = JSON.parse(refData) as { ref: string };
      const target = e.target as HTMLTextAreaElement | HTMLInputElement;
      const start = target.selectionStart ?? target.value.length;
      const before = target.value.slice(0, start);
      const after = target.value.slice(target.selectionEnd ?? start);
      const newVal = before + ref + after;
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(target, newVal);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        onInsert(ref);
      }
    } catch {
      const plain = e.dataTransfer.getData("text/plain");
      if (plain) onInsert(plain);
    }
  }
}

export function handleDragOver(e: DragEvent<HTMLTextAreaElement | HTMLInputElement>) {
  if (e.dataTransfer.types.includes("application/x-field-ref")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
}

/**
 * BuilderField 컨테이너 div에 연결하면 자식 input/textarea로 드롭이 위임됨.
 * select 등 다른 요소는 무시.
 */
export function handleContainerDrop(e: DragEvent<HTMLDivElement>) {
  const tgt = e.target as HTMLElement;
  if (tgt.tagName !== "INPUT" && tgt.tagName !== "TEXTAREA") return;
  handleFieldDrop(e as unknown as DragEvent<HTMLInputElement>, () => {});
}

export function handleContainerDragOver(e: DragEvent<HTMLDivElement>) {
  const tgt = e.target as HTMLElement;
  if (tgt.tagName !== "INPUT" && tgt.tagName !== "TEXTAREA") return;
  handleDragOver(e as unknown as DragEvent<HTMLInputElement>);
}

/** 필드 드래그 시작 — 전체 dot-path를 {{path}} 형태로 전달. */
export function handleTreeFieldDrag(e: DragEvent, fullPath: string) {
  const ref = `{{${fullPath}}}`;
  const dot = fullPath.indexOf(".");
  const nid = dot > 0 ? fullPath.slice(0, dot) : fullPath;
  const field = dot > 0 ? fullPath.slice(dot + 1) : fullPath;
  e.dataTransfer.setData("text/plain", ref);
  e.dataTransfer.setData("application/x-field-ref", JSON.stringify({ node_id: nid, field_name: field, ref }));
  e.dataTransfer.effectAllowed = "copy";
}
