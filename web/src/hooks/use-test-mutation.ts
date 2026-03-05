import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import { useToast } from "../components/toast";

export interface TestResult {
  ok: boolean;
  detail?: string;
  error?: string;
}

interface UseTestMutationOptions {
  url: string;
  body?: Record<string, unknown>;
  onOk: (r: TestResult) => string;
  onFail: (r: TestResult) => string;
  onError: (err: Error) => string;
}

export function useTestMutation({ url, body, onOk, onFail, onError }: UseTestMutationOptions) {
  const [result, setResult] = useState<TestResult | null>(null);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => api.post<TestResult>(url, body),
    onMutate: () => setResult(null),
    onSuccess: (r) => {
      setResult(r);
      toast(r.ok ? onOk(r) : onFail(r), r.ok ? "ok" : "err");
    },
    onError: (err) => {
      setResult({ ok: false, error: err.message });
      toast(onError(err), "err");
    },
  });

  return {
    testing: mutation.isPending,
    testResult: result,
    test: mutation.mutate,
  };
}
