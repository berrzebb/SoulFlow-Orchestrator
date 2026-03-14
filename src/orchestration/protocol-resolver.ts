/**
 * RP-2: ProtocolResolver.
 *
 * shared_protocols 이름을 실제 프로토콜 본문으로 해석.
 * 프로토콜은 _shared/ 디렉토리에서 로드된 문서.
 */

/** 해석된 프로토콜 항목. */
export interface ResolvedProtocol {
  readonly name: string;
  readonly content: string;
}

/** ProtocolResolver 계약. */
export interface ProtocolResolverLike {
  resolve(protocol_names: readonly string[]): readonly ResolvedProtocol[];
  resolve_one(name: string): ResolvedProtocol | null;
  list_available(): readonly string[];
}

/** SkillsLoader 최소 계약 — ProtocolResolver가 의존하는 부분만. */
export interface ProtocolSource {
  get_shared_protocol(name: string): string | null;
  list_shared_protocols?(): readonly string[];
}

/** ProtocolResolver 생성. */
export function create_protocol_resolver(source: ProtocolSource): ProtocolResolverLike {
  return {
    resolve(protocol_names: readonly string[]): readonly ResolvedProtocol[] {
      const results: ResolvedProtocol[] = [];
      for (const name of protocol_names) {
        const content = source.get_shared_protocol(name);
        if (content) results.push({ name, content });
      }
      return results;
    },
    resolve_one(name: string): ResolvedProtocol | null {
      const content = source.get_shared_protocol(name);
      if (!content) return null;
      return { name, content };
    },
    list_available(): readonly string[] {
      if (source.list_shared_protocols) {
        return source.list_shared_protocols();
      }
      return [];
    },
  };
}
