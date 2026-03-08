import { useState } from "react";
import { useT } from "../../i18n";

/** JSON textarea 상태 (raw text + 파싱 에러) 관리 훅. */
export function useJsonField(
  initialValue: unknown,
  onUpdate: (parsed: unknown) => void,
  emptyValue: unknown = undefined,
): { raw: string; err: string; onChange: (val: string) => void } {
  const t = useT();
  const [raw, setRaw] = useState(initialValue != null ? JSON.stringify(initialValue, null, 2) : "");
  const [err, setErr] = useState("");

  const onChange = (val: string) => {
    setRaw(val);
    if (!val.trim()) { setErr(""); onUpdate(emptyValue); return; }
    try { onUpdate(JSON.parse(val)); setErr(""); }
    catch { setErr(t("workflows.invalid_json")); }
  };

  return { raw, err, onChange };
}
