/** 벡터 정규화 유틸. */

/** sqlite-vec 스토어들이 공유하는 임베딩 차원 수. 모델 변경 시 스키마 마이그레이션 필요. */
export const VEC_DIMENSIONS = 256;

/** L2 정규화 후 number[] 반환. 임베딩 점수 계산용. */
export function normalize_vec(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/** L2 정규화 후 Float32Array 반환. sqlite-vec 직접 삽입용. */
export function normalize_vec_f32(v: number[]): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  const out = new Float32Array(v.length);
  if (norm > 0) for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}
